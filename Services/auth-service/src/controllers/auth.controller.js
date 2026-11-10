import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../db/client.js';
import * as userDb from '../db/userQueries.js';
import * as membershipDb from '../db/membershipQueries.js';
import { DEMO_TENANT_ID } from '../../../shared/constants/src/index.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as emailService from '../utils/email.js';
import { signJwt, verifyJwt } from '../config/jwtKeys.js';
import * as rateLimit from '../services/rateLimit.service.js';
import {
  createSession, consumeSession, revokeFamily, revokeUserSessions, revokeSessionByToken,
} from '../services/session.service.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

export const ACCESS_COOKIE = 'token';
export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';
const SAME_SITE_VALUES = new Set(['strict', 'lax', 'none']);

// Customers still use the public website's bearer-token flow, which cannot refresh.
const isCustomer = (user) => user.role === 'customer';

// Website customers belong to the agency whose public website they use; for now that is the demo agency.
const PUBLIC_SITE_TENANT_ID = () => process.env.PUBLIC_SITE_TENANT_ID || DEMO_TENANT_ID;

const customerWorkspace = (user) => ({
  tenantId: PUBLIC_SITE_TENANT_ID(),
  membershipId: null,
  role: 'customer',
  permissions: user.permissions || [],
  isOwner: false,
});

// The role and permissions in a token come from the membership of the chosen agency, not from the global account.
const signToken = (user, workspace) =>
  signJwt(
    {
      id: user.id,
      tid: workspace.tenantId,
      mid: workspace.membershipId,
      role: workspace.role,
      email: user.email,
      name: user.name,
      permissions: workspace.permissions,
      isSuperAdmin: workspace.isOwner || workspace.role === 'superAdmin',
    },
    isCustomer(user) ? process.env.JWT_EXPIRE || '7d' : process.env.STAFF_ACCESS_TOKEN_TTL || '15m'
  );

const cookieOptions = (path = '/') => {
  const configured = (process.env.AUTH_COOKIE_SAMESITE || '').toLowerCase();
  const sameSite = SAME_SITE_VALUES.has(configured) ? configured : 'strict';
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production' || sameSite === 'none', sameSite, path };
};

const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions());
  res.clearCookie(REFRESH_COOKIE, cookieOptions(REFRESH_COOKIE_PATH));
};

const publicUser = (user, workspace) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: workspace.role,
  isSuperAdmin: workspace.isOwner || workspace.role === 'superAdmin',
  phone: user.phone,
  avatarUrl: user.avatarUrl,
  isEmailVerified: user.isEmailVerified,
  mustChangePassword: user.mustChangePassword,
  permissions: workspace.permissions,
  tenant: workspace.tenantSlug
    ? { id: workspace.tenantId, slug: workspace.tenantSlug, name: workspace.tenantName }
    : { id: workspace.tenantId },
});

const issueSession = async (req, res, user, workspace, familyId) => {
  const token = signToken(user, workspace);
  const session = await createSession(user.id, {
    familyId, tenantId: workspace.tenantId, ipAddress: clientIp(req), userAgent: req.get('user-agent'),
  });
  // A staff cookie outlives its 15-minute token so the gateway can answer "expired" and the app renews it.
  const lifetime = isCustomer(user) ? { maxAge: jwt.decode(token).exp * 1000 - Date.now() } : { expires: session.expiresAt };
  res.cookie(ACCESS_COOKIE, token, { ...cookieOptions(), ...lifetime });
  res.cookie(REFRESH_COOKIE, session.token, { ...cookieOptions(REFRESH_COOKIE_PATH), expires: session.expiresAt });
  return token;
};

const TENANT_CHOICE_TTL = '5m';

const issueTenantChoice = (res, user, memberships) =>
  res.status(200).json({
    status: 'success',
    message: 'Choose an agency to continue',
    data: {
      requiresTenantChoice: true,
      selectionToken: signJwt({ userId: user.id, tenantChoice: true }, TENANT_CHOICE_TTL),
      tenants: memberships.map((m) => ({ id: m.tenantId, slug: m.tenantSlug, name: m.tenantName, role: m.role })),
    },
  });

/**
 * Finishes a successful sign-in: picks the agency to work in, then issues the session.
 * Someone in several agencies is asked to choose unless `tenantId` names one they belong to.
 */
const completeLogin = async (req, res, user, statusCode, message, { tenantId } = {}) => {
  if (isCustomer(user)) return sendTokenResponse(req, res, user, customerWorkspace(user), statusCode, message);

  const memberships = await membershipDb.listUsableMemberships(user.id);
  if (memberships.length === 0) {
    throw new AppError('Your account is not part of any active agency. Please contact your administrator.', 403);
  }
  const chosen = tenantId
    ? memberships.find((m) => m.tenantId === tenantId)
    : memberships.length === 1 ? memberships[0] : null;
  if (tenantId && !chosen) throw new AppError("You don't have access to that agency.", 403);
  if (!chosen) return issueTenantChoice(res, user, memberships);

  return sendTokenResponse(req, res, user, chosen, statusCode, message);
};

const sendTokenResponse = async (req, res, user, workspace, statusCode, message = 'Success') => {
  const token = await issueSession(req, res, user, workspace);

  await userDb.updateLastLogin(user.id).catch(() => {});

  res.status(statusCode).json({
    status: 'success',
    message,
    data: { ...(isCustomer(user) && { token }), user: publicUser(user, workspace) },
  });
};

const generateOTP = () => crypto.randomInt(100000, 1000000).toString();

const MAX_OTP_ATTEMPTS = 5;
const LIMITS = {
  loginIp: { limit: 20, windowSeconds: 15 * 60 },
  loginAccount: { limit: 10, windowSeconds: 15 * 60 },
  otpIp: { limit: 20, windowSeconds: 15 * 60 },
  otpResend: { limit: 5, windowSeconds: 15 * 60 },
  resetIp: { limit: 10, windowSeconds: 60 * 60 },
  resetAccount: { limit: 3, windowSeconds: 60 * 60 },
  registerIp: { limit: 10, windowSeconds: 60 * 60 },
};

// Only the gateway can reach this service in deployed environments, and it sets this header itself.
const clientIp = (req) => req.get('x-client-ip') || req.ip;

const enforceLimits = async (res, checks) => {
  const results = await Promise.all(checks.map(([scope, value, limit]) => rateLimit.hit(scope, value, limit)));
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length > 0) {
    res.set('Retry-After', String(Math.max(...blocked.map((b) => b.retryAfterSeconds))));
    throw new AppError('Too many attempts. Please wait a few minutes and try again.', 429);
  }
};

const enforceLoginLimits = (req, res, email) =>
  enforceLimits(res, [
    ['login-ip', clientIp(req), LIMITS.loginIp],
    ['login-account', email, LIMITS.loginAccount],
  ]);

const codesMatch = (expected, given) => {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Dev-only escape hatch: salesRep OTP is intentionally not bypassable in
// production (see docs/OTP_LOGIN_FIX.md) — this only skips it when both the
// environment is non-production AND it's explicitly opted into, so nothing
// changes unless SKIP_OTP=true is set on purpose in a dev/test .env.
const otpBypassEnabled = () => process.env.NODE_ENV !== 'production' && process.env.SKIP_OTP === 'true';

const generateTempToken = (userId) => signJwt({ userId, tempAuth: true }, '15m');

const verifyTempToken = (token) => {
  let decoded;
  try {
    decoded = verifyJwt(token);
  } catch {
    throw new AppError('Invalid or expired temporary token', 401);
  }
  if (decoded.tempAuth !== true || !decoded.userId) throw new AppError('Invalid or expired temporary token', 401);
  return decoded;
};

const maskEmail = (email) => {
  const [name, domain] = email.split('@');
  return `${name.substring(0, 2)}***@${domain}`;
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ─── Controllers ───────────────────────────────────────────────────────────────

export const register = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !password) throw new AppError('Name, email and password are required', 400);
  await enforceLimits(res, [['register-ip', clientIp(req), LIMITS.registerIp]]);

  const existing = await userDb.findUserByEmail(email.toLowerCase().trim());
  if (existing) throw new AppError('User with this email already exists', 400);

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await userDb.createUser({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone?.trim() || null,
    password: hashedPassword,
    role: 'customer',
  });

  // Generate email verification token (plain token → hash stored in DB)
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerification = hashToken(verificationToken);
  const verificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await userDb.setEmailVerificationToken(user.id, hashedVerification, verificationExpire);

  emailService.sendEmailVerification(user, verificationToken);
  emailService.sendWelcomeEmail(user);

  await completeLogin(req, res, user, 201, 'Registration successful. Please check your email to verify your account.');
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);
  await enforceLoginLimits(req, res, email);

  const user = await userDb.findUserByEmail(email.toLowerCase().trim());
  if (!user) throw new AppError('Invalid credentials', 401);

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AppError('Invalid credentials', 401);

  if (!user.isActive) throw new AppError('Your account has been deactivated. Please contact support.', 403);
  await rateLimit.clear('login-account', email);

  if (user.mustChangePassword) {
    return res.status(200).json({
      status: 'success',
      message: 'Password change required',
      data: { mustChangePassword: true, userId: user.id, email: user.email },
    });
  }

  // Sales reps require OTP (bypassable only via SKIP_OTP in non-production envs)
  if (user.role === 'salesRep' && !otpBypassEnabled()) {
    const otp = generateOTP();
    await prisma.otp.deleteMany({ where: { userId: user.id, type: 'login', isUsed: false } });
    await prisma.otp.create({
      data: {
        userId: user.id,
        code: otp,
        type: 'login',
        email: user.email,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        ipAddress: clientIp(req),
        userAgent: req.get('user-agent'),
      },
    });

    await emailService.sendOTPEmail(user, otp).catch((err) => {
      throw new AppError('Failed to send OTP. Please try again.', 500);
    });

    return res.status(200).json({
      status: 'success',
      message: 'OTP sent to your email. Please verify to continue.',
      data: { tempToken: generateTempToken(user.id), maskedEmail: maskEmail(user.email), expiresIn: 600, requiresOTP: true },
    });
  }

  await completeLogin(req, res, user, 200, 'Login successful', { tenantId: req.body?.tenantId });
});

export const loginStep1 = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);
  await enforceLoginLimits(req, res, email);

  const user = await userDb.findUserByEmail(email.toLowerCase().trim());
  if (!user) throw new AppError('Invalid credentials', 401);

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new AppError('Invalid credentials', 401);

  if (!user.isActive) throw new AppError('Account deactivated', 403);
  await rateLimit.clear('login-account', email);

  if (user.role !== 'salesRep' || otpBypassEnabled()) {
    return completeLogin(req, res, user, 200, 'Login successful', { tenantId: req.body?.tenantId });
  }

  const otp = generateOTP();
  await prisma.otp.deleteMany({ where: { userId: user.id, type: 'login', isUsed: false } });
  await prisma.otp.create({
    data: {
      userId: user.id,
      code: otp,
      type: 'login',
      email: user.email,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ipAddress: clientIp(req),
      userAgent: req.get('user-agent'),
    },
  });

  await emailService.sendOTPEmail(user, otp);

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your email.',
    data: { tempToken: generateTempToken(user.id), maskedEmail: maskEmail(user.email), expiresIn: 600 },
  });
});

export const loginStep2 = asyncHandler(async (req, res) => {
  const { tempToken, otp } = req.body;
  if (!tempToken || !otp) throw new AppError('tempToken and otp are required', 400);
  await enforceLimits(res, [['otp-ip', clientIp(req), LIMITS.otpIp]]);

  const decoded = verifyTempToken(tempToken);
  const user = await userDb.findUserById(decoded.userId);
  if (!user) throw new AppError('User not found', 404);
  if (user.role !== 'salesRep') throw new AppError('OTP verification only required for sales representatives', 403);

  const otpRecord = await prisma.otp.findFirst({
    where: { userId: user.id, type: 'login', isUsed: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!otpRecord) throw new AppError('Invalid OTP. Please try again.', 401);
  if (new Date() > otpRecord.expiresAt) {
    await prisma.otp.delete({ where: { id: otpRecord.id } });
    throw new AppError('OTP has expired. Please request a new one.', 401);
  }

  // Claim the attempt before comparing, so parallel guesses cannot exceed the limit.
  const claimed = await prisma.otp.updateMany({
    where: { id: otpRecord.id, isUsed: false, attempts: { lt: MAX_OTP_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    await prisma.otp.deleteMany({ where: { id: otpRecord.id } });
    throw new AppError('Too many wrong codes. Please request a new code.', 429);
  }
  if (!codesMatch(otpRecord.code, otp)) throw new AppError('Invalid OTP. Please try again.', 401);

  const used = await prisma.otp.updateMany({ where: { id: otpRecord.id, isUsed: false }, data: { isUsed: true } });
  if (used.count === 0) throw new AppError('Invalid OTP. Please try again.', 401);
  emailService.sendLoginNotification(user);

  await completeLogin(req, res, user, 200, 'Login successful', { tenantId: req.body?.tenantId });
});

export const resendOTP = asyncHandler(async (req, res) => {
  const { tempToken } = req.body;
  if (!tempToken) throw new AppError('tempToken is required', 400);

  const decoded = verifyTempToken(tempToken);
  await enforceLimits(res, [['otp-resend', decoded.userId, LIMITS.otpResend]]);
  const user = await userDb.findUserById(decoded.userId);
  if (!user) throw new AppError('User not found', 404);

  const otp = generateOTP();
  await prisma.otp.deleteMany({ where: { userId: user.id, type: 'login', isUsed: false } });
  await prisma.otp.create({
    data: {
      userId: user.id,
      code: otp,
      type: 'login',
      email: user.email,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ipAddress: clientIp(req),
      userAgent: req.get('user-agent'),
    },
  });

  await emailService.sendOTPEmail(user, otp);

  res.status(200).json({
    status: 'success',
    message: 'New OTP sent.',
    data: { maskedEmail: maskEmail(user.email), expiresIn: 600 },
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const consumed = await consumeSession(req.cookies?.[REFRESH_COOKIE]);
  const user = consumed && (await userDb.findUserById(consumed.userId));
  // A renewed session stays in the agency it was opened for, and ends if that access was removed.
  const workspace = !user?.isActive || !consumed.tenantId ? null
    : isCustomer(user) ? customerWorkspace(user)
      : await membershipDb.findUsableMembership(user.id, consumed.tenantId);

  if (!workspace) {
    if (consumed) await revokeFamily(consumed.familyId);
    clearAuthCookies(res);
    throw new AppError('Your session has expired. Please sign in again.', 401);
  }

  await issueSession(req, res, user, workspace, consumed.familyId);
  res.status(200).json({ status: 'success', message: 'Session refreshed', data: { user: publicUser(user, workspace) } });
});

/** Second half of signing in for someone in several agencies: opens a session in the one they picked. */
export const selectTenant = asyncHandler(async (req, res) => {
  const { selectionToken, tenantId } = req.body || {};
  if (typeof selectionToken !== 'string' || typeof tenantId !== 'string') {
    throw new AppError('selectionToken and tenantId are required', 400);
  }
  let decoded;
  try {
    decoded = verifyJwt(selectionToken);
  } catch {
    throw new AppError('This sign-in has expired. Please sign in again.', 401);
  }
  if (decoded.tenantChoice !== true || !decoded.userId) {
    throw new AppError('This sign-in has expired. Please sign in again.', 401);
  }

  const user = await userDb.findUserById(decoded.userId);
  if (!user?.isActive) throw new AppError('This sign-in has expired. Please sign in again.', 401);

  await completeLogin(req, res, user, 200, 'Login successful', { tenantId });
});

export const logout = asyncHandler(async (req, res) => {
  await revokeSessionByToken(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(200).json({ status: 'success', message: 'Logged out successfully', data: null });
});

export const getMe = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Not authenticated', 401);

  const user = await userDb.findUserById(userId);
  if (!user) throw new AppError('User not found', 404);

  const workspace = isCustomer(user)
    ? customerWorkspace(user)
    : await membershipDb.findUsableMembership(user.id, req.headers['x-tenant-id']);
  if (!workspace) throw new AppError('Your session has expired. Please sign in again.', 401);

  res.status(200).json({ status: 'success', data: { user: { ...user, ...publicUser(user, workspace) } } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new AppError('Both passwords are required', 400);

  const rows = await prisma.$queryRaw`
    SELECT id, password FROM crm_users."User" WHERE id = ${userId} LIMIT 1
  `;
  const user = rows[0];
  if (!user) throw new AppError('User not found', 404);

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new AppError('Current password is incorrect', 401);
  if (currentPassword === newPassword) throw new AppError('New password must be different', 400);

  const hashed = await bcrypt.hash(newPassword, 12);
  await userDb.updatePassword(userId, hashed);
  await revokeUserSessions(userId);

  const updated = await userDb.findUserById(userId);
  emailService.sendPasswordChanged(updated);

  await completeLogin(req, res, updated, 200, 'Password changed successfully', { tenantId: req.headers['x-tenant-id'] });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new AppError('Email is required', 400);
  await enforceLimits(res, [
    ['reset-ip', clientIp(req), LIMITS.resetIp],
    ['reset-account', email, LIMITS.resetAccount],
  ]);

  // Same answer whether or not the account exists, so this cannot be used to discover accounts.
  const sent = { status: 'success', message: 'If an account exists with this email, a password reset link will be sent.' };
  const user = await userDb.findUserByEmail(email.toLowerCase().trim());
  if (!user) return res.status(200).json(sent);

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(resetToken);
  const expireDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await userDb.setResetPasswordToken(user.id, hashedToken, expireDate);

  try {
    await emailService.sendPasswordReset(user, resetToken);
    res.status(200).json(sent);
  } catch {
    await prisma.$executeRaw`
      UPDATE crm_users."User" SET "resetPasswordToken"=NULL,"resetPasswordExpire"=NULL WHERE id=${user.id}
    `;
    throw new AppError('Email could not be sent. Please try again later.', 500);
  }
});

const INVITE_LINK_HOURS = 72;
const RESET_LINK_HOURS = 24;
const STAFF_ROLES = new Set(['admin', 'salesRep', 'vendor', 'superAdmin']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSuper = (role, flag) => role === 'superAdmin' || flag === true || flag === 'true';

/** Emails a staff member a one-time link to set their password (new invite, or an admin-requested reset). */
export const sendSetPasswordLink = asyncHandler(async (req, res) => {
  const actor = {
    id: req.headers['x-user-id'],
    role: req.headers['x-user-role'],
    isSuperAdmin: req.headers['x-user-is-super-admin'],
  };
  if (!actor.id) throw new AppError('Not authenticated', 401);
  if (!['admin', 'superAdmin'].includes(actor.role) && !isSuper(actor.role, actor.isSuperAdmin)) {
    throw new AppError("You don't have permission to do that.", 403);
  }

  const { userId } = req.params;
  if (!UUID.test(userId)) throw new AppError('User not found', 404);
  if (userId === actor.id) throw new AppError('Use "Change password" in your profile instead.', 400);

  // Only people in the admin's own agency, judged by their role in that agency.
  const membership = await membershipDb.findMembership(userId, req.headers['x-tenant-id']);
  const user = membership && (await userDb.findUserById(userId));
  if (!user || !STAFF_ROLES.has(membership.role)) throw new AppError('User not found', 404);
  if (isSuper(membership.role, membership.isOwner) && !isSuper(actor.role, actor.isSuperAdmin)) {
    throw new AppError("You don't have permission to do that.", 403);
  }
  if (!user.isActive || membership.status === 'suspended') {
    throw new AppError('This account is deactivated. Activate it first.', 409);
  }

  await enforceLimits(res, [['set-password-link', user.id, { limit: 5, windowSeconds: 60 * 60 }]]);

  const invite = !user.lastLogin;
  const hours = invite ? INVITE_LINK_HOURS : RESET_LINK_HOURS;
  const token = crypto.randomBytes(32).toString('hex');
  await userDb.setResetPasswordToken(user.id, hashToken(token), new Date(Date.now() + hours * 60 * 60 * 1000));

  try {
    await emailService.sendSetPasswordLink(user, token, { invite, hours });
  } catch (err) {
    await userDb.setResetPasswordToken(user.id, null, null);
    req.log?.error({ err, requestId: req.requestId }, 'Failed to send set-password email');
    throw new AppError('The email could not be sent. Please try again later.', 502);
  }

  res.status(200).json({ status: 'success', message: invite ? 'Invitation sent' : 'Password reset email sent', data: { invite } });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError('Password must be between 8 and 128 characters.', 400);
  }
  const hashedToken = hashToken(req.params.token);

  const user = await userDb.findUserByResetToken(hashedToken);
  if (!user) throw new AppError('Invalid or expired reset token', 400);
  if (!user.isActive) throw new AppError('Your account has been deactivated. Please contact support.', 403);

  const hashed = await bcrypt.hash(password, 12);
  await userDb.updatePassword(user.id, hashed);
  await revokeUserSessions(user.id);
  await membershipDb.activateInvitedMemberships(user.id);

  const updated = await userDb.findUserById(user.id);
  emailService.sendPasswordChanged(updated);

  await completeLogin(req, res, updated, 200, 'Password reset successful');
});

export const resetTempPassword = asyncHandler(async (req, res) => {
  const { email, currentPassword, newPassword, confirmPassword } = req.body;
  if (!email || !currentPassword || !newPassword) throw new AppError('Email, temporary password and new password are required', 400);
  if (newPassword !== confirmPassword) throw new AppError('Passwords do not match', 400);
  await enforceLoginLimits(req, res, email);

  const rows = await prisma.$queryRaw`
    SELECT id, name, email, role::text AS role, "isSuperAdmin", permissions, password, "isTempPassword"
    FROM crm_users."User" WHERE email = ${email.toLowerCase().trim()} LIMIT 1
  `;
  const user = rows[0];
  // One answer for every failure, so this cannot be used to discover accounts.
  const invalid = () => new AppError('Invalid email or temporary password', 401);
  if (!user?.isTempPassword) throw invalid();
  if (!(await bcrypt.compare(currentPassword, user.password))) throw invalid();
  await rateLimit.clear('login-account', email);

  const hashed = await bcrypt.hash(newPassword, 12);
  await userDb.updatePassword(user.id, hashed);
  await revokeUserSessions(user.id);

  const updated = await userDb.findUserById(user.id);
  emailService.sendPasswordChanged(updated);

  res.status(200).json({
    status: 'success',
    message: 'Password reset successful. You can now log in with your new password.',
    data: { user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } },
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const hashedToken = hashToken(req.params.token);
  const user = await userDb.findUserByVerificationToken(hashedToken);
  if (!user) throw new AppError('Invalid or expired verification token', 400);

  await userDb.markEmailVerified(user.id);
  res.status(200).json({ status: 'success', message: 'Email verified successfully' });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  const user = await userDb.findUserById(userId);
  if (!user) throw new AppError('User not found', 404);
  if (user.isEmailVerified) throw new AppError('Email is already verified', 400);

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerification = hashToken(verificationToken);
  const verificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await userDb.setEmailVerificationToken(user.id, hashedVerification, verificationExpire);

  try {
    await emailService.sendEmailVerification(user, verificationToken);
    res.status(200).json({ status: 'success', message: 'Verification email sent' });
  } catch {
    throw new AppError('Email could not be sent. Please try again.', 500);
  }
});

export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { name, phone } = req.body;

  await userDb.updateUserProfile(userId, { name, phone });
  const updated = await userDb.findUserById(userId);

  res.status(200).json({ status: 'success', message: 'Profile updated', data: { user: updated } });
});

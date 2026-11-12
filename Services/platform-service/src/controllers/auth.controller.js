import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import logger from '../config/logger.js';
import * as staff from '../db/staff.js';
import { verifyCode } from '../security/totp.js';
import { open } from '../security/secretBox.js';
import { hashToken, issueChallenge, newSessionToken, readChallenge } from '../security/tokens.js';
import { MAX_LENGTH, passwordProblem } from '../security/password.js';

export const SESSION_COOKIE = 'platform_session';
export const COOKIE_PATH = '/api/v1/platform';
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

const WRONG_LOGIN = 'Email or password is incorrect.';
const LOCKED = 'Too many attempts. Please wait 15 minutes and try again.';
const WRONG_CODE = 'That code is incorrect or has expired.';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().min(1).max(200),
}).strict();

const mfaSchema = z.object({
  challenge: z.string().min(10).max(1000),
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
}).strict();

const parse = (schema, body) => {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new AppError("We couldn't process that request. Please check the details and try again.", 400);
  return parsed.data;
};

const isLocked = (user) => user.lockedUntil && new Date(user.lockedUntil) > new Date();

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: COOKIE_PATH,
});

async function audit(req, actor, entry) {
  try {
    await staff.recordPlatformAudit(req, actor, entry);
  } catch (err) {
    (req.log || logger).error({ err: { message: err.message, code: err.code }, action: entry.action, requestId: req.requestId }, 'platform audit write failed');
  }
}

/** Step 1: email and password. Success only proves the password; it returns a short-lived challenge. */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await staff.findStaffByEmail(email);

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.isActive) throw new AppError(WRONG_LOGIN, 401);
  if (isLocked(user)) throw new AppError(LOCKED, 429);
  if (!passwordOk) {
    await staff.recordFailedAttempt(user.id, { maxAttempts: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    throw new AppError(WRONG_LOGIN, 401);
  }
  if (user.authenticatorSetupRequired) {
    throw new AppError('Finish authenticator setup using the link sent to your email.', 403, { code: 'AUTHENTICATOR_SETUP_REQUIRED' });
  }

  res.json({ status: 'success', data: { mfaRequired: true, challenge: issueChallenge(user.id) } });
});

/** Step 2: the authenticator code. Success starts a session. */
export const verifyMfa = asyncHandler(async (req, res) => {
  const { challenge, code } = parse(mfaSchema, req.body);
  const userId = readChallenge(challenge);
  if (!userId) throw new AppError('Your sign-in has expired. Please start again.', 401);

  const user = await staff.findStaffById(userId);
  if (!user || !user.isActive) throw new AppError('Your sign-in has expired. Please start again.', 401);
  if (isLocked(user)) throw new AppError(LOCKED, 429);

  const step = verifyCode(open(user.totpSecret), code, { lastUsedStep: Number(user.lastTotpStep) });
  if (step === null || !(await staff.recordSuccessfulLogin(user.id, step))) {
    await staff.recordFailedAttempt(user.id, { maxAttempts: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    throw new AppError(WRONG_CODE, 401);
  }

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await staff.createSession({
    platformUserId: user.id,
    tokenHash: hashToken(token),
    ipAddress: req.headers['x-client-ip'] ?? req.ip ?? null,
    userAgent: String(req.get('user-agent') ?? '').slice(0, 300) || null,
    expiresAt,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), expires: expiresAt });

  const actor = { id: user.id, email: user.email, role: user.role };
  await audit(req, actor, { action: 'platform.signed_in', targetType: 'platform_user', targetId: user.id, summary: `${user.email} signed in to the console` });
  res.json({
    status: 'success',
    data: { user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: Boolean(user.mustChangePassword) } },
  });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_LENGTH),
  newPassword: z.string().min(1).max(MAX_LENGTH),
}).strict();

/** Replaces a temporary password at first sign-in, or changes it any time after. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await staff.findStaffById(req.platformUser.id);
  if (!user || !user.isActive) throw new AppError('Your session has expired. Please sign in again.', 401);
  if (isLocked(user)) throw new AppError(LOCKED, 429);

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    await staff.recordFailedAttempt(user.id, { maxAttempts: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    throw new AppError('Your current password is incorrect.', 400);
  }
  const problem = passwordProblem(newPassword, { email: user.email, current: currentPassword });
  if (problem) throw new AppError(problem, 400);

  await staff.setOwnPassword(user.id, await bcrypt.hash(newPassword, 12), req.platformSessionId);
  const actor = { id: user.id, email: user.email, role: user.role };
  await audit(req, actor, {
    action: user.mustChangePassword ? 'platform.password_set' : 'platform.password_changed',
    targetType: 'platform_user', targetId: user.id,
    summary: `${user.email} ${user.mustChangePassword ? 'set their own console password' : 'changed their console password'}`,
  });
  res.json({ status: 'success', data: { user: { ...req.platformUser, mustChangePassword: false } } });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await staff.revokeSession(hashToken(token));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ status: 'success', data: {} });
});

export const me = (req, res) => res.json({ status: 'success', data: { user: req.platformUser } });

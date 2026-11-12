import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as staff from '../db/staff.js';
import { generateSecret, otpauthUri, verifyCode } from '../security/totp.js';
import { seal, open } from '../security/secretBox.js';
import { hashToken, newSessionToken } from '../security/tokens.js';
import { MAX_LENGTH, passwordProblem } from '../security/password.js';
import { sendPlatformSetupEmail } from '../utils/email.client.js';
import logger from '../config/logger.js';

const SETUP_TTL_HOURS = 48;
const ROLE = ['platform_admin', 'support'];
const idSchema = z.object({ id: z.string().uuid() }).strict();
const createSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(ROLE),
}).strict();
const roleSchema = z.object({ role: z.enum(ROLE) }).strict();
const setupSchema = z.object({
  token: z.string().min(32).max(100),
  code: z.string().regex(/^\d{6}$/),
  password: z.string().min(1).max(MAX_LENGTH).optional(),
}).strict();
const parse = (schema, value) => {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new AppError(result.error.issues[0]?.message || 'Check the details and try again.', 400);
  return result.data;
};
const issueSetup = () => {
  const token = newSessionToken();
  const secret = generateSecret();
  return {
    token,
    tokenHash: hashToken(token),
    totpSecret: seal(secret),
    expiresAt: new Date(Date.now() + SETUP_TTL_HOURS * 60 * 60 * 1000),
  };
};
async function recordAudit(req, actor, entry) {
  try {
    await staff.recordPlatformAudit(req, actor, entry);
  } catch (err) {
    (req.log || logger).error({ err: { message: err.message, code: err.code }, action: entry.action, requestId: req.requestId }, 'platform staff audit write failed');
  }
}

const audit = (req, action, targetId, summary, details) => recordAudit(req, req.platformUser, {
  action, targetType: 'platform_user', targetId, summary, details,
});

async function sendSetupEmail(req, user, token, purpose) {
  try {
    await sendPlatformSetupEmail({ user, token, purpose });
  } catch (err) {
    req.log?.error({ err: { message: err.message, code: err.code }, requestId: req.requestId }, 'platform staff setup email failed');
    throw new AppError('The account was saved, but the setup email could not be sent. Ask an administrator to retry.', 502);
  }
}

export const listStaff = asyncHandler(async (_req, res) => {
  res.json({ status: 'success', data: await staff.listPlatformStaff() });
});

export const createStaff = asyncHandler(async (req, res) => {
  const input = parse(createSchema, req.body);
  if (await staff.findStaffByEmail(input.email)) throw new AppError('A Console account already uses that email.', 409);
  const setup = issueSetup();
  let created;
  try {
    created = await staff.createPlatformStaff({
      ...input,
      passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12),
      totpSecret: setup.totpSecret,
      setupTokenHash: setup.tokenHash,
      setupTokenExpiresAt: setup.expiresAt,
    });
  } catch (err) {
    if (err.code === '23505') throw new AppError('A Console account already uses that email.', 409);
    throw err;
  }
  await audit(req, 'platform.staff_invited', created.id, `Invited ${created.email} to the Lush Console`, { role: created.role });
  await sendSetupEmail(req, created, setup.token, 'invite');
  res.status(201).json({ status: 'success', data: created });
});

export const resendInvite = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  const current = await staff.findPlatformStaff(id);
  if (!current) throw new AppError("We couldn't find that staff member.", 404);
  if (current.isActive || current.setupPurpose !== 'invite') throw new AppError('Only a pending invitation can be resent.', 409);
  const setup = issueSetup();
  const updated = await staff.rotateStaffSetup({
    id, totpSecret: setup.totpSecret, setupTokenHash: setup.tokenHash, setupTokenExpiresAt: setup.expiresAt, purpose: 'invite',
  });
  if (!updated) throw new AppError('This invitation changed. Refresh the staff list and try again.', 409);
  await sendSetupEmail(req, updated, setup.token, 'invite');
  await audit(req, 'platform.staff_invite_resent', id, `Resent the Console invitation to ${updated.email}`);
  res.json({ status: 'success', data: updated });
});

export const changeStaffRole = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  const { role } = parse(roleSchema, req.body);
  if (id === req.platformUser.id) throw new AppError('You cannot change your own Console role.', 409);
  const current = await staff.findPlatformStaff(id);
  if (!current) throw new AppError("We couldn't find that staff member.", 404);
  const result = await staff.updatePlatformStaffRole(id, role);
  if (result === 'last_admin') throw new AppError('The Console must keep at least one active platform admin.', 409);
  if (result === 'not_found') throw new AppError("We couldn't find that staff member.", 404);
  await audit(req, 'platform.staff_role_changed', id, `Changed ${current.email}'s Console role`, { from: current.role, to: role });
  res.json({ status: 'success', data: { ...current, role } });
});

export const resetAuthenticator = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  if (id === req.platformUser.id) throw new AppError('Ask another platform admin to reset your authenticator.', 409);
  const current = await staff.findPlatformStaff(id);
  if (!current) throw new AppError("We couldn't find that staff member.", 404);
  if (!current.isActive) throw new AppError('Activate this staff account before resetting its authenticator.', 409);
  const setup = issueSetup();
  const updated = await staff.rotateStaffSetup({
    id, totpSecret: setup.totpSecret, setupTokenHash: setup.tokenHash, setupTokenExpiresAt: setup.expiresAt, purpose: 'authenticator_reset',
  });
  if (!updated) throw new AppError('This account changed. Refresh the staff list and try again.', 409);
  await audit(req, 'platform.staff_authenticator_reset', id, `Reset the Console authenticator for ${updated.email}`);
  await sendSetupEmail(req, updated, setup.token, 'authenticator_reset');
  res.json({ status: 'success', data: updated });
});

export const deactivateStaff = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  if (id === req.platformUser.id) throw new AppError('You cannot deactivate your own Console account.', 409);
  const current = await staff.findPlatformStaff(id);
  if (!current) throw new AppError("We couldn't find that staff member.", 404);
  if (!current.isActive && current.setupPurpose !== 'invite') throw new AppError('This staff account is already inactive.', 409);
  const result = await staff.deactivatePlatformStaff(id);
  if (result === 'last_admin') throw new AppError('The Console must keep at least one active platform admin.', 409);
  if (result === 'not_found') throw new AppError("We couldn't find that staff member.", 404);
  await audit(req, 'platform.staff_deactivated', id, `Deactivated ${current.email}'s Console account`);
  res.json({ status: 'success', data: { ...current, isActive: false } });
});

export const deleteStaff = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  if (id === req.platformUser.id) throw new AppError('You cannot delete your own Console account.', 409);
  const result = await staff.deletePlatformStaff(id, {
    actor: req.platformUser,
    ipAddress: req.headers['x-client-ip'] ?? req.ip ?? null,
    requestId: req.requestId ?? null,
  });
  if (result.result === 'not_found') throw new AppError("We couldn't find that staff member.", 404);
  if (result.result === 'last_admin') throw new AppError('The Console must keep at least one active platform admin.', 409);
  res.json({ status: 'success', data: { ...result.staff, deleted: true } });
});

export const getSetup = asyncHandler(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(32).max(100) }).strict(), req.body);
  const user = await staff.findSetupByTokenHash(hashToken(token));
  if (!user) throw new AppError('This setup link is invalid or expired. Ask your administrator to send another.', 410);
  const secret = open(user.totpSecret);
  res.json({ status: 'success', data: {
    email: user.email, name: user.name, purpose: user.setupPurpose,
    requiresPassword: user.setupPurpose === 'invite', secret,
    otpauthUri: otpauthUri({ secret, account: user.email }),
  } });
});

export const completeSetup = asyncHandler(async (req, res) => {
  const input = parse(setupSchema, req.body);
  const setupTokenHash = hashToken(input.token);
  const user = await staff.findSetupByTokenHash(setupTokenHash);
  if (!user) throw new AppError('This setup link is invalid or expired. Ask your administrator to send another.', 410);
  if (user.setupPurpose === 'invite' && !input.password) throw new AppError('Choose a password to finish setting up your account.', 400);
  if (user.setupPurpose === 'authenticator_reset' && input.password) throw new AppError('Do not include a password for an authenticator reset.', 400);
  if (input.password) {
    const problem = passwordProblem(input.password, { email: user.email });
    if (problem) throw new AppError(problem, 400);
  }
  const step = verifyCode(open(user.totpSecret), input.code, { lastUsedStep: Number(user.lastTotpStep) });
  if (step === null) throw new AppError('That authenticator code is incorrect or has expired.', 400);
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
  const activated = await staff.completePlatformStaffSetup({ id: user.id, setupTokenHash, totpStep: step, passwordHash });
  if (!activated) throw new AppError('This setup link has already been used or expired.', 409);
  await recordAudit(req, activated, {
    action: user.setupPurpose === 'invite' ? 'platform.staff_activated' : 'platform.staff_authenticator_reset_completed',
    targetType: 'platform_user', targetId: activated.id,
    summary: user.setupPurpose === 'invite' ? `${activated.email} activated their Console account` : `${activated.email} reset their Console authenticator`,
  });
  res.json({ status: 'success', data: { completed: true } });
});
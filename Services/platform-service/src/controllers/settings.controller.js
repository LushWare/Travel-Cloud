import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as settings from '../db/settings.js';

const signupApprovalSchema = z.object({ enabled: z.boolean() }).strict();

/** Lushware-wide switches the Console shows. */
export const getSettings = asyncHandler(async (_req, res) => {
  res.json({ status: 'success', data: { requireSignupApproval: await settings.getSignupApprovalRequired() } });
});

/** Turns "new sign-ups need approval" on or off. Agencies already waiting stay waiting either way. */
export const setSignupApproval = asyncHandler(async (req, res) => {
  const parsed = signupApprovalSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError('Say whether new sign-ups need approval.', 400);
  const { enabled } = parsed.data;
  await settings.setSignupApprovalRequired(enabled, {
    actorId: req.platformUser.id,
    actorEmail: req.platformUser.email,
    actorRole: `platform:${req.platformUser.role}`.slice(0, 32),
    ipAddress: req.headers['x-client-ip'] ?? req.ip ?? null,
    requestId: req.requestId ?? null,
  });
  res.json({ status: 'success', data: { requireSignupApproval: enabled } });
});

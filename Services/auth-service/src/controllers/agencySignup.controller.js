import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as rateLimit from '../services/rateLimit.service.js';
import * as emailService from '../utils/email.js';
import * as userDb from '../db/userQueries.js';
import { completeLogin } from './auth.controller.js';
import {
  createAgencySignup,
  listSignupPlans,
  resendAgencySignupCode,
  verifyAgencySignup,
} from '../services/agencySignup.service.js';

const signupSchema = z.object({
  agencyName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(50),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  planKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
}).strict();

const verificationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
}).strict();

const emailSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict();

const clientIp = (req) => req.get('x-client-ip') || req.ip;

async function enforceLimits(res, checks) {
  const results = await Promise.all(checks.map(([scope, value, limit]) => rateLimit.hit(scope, value, limit)));
  const blocked = results.filter((result) => !result.allowed);
  if (blocked.length) {
    res.set('Retry-After', String(Math.max(...blocked.map((result) => result.retryAfterSeconds))));
    throw new AppError('Too many attempts. Please wait a few minutes and try again.', 429);
  }
}

function parse(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(message, 400);
  return result.data;
}

export const getSignupPlans = asyncHandler(async (_req, res) => {
  const plans = await listSignupPlans();
  if (!plans.some((plan) => plan.key === 'growth')) {
    throw new AppError('Plan signup is temporarily unavailable.', 503);
  }
  res.json({ status: 'success', data: plans });
});

export const registerAgency = asyncHandler(async (req, res) => {
  const input = parse(signupSchema, req.body, 'Check the agency signup details.');
  await enforceLimits(res, [
    ['agency-signup-ip', clientIp(req), { limit: 5, windowSeconds: 60 * 60 }],
    ['agency-signup-email', input.email, { limit: 3, windowSeconds: 60 * 60 }],
  ]);

  const signup = await createAgencySignup({
    ...input,
    ipAddress: clientIp(req),
    requestId: req.requestId,
  });

  try {
    await emailService.sendAgencySignupCode(
      { name: signup.ownerName, email: signup.email },
      signup.code,
    );
  } catch (error) {
    req.log?.error?.({ err: error, requestId: req.requestId }, 'Agency signup verification email failed');
    throw new AppError('We could not send the verification code. Try resending it shortly.', 502);
  }

  res.status(201).json({
    status: 'success',
    message: 'Enter the verification code sent to your email.',
    data: { email: signup.email, verificationRequired: true },
  });
});

export const verifyAgencySignupCode = asyncHandler(async (req, res) => {
  const input = parse(verificationSchema, req.body, 'Enter a valid email address and six-digit code.');
  await enforceLimits(res, [
    ['agency-signup-verify-ip', clientIp(req), { limit: 20, windowSeconds: 15 * 60 }],
    ['agency-signup-verify-email', input.email, { limit: 5, windowSeconds: 15 * 60 }],
  ]);

  const userId = await verifyAgencySignup(input);
  const user = await userDb.findUserById(userId);
  if (!user) throw new AppError('The signup could not be completed. Please sign in or contact support.', 500);
  await completeLogin(req, res, user, 200, 'Email verified. Your agency is ready.');
});

export const resendAgencySignupCodeHandler = asyncHandler(async (req, res) => {
  const { email } = parse(emailSchema, req.body, 'Enter a valid email address.');
  await enforceLimits(res, [
    ['agency-signup-resend-ip', clientIp(req), { limit: 10, windowSeconds: 60 * 60 }],
    ['agency-signup-resend-email', email, { limit: 3, windowSeconds: 60 * 60 }],
  ]);

  const signup = await resendAgencySignupCode(email);
  if (signup) {
    try {
      await emailService.sendAgencySignupCode(signup.user, signup.code);
    } catch (error) {
      req.log?.error?.({ err: error, requestId: req.requestId }, 'Agency signup verification resend failed');
      throw new AppError('We could not send the verification code. Try again shortly.', 502);
    }
  }
  res.json({
    status: 'success',
    message: 'If an unfinished signup exists for that email, a new verification code has been sent.',
  });
});

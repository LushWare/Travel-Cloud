import crypto from 'node:crypto';
import AppError from '../utils/appError.js';

export const requireToolSecret = (req, res, next) => {
  const secret = process.env.ELEVENLABS_TOOL_SECRET;
  if (!secret) {
    req.log?.error('ELEVENLABS_TOOL_SECRET is not configured — rejecting tool call');
    return next(new AppError('Tool call verification unavailable', 503));
  }

  const provided = req.get('x-elevenlabs-tool-secret') || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(secret));
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    req.log?.warn({ path: req.path }, 'Rejected tool call with an invalid or missing shared secret');
    return next(new AppError('Unauthorized', 401));
  }

  next();
};

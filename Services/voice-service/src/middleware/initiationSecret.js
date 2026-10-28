import crypto from 'node:crypto';
import AppError from '../utils/appError.js';

export const requireInitiationSecret = (req, res, next) => {
  const secret = process.env.ELEVENLABS_INITIATION_SECRET;
  if (!secret) {
    req.log?.error('ELEVENLABS_INITIATION_SECRET is not configured — rejecting initiation webhook');
    return next(new AppError('Webhook verification unavailable', 503));
  }

  const provided = req.get('x-elevenlabs-init-secret') || '';
  const actual = Buffer.from(String(provided));
  const expected = Buffer.from(String(secret));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    req.log?.warn({ path: req.path }, 'Rejected initiation webhook with an invalid shared secret');
    return next(new AppError('Unauthorized', 401));
  }

  next();
};
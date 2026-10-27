import { timingSafeEqual } from 'node:crypto';
import AppError from '../utils/appError.js';

export function requireInternalToken(req, res, next) {
  const expectedBytes = Buffer.from(process.env.INTERNAL_EVENTS_TOKEN || '');
  const providedBytes = Buffer.from(req.get('x-internal-token') || '');
  const valid = expectedBytes.length > 0 && expectedBytes.length === providedBytes.length
    && timingSafeEqual(expectedBytes, providedBytes);
  if (!valid) return next(new AppError('Not authorized', 401));
  return next();
}
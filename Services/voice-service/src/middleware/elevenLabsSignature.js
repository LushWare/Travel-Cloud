import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import AppError from '../utils/appError.js';

const elevenLabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY || 'signature-verification-only',
});

export async function verifyElevenLabsSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  try {
    await elevenLabs.webhooks.constructEvent(body, String(signature), secret);
    return true;
  } catch {
    return false;
  }
}

export const requireElevenLabsSignature = async (req, res, next) => {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    req.log?.error('ELEVENLABS_WEBHOOK_SECRET is not configured — rejecting webhook');
    return next(new AppError('Webhook verification unavailable', 503));
  }

  const ok = await verifyElevenLabsSignature(
    req.rawBody,
    req.get('elevenlabs-signature'),
    secret,
  );
  if (!ok) {
    req.log?.warn({ path: req.path }, 'Rejected webhook with invalid ElevenLabs signature');
    return next(new AppError('Invalid webhook signature', 401));
  }

  next();
};
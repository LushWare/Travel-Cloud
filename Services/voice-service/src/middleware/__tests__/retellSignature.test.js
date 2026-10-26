import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifyElevenLabsSignature, requireElevenLabsSignature } from '../elevenLabsSignature.js';

const SECRET = 'key_test_secret';
const BODY = JSON.stringify({ type: 'post_call_transcription', data: { conversation_id: 'abc' } });
const raw = Buffer.from(BODY);

const sign = (body = BODY, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) => {
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v0=${digest}`;
};

describe('verifyElevenLabsSignature', () => {
  it('accepts an ElevenLabs HMAC signature over the raw body', async () => {
    expect(await verifyElevenLabsSignature(raw, sign(), SECRET)).toBe(true);
  });

  it('accepts a raw body passed as a string rather than a Buffer', async () => {
    expect(await verifyElevenLabsSignature(BODY, sign(), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', async () => {
    expect(await verifyElevenLabsSignature(raw, sign(BODY, 'other_key'), SECRET)).toBe(false);
  });

  it('rejects a valid signature replayed against a tampered body', async () => {
    const sig = sign();
    expect(await verifyElevenLabsSignature(Buffer.from('{"type":"tampered"}'), sig, SECRET)).toBe(false);
  });

  it('rejects a signature older than the SDK replay window', async () => {
    const stale = sign(BODY, SECRET, Math.floor(Date.now() / 1000) - 31 * 60);
    expect(await verifyElevenLabsSignature(raw, stale, SECRET)).toBe(false);
  });

  it('accepts a signature inside the replay window', async () => {
    const recent = sign(BODY, SECRET, Math.floor(Date.now() / 1000) - 60);
    expect(await verifyElevenLabsSignature(raw, recent, SECRET)).toBe(true);
  });

  it('rejects a bare hex digest without the ElevenLabs signature format', async () => {
    expect(await verifyElevenLabsSignature(raw, 'a'.repeat(64), SECRET)).toBe(false);
  });

  it('rejects a malformed signature instead of throwing', async () => {
    expect(await verifyElevenLabsSignature(raw, 'not-a-signature', SECRET)).toBe(false);
  });

  it('rejects a missing signature', async () => {
    expect(await verifyElevenLabsSignature(raw, undefined, SECRET)).toBe(false);
  });

  it('rejects a missing raw body', async () => {
    expect(await verifyElevenLabsSignature(undefined, sign(), SECRET)).toBe(false);
  });

  it('rejects when no secret is configured', async () => {
    expect(await verifyElevenLabsSignature(raw, sign(), undefined)).toBe(false);
  });
});

describe('requireElevenLabsSignature', () => {
  const originalEnv = process.env.ELEVENLABS_WEBHOOK_SECRET;
  let req; let next;

  beforeEach(async () => {
    process.env.ELEVENLABS_WEBHOOK_SECRET = SECRET;
    next = vi.fn();
    const sig = sign();
    req = {
      rawBody: raw,
      path: '/post-call',
      log: { warn: vi.fn(), error: vi.fn() },
      get: vi.fn(() => sig),
    };
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    else process.env.ELEVENLABS_WEBHOOK_SECRET = originalEnv;
  });

  it('calls next with no error for a valid signature', async () => {
    await requireElevenLabsSignature(req, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects an invalid signature with status 401', async () => {
    req.get = vi.fn(() => 't=123,v0=' + 'a'.repeat(64));
    await requireElevenLabsSignature(req, {}, next);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  it('rejects with 503 when the secret is not configured', async () => {
    delete process.env.ELEVENLABS_WEBHOOK_SECRET;
    await requireElevenLabsSignature(req, {}, next);
    expect(next.mock.calls[0][0].statusCode).toBe(503);
  });

  it('rejects an unsigned request even outside production', async () => {
    process.env.NODE_ENV = 'development';
    req.get = vi.fn(() => undefined);
    await requireElevenLabsSignature(req, {}, next);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});

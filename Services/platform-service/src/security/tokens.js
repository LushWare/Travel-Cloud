import crypto from 'node:crypto';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const challengeKey = (raw = process.env.PLATFORM_CHALLENGE_SECRET) => {
  if (!raw || raw.length < 32) throw new Error('PLATFORM_CHALLENGE_SECRET must be at least 32 characters');
  return raw;
};

const sign = (payload, key) => crypto.createHmac('sha256', challengeKey(key)).update(payload).digest('base64url');

/**
 * Proof that the password step passed, good for five minutes and only for the second step.
 * It carries no session power on its own.
 */
export function issueChallenge(userId, { nowMs = Date.now(), key = process.env.PLATFORM_CHALLENGE_SECRET } = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: nowMs + CHALLENGE_TTL_MS, purpose: 'platform-mfa' })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

/** The user id the challenge was issued for, or null if it is forged, malformed or expired. */
export function readChallenge(token, { nowMs = Date.now(), key = process.env.PLATFORM_CHALLENGE_SECRET } = {}) {
  const [payload, signature] = String(token ?? '').split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const { sub, exp, purpose } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (purpose !== 'platform-mfa' || typeof sub !== 'string' || !(exp > nowMs)) return null;
    return sub;
  } catch {
    return null;
  }
}

/** A session token for the cookie; only its hash is stored. */
export const newSessionToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

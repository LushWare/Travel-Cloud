import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, codeAt, currentStep, generateSecret, otpauthUri, verifyCode } from '../totp.js';
import { open, seal, loadKey } from '../secretBox.js';
import { hashToken, issueChallenge, newSessionToken, readChallenge } from '../tokens.js';
import { generatePassword, passwordProblem } from '../password.js';

describe('chosen password rules', () => {
  it('accepts a long passphrase', () => {
    expect(passwordProblem('blue-train-sunset-2026', { email: 'ops@lushware.test' })).toBeNull();
  });

  it.each([
    ['short1!', /at least 12/],
    ['x'.repeat(201), /at most 200/],
    ['aaaaaaaaaaaaaa', /same character/],
    ['Password2026!!', /too easy/],
    ['LUSHWARE-1234567', /too easy/],
  ])('refuses %j', (password, reason) => {
    expect(passwordProblem(password)).toMatch(reason);
  });

  it('refuses a password containing the email name', () => {
    expect(passwordProblem('shaliniavindya-2026', { email: 'shaliniavindya@gmail.com' })).toMatch(/email name/);
  });

  it('refuses reusing the current password', () => {
    expect(passwordProblem('blue-train-sunset-2026', { current: 'blue-train-sunset-2026' })).toMatch(/different/);
  });

  it('refuses a missing password', () => {
    expect(passwordProblem(undefined)).toMatch(/at least 12/);
  });
});

// RFC 6238 appendix B, SHA-1: the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('one-time codes', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('produces the RFC 6238 code at %i seconds', (seconds, expected) => {
    expect(codeAt(RFC_SECRET, currentStep(seconds * 1000))).toBe(expected);
  });

  it('accepts the current code', () => {
    const secret = generateSecret();
    const now = Date.now();

    expect(verifyCode(secret, codeAt(secret, currentStep(now)), { nowMs: now })).toBe(currentStep(now));
  });

  it('accepts the previous code to allow for a slow phone clock', () => {
    const secret = generateSecret();
    const now = Date.now();

    expect(verifyCode(secret, codeAt(secret, currentStep(now) - 1), { nowMs: now })).toBe(currentStep(now) - 1);
  });

  it('refuses a code two steps old', () => {
    const secret = generateSecret();
    const now = Date.now();

    expect(verifyCode(secret, codeAt(secret, currentStep(now) - 2), { nowMs: now })).toBeNull();
  });

  it('refuses a code that was already used', () => {
    const secret = generateSecret();
    const now = Date.now();
    const code = codeAt(secret, currentStep(now));

    expect(verifyCode(secret, code, { nowMs: now, lastUsedStep: currentStep(now) })).toBeNull();
  });

  it.each(['', '12345', '1234567', 'abcdef', null, undefined])('refuses the malformed code %j', (code) => {
    expect(verifyCode(generateSecret(), code)).toBeNull();
  });

  it('round-trips a secret through base32', () => {
    const bytes = crypto.randomBytes(20);

    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('builds a link authenticator apps understand', () => {
    expect(otpauthUri({ secret: 'ABC', account: 'me@lush.test' }))
      .toBe('otpauth://totp/Lush%20Travel%20Cloud%20Console%3Ame%40lush.test?secret=ABC&issuer=Lush%20Travel%20Cloud%20Console&algorithm=SHA1&digits=6&period=30');
  });
});

describe('secret box', () => {
  const key = crypto.randomBytes(32);

  it('returns the original secret after sealing and opening', () => {
    expect(open(seal('JBSWY3DPEHPK3PXP', key), key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('never stores the secret in readable form', () => {
    expect(seal('JBSWY3DPEHPK3PXP', key)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('refuses to open with a different key', () => {
    expect(() => open(seal('secret', key), crypto.randomBytes(32))).toThrow();
  });

  it('refuses a tampered value', () => {
    const parts = seal('secret', key).split(':');
    parts[3] = Buffer.from('tampered').toString('base64');

    expect(() => open(parts.join(':'), key)).toThrow();
  });

  it('refuses a key of the wrong size', () => {
    expect(() => loadKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => loadKey(undefined)).toThrow(/32 bytes/);
  });
});

describe('second-step challenge', () => {
  const key = 'k'.repeat(40);

  it('names the user it was issued for', () => {
    expect(readChallenge(issueChallenge('user-1', { key }), { key })).toBe('user-1');
  });

  it('expires after five minutes', () => {
    const token = issueChallenge('user-1', { key, nowMs: 0 });

    expect(readChallenge(token, { key, nowMs: 5 * 60 * 1000 + 1 })).toBeNull();
  });

  it('refuses a challenge whose user was swapped', () => {
    const [, signature] = issueChallenge('user-1', { key }).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'user-2', exp: Date.now() + 60000, purpose: 'platform-mfa' })).toString('base64url');

    expect(readChallenge(`${forged}.${signature}`, { key })).toBeNull();
  });

  it('refuses a challenge signed with another key', () => {
    expect(readChallenge(issueChallenge('user-1', { key: 'x'.repeat(40) }), { key })).toBeNull();
  });

  it.each(['', 'abc', 'a.b', null])('refuses the malformed challenge %j', (token) => {
    expect(readChallenge(token, { key })).toBeNull();
  });

  it('refuses to work with a short signing secret', () => {
    expect(() => issueChallenge('user-1', { key: 'short' })).toThrow(/32 characters/);
  });
});

describe('generated passwords', () => {
  it('are 23 characters with no lookalike letters or digits', () => {
    const password = generatePassword();

    expect(password).toHaveLength(23);
    expect(password.slice(0, 20)).not.toMatch(/[0O1lI]/);
  });

  it('always include a digit, a lowercase letter and a symbol', () => {
    expect(generatePassword()).toMatch(/-9a$/);
  });

  it('are different every time', () => {
    const many = new Set(Array.from({ length: 200 }, generatePassword));

    expect(many.size).toBe(200);
  });
});

describe('session tokens', () => {
  it('are random and long', () => {
    expect(newSessionToken()).not.toBe(newSessionToken());
    expect(newSessionToken().length).toBeGreaterThanOrEqual(43);
  });

  it('are stored only as a 64-character hash', () => {
    const token = newSessionToken();

    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

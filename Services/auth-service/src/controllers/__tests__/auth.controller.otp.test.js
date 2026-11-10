import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { userDb, prismaMock, sendOTPEmail } = vi.hoisted(() => ({
  userDb: { findUserById: vi.fn() },
  prismaMock: { otp: { deleteMany: vi.fn(), create: vi.fn() } },
  sendOTPEmail: vi.fn(),
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', async () => (await import('./membershipFixture.js')).membershipMock(userDb));
vi.mock('../../services/rateLimit.service.js', () => ({ hit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1 }), clear: vi.fn().mockResolvedValue() }));
vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../services/session.service.js', () => ({}));
vi.mock('../../utils/email.js', () => ({ sendOTPEmail }));

import { resendOTP } from '../auth.controller.js';
import { resetKeysForTests, signJwt } from '../../config/jwtKeys.js';

const signingKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

async function resendWith(tempToken) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  let error;
  await resendOTP({ body: { tempToken }, ip: '1.2.3.4', get: () => 'agent' }, res, (err) => { error = err; });
  return { res, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = signingKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  userDb.findUserById.mockResolvedValue({ id: 'user-1', email: 'rep@test.com', role: 'salesRep' });
  sendOTPEmail.mockResolvedValue();
});

describe('OTP half-login token', () => {
  it('accepts a half-login token issued by auth-service', async () => {
    const { res, error } = await resendWith(signJwt({ userId: 'user-1', tempAuth: true }, '15m'));

    expect(error).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a full login token used in place of a half-login token', async () => {
    const { error } = await resendWith(signJwt({ id: 'user-1', role: 'admin' }, '15m'));

    expect(error.statusCode).toBe(401);
    expect(sendOTPEmail).not.toHaveBeenCalled();
  });

  it('rejects a half-login token made with the old shared secret', async () => {
    const { error } = await resendWith(jwt.sign({ userId: 'user-1', tempAuth: true }, 'old-secret'));

    expect(error.statusCode).toBe(401);
  });

  it('rejects an expired half-login token', async () => {
    const token = signJwt({ userId: 'user-1', tempAuth: true }, '15m');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);

    const { error } = await resendWith(token);
    vi.useRealTimers();

    expect(error.statusCode).toBe(401);
  });
});

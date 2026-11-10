import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { userDb, prismaMock, limiter, email, bcryptCompare } = vi.hoisted(() => ({
  userDb: {
    findUserByEmail: vi.fn(), findUserById: vi.fn(), updateLastLogin: vi.fn(),
    updatePassword: vi.fn(), setResetPasswordToken: vi.fn(),
  },
  prismaMock: {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    otp: { findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
  },
  limiter: { hit: vi.fn(), clear: vi.fn() },
  email: { sendLoginNotification: vi.fn(), sendPasswordReset: vi.fn(), sendPasswordChanged: vi.fn(), sendOTPEmail: vi.fn() },
  bcryptCompare: vi.fn(),
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', async () => (await import('./membershipFixture.js')).membershipMock(userDb));
vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../services/rateLimit.service.js', () => limiter);
vi.mock('../../services/session.service.js', () => ({
  createSession: vi.fn().mockResolvedValue({ token: 'r', expiresAt: new Date(Date.now() + 1e9) }),
  revokeUserSessions: vi.fn(),
}));
vi.mock('../../utils/email.js', () => email);
vi.mock('bcryptjs', () => ({ default: { compare: bcryptCompare, hash: vi.fn().mockResolvedValue('h') } }));

import { forgotPassword, login, loginStep2, resendOTP, resetTempPassword } from '../auth.controller.js';
import { resetKeysForTests, signJwt } from '../../config/jwtKeys.js';

const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ADMIN = { id: 'user-1', name: 'A', email: 'a@test.com', role: 'admin', isActive: true, password: 'h' };
const REP = { ...ADMIN, role: 'salesRep' };
const otpRow = (over = {}) => ({ id: 'otp-1', code: '123456', attempts: 0, expiresAt: new Date(Date.now() + 60_000), ...over });

async function call(handler, { body = {}, headers = {} } = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), set: vi.fn() };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  let error;
  await handler({ body, cookies: {}, ip: '10.0.0.1', get: (name) => lower[name.toLowerCase()] }, res, (err) => { error = err; });
  return { res, error, body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  limiter.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  limiter.clear.mockResolvedValue();
  userDb.updateLastLogin.mockResolvedValue();
  bcryptCompare.mockResolvedValue(true);
  prismaMock.otp.updateMany.mockResolvedValue({ count: 1 });
});

describe('login limits', () => {
  const tryLogin = () => call(login, { body: { email: 'a@test.com', password: 'pw' }, headers: { 'x-client-ip': '203.0.113.9' } });

  it('refuses with 429 once the limit is reached, before checking the password', async () => {
    limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 300 });

    const { error } = await tryLogin();

    expect(error.statusCode).toBe(429);
    expect(bcryptCompare).not.toHaveBeenCalled();
  });

  it('tells the client when to try again', async () => {
    limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 300 });

    const { res } = await tryLogin();

    expect(res.set).toHaveBeenCalledWith('Retry-After', '300');
  });

  it('counts attempts per visitor IP as reported by the gateway', async () => {
    userDb.findUserByEmail.mockResolvedValue(ADMIN);

    await tryLogin();

    expect(limiter.hit).toHaveBeenCalledWith('login-ip', '203.0.113.9', expect.any(Object));
  });

  it('counts attempts per account, whichever IP they come from', async () => {
    userDb.findUserByEmail.mockResolvedValue(ADMIN);

    await tryLogin();

    expect(limiter.hit).toHaveBeenCalledWith('login-account', 'a@test.com', expect.any(Object));
  });

  it('resets the account counter after a correct password', async () => {
    userDb.findUserByEmail.mockResolvedValue(ADMIN);

    await tryLogin();

    expect(limiter.clear).toHaveBeenCalledWith('login-account', 'a@test.com');
  });

  it('keeps the account counter after a wrong password', async () => {
    userDb.findUserByEmail.mockResolvedValue(ADMIN);
    bcryptCompare.mockResolvedValue(false);

    await tryLogin();

    expect(limiter.clear).not.toHaveBeenCalled();
  });
});

describe('OTP guessing', () => {
  const tempToken = () => signJwt({ userId: 'user-1', tempAuth: true }, '15m');
  const verify = (otp) => call(loginStep2, { body: { tempToken: tempToken(), otp } });

  beforeEach(() => {
    userDb.findUserById.mockResolvedValue(REP);
  });

  it('signs in with the right code', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow());

    const { error, res } = await verify('123456');

    expect(error).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a wrong code', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow());

    const { error } = await verify('000000');

    expect(error.statusCode).toBe(401);
  });

  it('counts every guess against the code before comparing it', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow());

    await verify('000000');

    expect(prismaMock.otp.updateMany).toHaveBeenCalledWith({
      where: { id: 'otp-1', isUsed: false, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });
  });

  it('destroys the code after 5 wrong guesses, even if the 6th is right', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow({ attempts: 5 }));
    prismaMock.otp.updateMany.mockResolvedValueOnce({ count: 0 });

    const { error } = await verify('123456');

    expect(error.statusCode).toBe(429);
    expect(prismaMock.otp.deleteMany).toHaveBeenCalledWith({ where: { id: 'otp-1' } });
  });

  it('accepts a code only once when two requests race', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow());
    prismaMock.otp.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const { error } = await verify('123456');

    expect(error.statusCode).toBe(401);
  });

  it('looks up the latest code for the user rather than searching by the guessed value', async () => {
    prismaMock.otp.findFirst.mockResolvedValue(otpRow());

    await verify('999999');

    expect(prismaMock.otp.findFirst.mock.calls[0][0].where).toEqual({ userId: 'user-1', type: 'login', isUsed: false });
  });

  it('limits how often a new code can be emailed', async () => {
    limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const { error } = await call(resendOTP, { body: { tempToken: tempToken() } });

    expect(error.statusCode).toBe(429);
    expect(email.sendOTPEmail).not.toHaveBeenCalled();
  });
});

describe('password reset', () => {
  it('gives the same answer for an unknown email as for a real one', async () => {
    userDb.findUserByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(ADMIN);
    email.sendPasswordReset.mockResolvedValue();

    const unknown = await call(forgotPassword, { body: { email: 'nobody@test.com' } });
    const known = await call(forgotPassword, { body: { email: 'a@test.com' } });

    expect(unknown.body).toEqual(known.body);
  });

  it('limits reset emails per account', async () => {
    limiter.hit.mockImplementation(async (scope) => ({ allowed: scope !== 'reset-account', retryAfterSeconds: 60 }));

    const { error } = await call(forgotPassword, { body: { email: 'a@test.com' } });

    expect(error.statusCode).toBe(429);
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('temporary password change', () => {
  const change = (body) => call(resetTempPassword, {
    body: { email: 'a@test.com', currentPassword: 'temp', newPassword: 'New-pass-1', confirmPassword: 'New-pass-1', ...body },
  });

  it('gives the same answer for an unknown account as for a wrong temporary password', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    const unknown = await change();
    prismaMock.$queryRaw.mockResolvedValueOnce([{ ...ADMIN, isTempPassword: true }]);
    bcryptCompare.mockResolvedValue(false);
    const wrong = await change();

    expect([unknown.error.statusCode, unknown.error.message]).toEqual([wrong.error.statusCode, wrong.error.message]);
  });

  it('is limited like a login, since it checks a password', async () => {
    limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });

    const { error } = await change();

    expect(error.statusCode).toBe(429);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a request without an email instead of crashing', async () => {
    const { error } = await change({ email: undefined });

    expect(error.statusCode).toBe(400);
  });
});

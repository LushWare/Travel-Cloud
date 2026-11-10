import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { userDb, sessions, bcryptCompare, prismaMock } = vi.hoisted(() => ({
  userDb: { findUserByEmail: vi.fn(), findUserById: vi.fn(), updateLastLogin: vi.fn(), updatePassword: vi.fn() },
  sessions: {
    createSession: vi.fn(), consumeSession: vi.fn(), revokeFamily: vi.fn(),
    revokeUserSessions: vi.fn(), revokeSessionByToken: vi.fn(),
  },
  bcryptCompare: vi.fn(),
  prismaMock: { $queryRaw: vi.fn(), otp: {} },
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', async () => (await import('./membershipFixture.js')).membershipMock(userDb));
vi.mock('../../services/session.service.js', () => sessions);
vi.mock('../../services/rateLimit.service.js', () => ({ hit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1 }), clear: vi.fn().mockResolvedValue() }));
vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../utils/email.js', () => ({ sendPasswordChanged: vi.fn(), sendLoginNotification: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: bcryptCompare, hash: vi.fn().mockResolvedValue('hashed') } }));

import { login, refresh, logout, changePassword } from '../auth.controller.js';
import { resetKeysForTests } from '../../config/jwtKeys.js';

const signingKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const verified = (token) => jwt.verify(token, signingKeys.publicKey, { algorithms: ['ES256'] });

const NOW = new Date('2026-11-09T10:00:00.000Z');
const REFRESH_EXPIRES = new Date('2026-11-16T10:00:00.000Z');
const staff = (over = {}) => ({
  id: 'user-1', name: 'Ana', email: 'ana@test.com', role: 'admin', isActive: true, password: 'x', permissions: [], ...over,
});

function mockRes() {
  return {
    cookie: vi.fn(), clearCookie: vi.fn(),
    status: vi.fn().mockReturnThis(), json: vi.fn(),
  };
}

async function run(handler, req = {}) {
  const res = mockRes();
  let error;
  await handler(
    { body: {}, headers: {}, cookies: {}, ip: '1.2.3.4', get: (name) => ({ 'user-agent': 'test-agent' })[name.toLowerCase()], ...req },
    res,
    (err) => { error = err; },
  );
  return { res, error, body: res.json.mock.calls[0]?.[0] };
}

const cookie = (res, name) => res.cookie.mock.calls.find(([n]) => n === name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.JWT_PRIVATE_KEY = signingKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  delete process.env.AUTH_COOKIE_SAMESITE;
  delete process.env.STAFF_ACCESS_TOKEN_TTL;
  process.env.NODE_ENV = 'test';
  userDb.updateLastLogin.mockResolvedValue();
  sessions.createSession.mockResolvedValue({ token: 'refresh-abc', expiresAt: REFRESH_EXPIRES });
  bcryptCompare.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('login', () => {
  const loginAs = (user) => {
    userDb.findUserByEmail.mockResolvedValue(user);
    return run(login, { body: { email: user.email, password: 'pw' } });
  };

  it('does not return the access token in the response body for staff', async () => {
    const { body } = await loginAs(staff());

    expect(body.data.token).toBeUndefined();
    expect(body.data.user.email).toBe('ana@test.com');
  });

  it('sets the access token in an httpOnly cookie', async () => {
    const { res } = await loginAs(staff());

    const [, value, options] = cookie(res, 'token');
    expect(verified(value).id).toBe('user-1');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
  });

  it('gives staff an access token that lasts 15 minutes', async () => {
    const { res } = await loginAs(staff());

    const [, value] = cookie(res, 'token');
    expect(jwt.decode(value).exp - jwt.decode(value).iat).toBe(15 * 60);
  });

  it('keeps the staff access cookie for the whole session so an expired token can be renewed', async () => {
    const { res } = await loginAs(staff());

    expect(cookie(res, 'token')[2].expires).toEqual(REFRESH_EXPIRES);
  });

  it('expires a customer access cookie together with its token', async () => {
    const { res } = await loginAs(staff({ role: 'customer' }));

    expect(cookie(res, 'token')[2].maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('sets the refresh token in an httpOnly cookie scoped to the auth routes', async () => {
    const { res } = await loginAs(staff());

    expect(cookie(res, 'refresh_token')).toEqual(['refresh_token', 'refresh-abc', {
      httpOnly: true, secure: false, sameSite: 'strict', path: '/api/v1/auth', expires: REFRESH_EXPIRES,
    }]);
  });

  it('marks both cookies secure in production', async () => {
    process.env.NODE_ENV = 'production';

    const { res } = await loginAs(staff());

    expect(cookie(res, 'token')[2].secure).toBe(true);
    expect(cookie(res, 'refresh_token')[2].secure).toBe(true);
  });

  it('uses SameSite=None with Secure when configured for cross-site environments', async () => {
    process.env.AUTH_COOKIE_SAMESITE = 'none';

    const { res } = await loginAs(staff());

    expect(cookie(res, 'token')[2]).toMatchObject({ sameSite: 'none', secure: true });
  });

  it('falls back to SameSite=Strict for an unrecognised setting', async () => {
    process.env.AUTH_COOKIE_SAMESITE = 'off';

    const { res } = await loginAs(staff());

    expect(cookie(res, 'token')[2].sameSite).toBe('strict');
  });

  it('still returns the token in the body for website customers', async () => {
    const { body } = await loginAs(staff({ role: 'customer' }));

    expect(verified(body.data.token).role).toBe('customer');
  });

  it('records the client ip and user agent on the new session', async () => {
    await loginAs(staff());

    expect(sessions.createSession).toHaveBeenCalledWith('user-1', {
      familyId: undefined, tenantId: '00000000-0000-4000-8000-000000000001', ipAddress: '1.2.3.4', userAgent: 'test-agent',
    });
  });
});

describe('refresh', () => {
  const withCookie = { cookies: { refresh_token: 'refresh-old' } };

  it('issues a new access cookie for a valid refresh token', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: '00000000-0000-4000-8000-000000000001' });
    userDb.findUserById.mockResolvedValue(staff({ role: 'salesRep' }));

    const { res } = await run(refresh, withCookie);

    expect(verified(cookie(res, 'token')[1]).role).toBe('salesRep');
  });

  it('rotates the refresh token within the same login family', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: '00000000-0000-4000-8000-000000000001' });
    userDb.findUserById.mockResolvedValue(staff());

    const { res } = await run(refresh, withCookie);

    expect(sessions.createSession).toHaveBeenCalledWith('user-1', expect.objectContaining({ familyId: 'fam-1' }));
    expect(cookie(res, 'refresh_token')[1]).toBe('refresh-abc');
  });

  it('does not return a token in the response body', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: '00000000-0000-4000-8000-000000000001' });
    userDb.findUserById.mockResolvedValue(staff());

    const { body } = await run(refresh, withCookie);

    expect(body.data).toEqual({ user: expect.objectContaining({ id: 'user-1' }) });
  });

  it('returns 401 and clears both cookies for an invalid refresh token', async () => {
    sessions.consumeSession.mockResolvedValue(null);

    const { res, error } = await run(refresh, withCookie);

    expect(error.statusCode).toBe(401);
    expect(res.clearCookie.mock.calls.map(([name]) => name)).toEqual(['token', 'refresh_token']);
  });

  it('refuses and revokes the login when the user has been deactivated', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: '00000000-0000-4000-8000-000000000001' });
    userDb.findUserById.mockResolvedValue(staff({ isActive: false }));

    const { error } = await run(refresh, withCookie);

    expect(error.statusCode).toBe(401);
    expect(sessions.revokeFamily).toHaveBeenCalledWith('fam-1');
  });

  it('refuses when the user no longer exists', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: '00000000-0000-4000-8000-000000000001' });
    userDb.findUserById.mockResolvedValue(null);

    const { error } = await run(refresh, withCookie);

    expect(error.statusCode).toBe(401);
    expect(sessions.createSession).not.toHaveBeenCalled();
  });
});

describe('logout', () => {
  it('revokes the session behind the refresh cookie', async () => {
    await run(logout, { cookies: { refresh_token: 'refresh-old' } });

    expect(sessions.revokeSessionByToken).toHaveBeenCalledWith('refresh-old');
  });

  it('clears the refresh cookie on the same path it was set', async () => {
    const { res } = await run(logout, { cookies: { refresh_token: 'refresh-old' } });

    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.objectContaining({ path: '/api/v1/auth' }));
  });

  it('succeeds even without any cookies', async () => {
    const { res, error } = await run(logout);

    expect(error).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('changePassword', () => {
  it('signs the user out of every other session', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'user-1', password: 'old-hash' }]);
    userDb.findUserById.mockResolvedValue(staff());

    await run(changePassword, { headers: { 'x-user-id': 'user-1' }, body: { currentPassword: 'old', newPassword: 'new' } });

    expect(sessions.revokeUserSessions).toHaveBeenCalledWith('user-1');
    expect(sessions.revokeUserSessions.mock.invocationCallOrder[0])
      .toBeLessThan(sessions.createSession.mock.invocationCallOrder[0]);
  });
});

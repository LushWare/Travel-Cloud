import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { userDb, sessions, prismaMock, planModules } = vi.hoisted(() => ({
  userDb: { findUserByEmail: vi.fn(), findUserById: vi.fn(), updateLastLogin: vi.fn(), updatePassword: vi.fn() },
  sessions: {
    createSession: vi.fn(), consumeSession: vi.fn(), revokeFamily: vi.fn(),
    revokeUserSessions: vi.fn(), revokeSessionByToken: vi.fn(),
  },
  prismaMock: { $queryRaw: vi.fn(), otp: {} },
  planModules: { modulesSwitchedOffFor: vi.fn() },
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', async () => (await import('./membershipFixture.js')).membershipMock(userDb));
vi.mock('../../services/session.service.js', () => sessions);
vi.mock('../../services/planModules.service.js', () => planModules);
vi.mock('../../services/rateLimit.service.js', () => ({ hit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1 }), clear: vi.fn().mockResolvedValue() }));
vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../utils/email.js', () => ({ sendPasswordChanged: vi.fn(), sendLoginNotification: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() } }));

import { login, refresh } from '../auth.controller.js';
import { resetKeysForTests } from '../../config/jwtKeys.js';

const signingKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const AGENCY = '00000000-0000-4000-8000-000000000001';
const staff = (over = {}) => ({
  id: 'user-1', name: 'Ana', email: 'ana@test.com', role: 'admin', isActive: true, password: 'x', permissions: [], ...over,
});

async function run(handler, req) {
  const res = { cookie: vi.fn(), clearCookie: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(
    { body: {}, headers: {}, cookies: {}, ip: '1.2.3.4', get: () => 'test-agent', ...req },
    res,
    (err) => { if (err) throw err; },
  );
  return res;
}
const accessClaims = (res) => {
  const [, token] = res.cookie.mock.calls.find(([name]) => name === 'token');
  return jwt.verify(token, signingKeys.publicKey, { algorithms: ['ES256'] });
};
const loginAs = (user) => {
  userDb.findUserByEmail.mockResolvedValue(user);
  return run(login, { body: { email: user.email, password: 'pw' } });
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = signingKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  process.env.NODE_ENV = 'test';
  userDb.updateLastLogin.mockResolvedValue();
  sessions.createSession.mockResolvedValue({ token: 'refresh-abc', expiresAt: new Date(Date.now() + 86_400_000) });
  planModules.modulesSwitchedOffFor.mockResolvedValue([]);
});

describe('plan modules in the staff login token', () => {
  it('lists the modules the agency plan switches off', async () => {
    planModules.modulesSwitchedOffFor.mockResolvedValue(['finance_docs', 'vendors']);

    const res = await loginAs(staff());

    expect(accessClaims(res).off).toEqual(['finance_docs', 'vendors']);
  });

  it('looks the plan up for the agency the login is for', async () => {
    await loginAs(staff());

    expect(planModules.modulesSwitchedOffFor).toHaveBeenCalledWith(AGENCY);
  });

  it('leaves the claim out when nothing is switched off', async () => {
    const res = await loginAs(staff());

    expect(accessClaims(res)).not.toHaveProperty('off');
  });

  it('skips the plan lookup for a website customer', async () => {
    await loginAs(staff({ role: 'customer' }));

    expect(planModules.modulesSwitchedOffFor).not.toHaveBeenCalled();
  });

  it('carries a plan change into the token on the next renewal', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: AGENCY });
    userDb.findUserById.mockResolvedValue(staff());
    planModules.modulesSwitchedOffFor.mockResolvedValue(['travel_booking']);

    const res = await run(refresh, { cookies: { refresh_token: 'refresh-old' } });

    expect(accessClaims(res).off).toEqual(['travel_booking']);
  });
});

describe('plan modules in the signed-in user Management receives', () => {
  it('returns the switched-off modules with the user at sign-in', async () => {
    planModules.modulesSwitchedOffFor.mockResolvedValue(['vendors']);

    const res = await loginAs(staff());

    expect(res.json.mock.calls[0][0].data.user.planModulesOff).toEqual(['vendors']);
  });

  it('returns an empty list when the plan switches nothing off', async () => {
    const res = await loginAs(staff());

    expect(res.json.mock.calls[0][0].data.user.planModulesOff).toEqual([]);
  });

  it('returns the current list on every session renewal', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'fam-1', tenantId: AGENCY });
    userDb.findUserById.mockResolvedValue(staff());
    planModules.modulesSwitchedOffFor.mockResolvedValue(['analytics_full']);

    const res = await run(refresh, { cookies: { refresh_token: 'refresh-old' } });

    expect(res.json.mock.calls[0][0].data.user.planModulesOff).toEqual(['analytics_full']);
  });
});

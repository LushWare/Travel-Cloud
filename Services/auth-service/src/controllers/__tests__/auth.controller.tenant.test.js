import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { userDb, memberships, sessions, bcryptCompare } = vi.hoisted(() => ({
  userDb: { findUserByEmail: vi.fn(), findUserById: vi.fn(), updateLastLogin: vi.fn() },
  memberships: {
    listUsableMemberships: vi.fn(), findUsableMembership: vi.fn(), findMembership: vi.fn(), activateInvitedMemberships: vi.fn(),
  },
  sessions: {
    createSession: vi.fn(), consumeSession: vi.fn(), revokeFamily: vi.fn(),
    revokeUserSessions: vi.fn(), revokeSessionByToken: vi.fn(),
  },
  bcryptCompare: vi.fn(),
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', () => memberships);
vi.mock('../../services/session.service.js', () => sessions);
vi.mock('../../services/rateLimit.service.js', () => ({
  hit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1 }), clear: vi.fn().mockResolvedValue(),
}));
vi.mock('../../db/client.js', () => ({ default: {} }));
vi.mock('../../utils/email.js', () => ({ sendSetPasswordLink: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: bcryptCompare, hash: vi.fn() } }));

import { getMe, login, refresh, selectTenant, sendSetPasswordLink } from '../auth.controller.js';
import { resetKeysForTests, signJwt } from '../../config/jwtKeys.js';

const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DEMO = '00000000-0000-4000-8000-000000000001';
const USER = { id: 'user-1', name: 'Jo', email: 'jo@test.com', role: 'admin', isActive: true, password: 'h', permissions: ['manage_leads'] };
const inAgency = (tenantId, over = {}) => ({
  tenantId, tenantSlug: `slug-${tenantId.slice(0, 2)}`, tenantName: `Agency ${tenantId.slice(0, 2)}`,
  membershipId: `m-${tenantId.slice(0, 2)}`, role: 'salesRep', permissions: ['view_reports'], isOwner: false, ...over,
});

async function call(handler, req = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn(), set: vi.fn() };
  let error;
  await handler({ body: {}, headers: {}, cookies: {}, params: {}, ip: '1.1.1.1', get: () => undefined, ...req }, res, (err) => { error = err; });
  return { res, error, body: res.json.mock.calls[0]?.[0] };
}

const accessToken = (res) => jwt.decode(res.cookie.mock.calls.find(([name]) => name === 'token')?.[1] ?? '');
const loginAs = (user, body = {}) => {
  userDb.findUserByEmail.mockResolvedValue(user);
  return call(login, { body: { email: user.email, password: 'pw', ...body } });
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  delete process.env.PUBLIC_SITE_TENANT_ID;
  bcryptCompare.mockResolvedValue(true);
  userDb.updateLastLogin.mockResolvedValue();
  userDb.findUserById.mockResolvedValue(USER);
  sessions.createSession.mockResolvedValue({ token: 'r', expiresAt: new Date(Date.now() + 1e9) });
  memberships.listUsableMemberships.mockResolvedValue([inAgency(A)]);
});

describe('signing in to an agency', () => {
  it('puts the agency into the login of someone who belongs to one agency', async () => {
    const { res } = await loginAs(USER);

    expect(accessToken(res).tid).toBe(A);
  });

  it('uses the role from the agency membership, not the account', async () => {
    const { res } = await loginAs(USER);

    expect(accessToken(res)).toMatchObject({ role: 'salesRep', permissions: ['view_reports'], isSuperAdmin: false });
  });

  it('makes the agency owner a super admin of that agency only', async () => {
    memberships.listUsableMemberships.mockResolvedValue([inAgency(A, { role: 'admin', isOwner: true })]);

    const { res } = await loginAs(USER);

    expect(accessToken(res)).toMatchObject({ tid: A, isSuperAdmin: true });
  });

  it('remembers the agency on the renewal session', async () => {
    await loginAs(USER);

    expect(sessions.createSession).toHaveBeenCalledWith('user-1', expect.objectContaining({ tenantId: A }));
  });

  it('tells the screen which agency the person is in', async () => {
    const { body } = await loginAs(USER);

    expect(body.data.user.tenant).toEqual({ id: A, slug: 'slug-11', name: 'Agency 11' });
  });

  it('asks someone in several agencies to choose, without signing them in yet', async () => {
    memberships.listUsableMemberships.mockResolvedValue([inAgency(A), inAgency(B)]);

    const { res, body } = await loginAs(USER);

    expect(body.data.requiresTenantChoice).toBe(true);
    expect(body.data.tenants.map((t) => t.id)).toEqual([A, B]);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('signs straight into the agency named at login', async () => {
    memberships.listUsableMemberships.mockResolvedValue([inAgency(A), inAgency(B)]);

    const { res } = await loginAs(USER, { tenantId: B });

    expect(accessToken(res).tid).toBe(B);
  });

  it('refuses an agency the person does not belong to', async () => {
    const { error, res } = await loginAs(USER, { tenantId: B });

    expect(error.statusCode).toBe(403);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('refuses staff who belong to no active agency', async () => {
    memberships.listUsableMemberships.mockResolvedValue([]);

    const { error } = await loginAs(USER);

    expect(error.statusCode).toBe(403);
  });

  it('places website customers in the public website agency', async () => {
    const { res } = await loginAs({ ...USER, role: 'customer' });

    expect(accessToken(res)).toMatchObject({ tid: DEMO, role: 'customer' });
    expect(memberships.listUsableMemberships).not.toHaveBeenCalled();
  });
});

describe('choosing an agency', () => {
  const choiceToken = () => signJwt({ userId: 'user-1', tenantChoice: true }, '5m');

  beforeEach(() => {
    memberships.listUsableMemberships.mockResolvedValue([inAgency(A), inAgency(B)]);
  });

  it('opens a session in the chosen agency', async () => {
    const { res } = await call(selectTenant, { body: { selectionToken: choiceToken(), tenantId: B } });

    expect(accessToken(res).tid).toBe(B);
  });

  it('refuses an agency the person does not belong to', async () => {
    const { error } = await call(selectTenant, { body: { selectionToken: choiceToken(), tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } });

    expect(error.statusCode).toBe(403);
  });

  it('refuses the half-login token from the OTP step', async () => {
    const otpToken = signJwt({ userId: 'user-1', tempAuth: true }, '5m');

    const { error } = await call(selectTenant, { body: { selectionToken: otpToken, tenantId: A } });

    expect(error.statusCode).toBe(401);
  });

  it('refuses a token signed by anyone else', async () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const forged = jwt.sign({ userId: 'user-1', tenantChoice: true }, other.privateKey, { algorithm: 'ES256' });

    const { error } = await call(selectTenant, { body: { selectionToken: forged, tenantId: A } });

    expect(error.statusCode).toBe(401);
  });

  it('refuses a deactivated account', async () => {
    userDb.findUserById.mockResolvedValue({ ...USER, isActive: false });

    const { error } = await call(selectTenant, { body: { selectionToken: choiceToken(), tenantId: A } });

    expect(error.statusCode).toBe(401);
  });
});

describe('renewing a session', () => {
  it('stays in the agency the session was opened for', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'f', tenantId: B });
    memberships.findUsableMembership.mockResolvedValue(inAgency(B));

    const { res } = await call(refresh, { cookies: { refresh_token: 'r' } });

    expect(memberships.findUsableMembership).toHaveBeenCalledWith('user-1', B);
    expect(accessToken(res).tid).toBe(B);
  });

  it('ends the session when the person was removed from that agency', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'f', tenantId: A });
    memberships.findUsableMembership.mockResolvedValue(null);

    const { error } = await call(refresh, { cookies: { refresh_token: 'r' } });

    expect(error.statusCode).toBe(401);
    expect(sessions.revokeFamily).toHaveBeenCalledWith('f');
  });

  it('asks sessions from before agencies existed to sign in again', async () => {
    sessions.consumeSession.mockResolvedValue({ userId: 'user-1', familyId: 'f', tenantId: null });

    const { error } = await call(refresh, { cookies: { refresh_token: 'r' } });

    expect(error.statusCode).toBe(401);
  });
});

describe('getMe', () => {
  it('returns the role for the current agency', async () => {
    memberships.findUsableMembership.mockResolvedValue(inAgency(A, { role: 'vendor' }));

    const { body } = await call(getMe, { headers: { 'x-user-id': 'user-1', 'x-tenant-id': A } });

    expect(body.data.user.role).toBe('vendor');
  });
});

describe('invite and reset emails', () => {
  const admin = { 'x-user-id': '99999999-9999-4999-8999-999999999999', 'x-user-role': 'admin', 'x-tenant-id': A };

  it('cannot reach someone in a different agency', async () => {
    memberships.findMembership.mockResolvedValue(null);

    const { error } = await call(sendSetPasswordLink, { headers: admin, params: { userId: '33333333-3333-4333-8333-333333333333' } });

    expect(error.statusCode).toBe(404);
    expect(memberships.findMembership).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', A);
  });
});

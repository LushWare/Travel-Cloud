import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { help, sessions, limiter } = vi.hoisted(() => ({
  help: { redeemHandoff: vi.fn(), findOpenGrant: vi.fn(), endGrant: vi.fn() },
  sessions: { createSession: vi.fn(), consumeSession: vi.fn(), revokeFamily: vi.fn(), revokeUserSessions: vi.fn(), revokeSessionByToken: vi.fn() },
  limiter: { hit: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../db/helpAccessQueries.js', () => help);
vi.mock('../../db/userQueries.js', () => ({ findUserById: vi.fn() }));
vi.mock('../../db/membershipQueries.js', () => ({ findUsableMembership: vi.fn() }));
vi.mock('../../services/session.service.js', () => sessions);
vi.mock('../../services/rateLimit.service.js', () => limiter);
vi.mock('../../db/client.js', () => ({ default: {} }));
vi.mock('../../utils/email.js', () => ({}));

import { getMe, logout, redeemHelpAccess } from '../auth.controller.js';
import { resetKeysForTests, signJwt } from '../../config/jwtKeys.js';

const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ACME = '00000000-0000-4000-8000-000000000002';
const CODE = 'a'.repeat(43);
const GRANT = {
  id: '33333333-3333-4333-8333-333333333333', tenantId: ACME, expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  platformUserId: '44444444-4444-4444-8444-444444444444', email: 'ops@lushware.test', name: 'Ops', tenantSlug: 'acme-tours', tenantName: 'Acme Tours',
};

async function call(handler, req = {}) {
  const res = {
    status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn(), set: vi.fn(),
    type: vi.fn().mockReturnThis(), send: vi.fn(), redirect: vi.fn(),
  };
  let error;
  await handler({ body: {}, headers: {}, cookies: {}, params: {}, query: {}, ip: '1.1.1.1', get: () => undefined, ...req }, res, (err) => { error = err; });
  return { res, error };
}
const tokenSet = (res) => jwt.decode(res.cookie.mock.calls.find(([name]) => name === 'token')?.[1] ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  resetKeysForTests();
  limiter.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  help.redeemHandoff.mockResolvedValue(GRANT);
  help.endGrant.mockResolvedValue(true);
});

describe('opening a help session from the console link', () => {
  it('signs into the agency as a view-only session and sends the browser to Management', async () => {
    const { res } = await call(redeemHelpAccess, { query: { code: CODE } });

    expect(tokenSet(res)).toMatchObject({ tid: ACME, role: 'admin', help: GRANT.id, ro: true, isSuperAdmin: false, name: 'Lushware support · Ops' });
    expect(res.redirect).toHaveBeenCalledWith(302, expect.stringMatching(/\/\?help=1$/));
  });

  it('looks the link up by its hash, never the code itself', async () => {
    await call(redeemHelpAccess, { query: { code: CODE } });

    expect(help.redeemHandoff).toHaveBeenCalledWith(crypto.createHash('sha256').update(CODE).digest('hex'));
  });

  it('ends the session exactly when the help access ends', async () => {
    const { res } = await call(redeemHelpAccess, { query: { code: CODE } });

    const token = tokenSet(res);
    expect(Math.abs(token.exp * 1000 - GRANT.expiresAt.getTime())).toBeLessThan(2000);
    const cookieOptions = res.cookie.mock.calls.find(([name]) => name === 'token')[2];
    expect(cookieOptions).toMatchObject({ httpOnly: true, expires: GRANT.expiresAt });
  });

  it('gives no refresh cookie, so the session cannot outlive the help access', async () => {
    const { res } = await call(redeemHelpAccess, { query: { code: CODE } });

    expect(res.cookie.mock.calls.some(([name]) => name === 'refresh_token')).toBe(false);
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
  });

  it('refuses a used, expired or unknown link', async () => {
    help.redeemHandoff.mockResolvedValue(null);

    const { res } = await call(redeemHelpAccess, { query: { code: CODE } });

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'short', `${'a'.repeat(40)}'; DROP`])('refuses the malformed code %j without a lookup', async (code) => {
    const { res } = await call(redeemHelpAccess, { query: { code } });

    expect(res.status).toHaveBeenCalledWith(410);
    expect(help.redeemHandoff).not.toHaveBeenCalled();
  });
});

describe('who Management shows during a help session', () => {
  const helpHeaders = {
    'x-platform-help-grant': GRANT.id, 'x-user-id': GRANT.platformUserId, 'x-user-email': GRANT.email,
    'x-user-name': 'Lushware support · Ops', 'x-tenant-id': ACME,
  };

  it('describes the support person, the agency and when access ends', async () => {
    help.findOpenGrant.mockResolvedValue({ id: GRANT.id, expiresAt: GRANT.expiresAt, tenantSlug: 'acme-tours', tenantName: 'Acme Tours' });

    const { res } = await call(getMe, { headers: helpHeaders });

    const { user } = res.json.mock.calls[0][0].data;
    expect(user).toMatchObject({
      email: 'ops@lushware.test', role: 'admin', tenant: { id: ACME, slug: 'acme-tours', name: 'Acme Tours' },
      helpAccess: { grantId: GRANT.id, viewOnly: true },
    });
  });

  it('refuses once the help session has ended', async () => {
    help.findOpenGrant.mockResolvedValue(null);

    const { error } = await call(getMe, { headers: helpHeaders });

    expect(error.statusCode).toBe(401);
  });
});

describe('signing out of a help session', () => {
  it('ends the help access so the agency sees when it stopped', async () => {
    const token = signJwt({ id: GRANT.platformUserId, tid: ACME, help: GRANT.id, ro: true }, 600);

    await call(logout, { cookies: { token } });

    expect(help.endGrant).toHaveBeenCalledWith(GRANT.id);
  });

  it('ends nothing for an ordinary agency sign-out', async () => {
    const token = signJwt({ id: 'user-1', tid: ACME }, 600);

    await call(logout, { cookies: { token } });

    expect(help.endGrant).not.toHaveBeenCalled();
  });

  it('ignores a forged help token', async () => {
    const forged = jwt.sign({ help: GRANT.id, ro: true }, 'not-the-key');

    await call(logout, { cookies: { token: forged } });

    expect(help.endGrant).not.toHaveBeenCalled();
  });
});

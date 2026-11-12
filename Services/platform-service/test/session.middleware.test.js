import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { findLiveSession: vi.fn(), touchSession: vi.fn() } }));
vi.mock('../src/db/staff.js', () => db);

const { platformSession, requirePlatformRole, requirePlatformSession } = await import('../src/middleware/requirePlatformSession.js');

const SESSION = { sessionId: 's-1', id: 'u-1', email: 'ops@lushware.test', name: 'Ops', role: 'support' };
const run = async (middleware, req = { cookies: { platform_session: 'abc' } }) => {
  const next = vi.fn();
  await middleware(req, {}, next);
  return { req, error: next.mock.calls[0]?.[0] };
};

beforeEach(() => {
  db.findLiveSession.mockReset();
  db.touchSession.mockReset();
});

describe('console session check', () => {
  it('refuses every ordinary console route while the password is still temporary', async () => {
    db.findLiveSession.mockResolvedValue({ ...SESSION, mustChangePassword: true });

    const { error } = await run(requirePlatformSession);

    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('lets the password-change route through while the password is temporary', async () => {
    db.findLiveSession.mockResolvedValue({ ...SESSION, mustChangePassword: true });

    const { error, req } = await run(platformSession({ allowPendingPasswordChange: true }));

    expect(error).toBeUndefined();
    expect(req.platformUser.mustChangePassword).toBe(true);
  });

  it('lets an ordinary route through once the password is the person\'s own', async () => {
    db.findLiveSession.mockResolvedValue({ ...SESSION, mustChangePassword: false });

    const { error, req } = await run(requirePlatformSession);

    expect(error).toBeUndefined();
    expect(req.platformSessionId).toBe('s-1');
  });

  it('refuses a request with no console cookie without a database lookup', async () => {
    const { error } = await run(requirePlatformSession, { cookies: {} });

    expect(error.statusCode).toBe(401);
    expect(db.findLiveSession).not.toHaveBeenCalled();
  });
});

describe('platform roles', () => {
  it('refuses support staff on an admin-only route', async () => {
    const next = vi.fn();

    requirePlatformRole('platform_admin')({ platformUser: { role: 'support' } }, {}, next);

    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('lets a platform admin through an admin-only route', async () => {
    const next = vi.fn();

    requirePlatformRole('platform_admin')({ platformUser: { role: 'platform_admin' } }, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});

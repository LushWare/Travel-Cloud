import { beforeEach, describe, expect, it, vi } from 'vitest';

const { userDb, email, limiter } = vi.hoisted(() => ({
  userDb: { findUserById: vi.fn(), setResetPasswordToken: vi.fn(), findUserByResetToken: vi.fn() },
  email: { sendSetPasswordLink: vi.fn() },
  limiter: { hit: vi.fn(), clear: vi.fn() },
}));

vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../db/membershipQueries.js', async () => (await import('./membershipFixture.js')).membershipMock(userDb));
vi.mock('../../db/client.js', () => ({ default: {} }));
vi.mock('../../services/session.service.js', () => ({}));
vi.mock('../../services/rateLimit.service.js', () => limiter);
vi.mock('../../utils/email.js', () => email);

import { resetPassword, sendSetPasswordLink } from '../auth.controller.js';

const ADMIN = { 'x-user-id': '11111111-1111-4111-8111-111111111111', 'x-user-role': 'admin', 'x-user-is-super-admin': 'false', 'x-tenant-id': '00000000-0000-4000-8000-000000000001' };
const SUPER = { 'x-user-id': '22222222-2222-4222-8222-222222222222', 'x-user-role': 'superAdmin', 'x-user-is-super-admin': 'true', 'x-tenant-id': '00000000-0000-4000-8000-000000000001' };
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const staff = (over = {}) => ({ id: TARGET_ID, name: 'Rep', email: 'rep@test.com', role: 'salesRep', isActive: true, lastLogin: null, ...over });

async function send(headers = ADMIN, userId = TARGET_ID) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
  let error;
  await sendSetPasswordLink({ headers, params: { userId } }, res, (err) => { error = err; });
  return { res, error, body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  userDb.findUserById.mockResolvedValue(staff());
  userDb.setResetPasswordToken.mockResolvedValue();
  email.sendSetPasswordLink.mockResolvedValue();
  limiter.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
});

describe('sendSetPasswordLink', () => {
  it('emails a new staff member an invitation', async () => {
    const { body } = await send();

    expect(body.message).toBe('Invitation sent');
    expect(email.sendSetPasswordLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'rep@test.com' }), expect.any(String), { invite: true, hours: 72 });
  });

  it('sends a reset email to someone who has logged in before', async () => {
    userDb.findUserById.mockResolvedValue(staff({ lastLogin: new Date() }));

    const { body } = await send();

    expect(body.message).toBe('Password reset email sent');
    expect(email.sendSetPasswordLink.mock.calls[0][2]).toEqual({ invite: false, hours: 24 });
  });

  it('stores only a hash of the link token', async () => {
    await send();

    const sentToken = email.sendSetPasswordLink.mock.calls[0][1];
    const storedHash = userDb.setResetPasswordToken.mock.calls[0][1];
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(storedHash).not.toBe(sentToken);
  });

  it('never returns the link token or a password to the admin', async () => {
    const { body } = await send();

    expect(body.data).toEqual({ invite: true });
  });

  it('stops a normal admin from resetting a super admin', async () => {
    userDb.findUserById.mockResolvedValue(staff({ role: 'superAdmin', isSuperAdmin: true }));

    const { error } = await send(ADMIN);

    expect(error.statusCode).toBe(403);
    expect(email.sendSetPasswordLink).not.toHaveBeenCalled();
  });

  it('lets a super admin reset another super admin', async () => {
    userDb.findUserById.mockResolvedValue(staff({ role: 'superAdmin', isSuperAdmin: true }));

    const { error } = await send(SUPER);

    expect(error).toBeUndefined();
  });

  it('refuses callers who are not admins', async () => {
    const { error } = await send({ ...ADMIN, 'x-user-role': 'salesRep' });

    expect(error.statusCode).toBe(403);
  });

  it('refuses an admin acting on their own account', async () => {
    const { error } = await send(ADMIN, ADMIN['x-user-id']);

    expect(error.statusCode).toBe(400);
  });

  it('does not send links to website customers', async () => {
    userDb.findUserById.mockResolvedValue(staff({ role: 'customer' }));

    const { error } = await send();

    expect(error.statusCode).toBe(404);
  });

  it('does not send links to a deactivated account', async () => {
    userDb.findUserById.mockResolvedValue(staff({ isActive: false }));

    const { error } = await send();

    expect(error.statusCode).toBe(409);
  });

  it('returns 404 for a malformed id without touching the database', async () => {
    const { error } = await send(ADMIN, 'not-a-uuid');

    expect(error.statusCode).toBe(404);
    expect(userDb.findUserById).not.toHaveBeenCalled();
  });

  it('cancels the link when the email cannot be sent', async () => {
    email.sendSetPasswordLink.mockRejectedValue(new Error('smtp down'));

    const { error } = await send();

    expect(error.statusCode).toBe(502);
    expect(userDb.setResetPasswordToken).toHaveBeenLastCalledWith(TARGET_ID, null, null);
  });

  it('limits how many links one account can be sent', async () => {
    limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });

    const { error } = await send();

    expect(error.statusCode).toBe(429);
    expect(email.sendSetPasswordLink).not.toHaveBeenCalled();
  });
});

describe('resetPassword with a link', () => {
  const useLink = (password) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() };
    let error;
    return resetPassword({ params: { token: 'abc' }, body: { password } }, res, (err) => { error = err; }).then(() => error);
  };

  it('rejects a password shorter than 8 characters', async () => {
    const error = await useLink('short');

    expect(error.statusCode).toBe(400);
    expect(userDb.findUserByResetToken).not.toHaveBeenCalled();
  });

  it('refuses to sign in a deactivated account', async () => {
    userDb.findUserByResetToken.mockResolvedValue(staff({ isActive: false }));

    const error = await useLink('Long-enough-1');

    expect(error.statusCode).toBe(403);
  });
});

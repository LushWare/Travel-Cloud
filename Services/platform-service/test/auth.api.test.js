import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

process.env.PLATFORM_TOTP_KEY = crypto.randomBytes(32).toString('base64');
process.env.PLATFORM_CHALLENGE_SECRET = 'c'.repeat(48);

const { db } = vi.hoisted(() => ({
  db: {
    findStaffByEmail: vi.fn(), findStaffById: vi.fn(), recordFailedAttempt: vi.fn(), recordSuccessfulLogin: vi.fn(),
    createSession: vi.fn(), findLiveSession: vi.fn(), touchSession: vi.fn(), revokeSession: vi.fn(), recordPlatformAudit: vi.fn(),
    setOwnPassword: vi.fn(),
  },
}));
vi.mock('../src/db/staff.js', () => db);

const { default: app } = await import('../src/app.js');
const { codeAt, currentStep, generateSecret } = await import('../src/security/totp.js');
const { seal } = await import('../src/security/secretBox.js');
const { hashToken, issueChallenge } = await import('../src/security/tokens.js');

const SECRET = generateSecret();
let STAFF;

beforeAll(async () => {
  STAFF = {
    id: '11111111-1111-4111-8111-111111111111', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin',
    passwordHash: await bcrypt.hash('Correct-Horse-9', 4), totpSecret: seal(SECRET), lastTotpStep: 0,
    isActive: true, failedLoginCount: 0, lockedUntil: null,
  };
});

beforeEach(() => {
  Object.values(db).forEach((fn) => fn.mockReset());
  db.findStaffByEmail.mockResolvedValue(STAFF);
  db.findStaffById.mockResolvedValue(STAFF);
  db.recordSuccessfulLogin.mockResolvedValue(true);
});

const login = (body) => request(app).post('/api/v1/platform/auth/login').send(body);
const mfa = (body) => request(app).post('/api/v1/platform/auth/mfa').send(body);
const nowCode = () => codeAt(SECRET, currentStep());

describe('POST /api/v1/platform/auth/login', () => {
  it('returns a second-step challenge, not a session, for the right password', async () => {
    const res = await login({ email: 'OPS@lushware.test', password: 'Correct-Horse-9' });

    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.challenge).toMatch(/\./);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(db.findStaffByEmail).toHaveBeenCalledWith('ops@lushware.test');
  });

  it('requires the emailed setup link after an authenticator reset', async () => {
    db.findStaffByEmail.mockResolvedValue({ ...STAFF, authenticatorSetupRequired: true });

    const res = await login({ email: 'ops@lushware.test', password: 'Correct-Horse-9' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTHENTICATOR_SETUP_REQUIRED');
    expect(res.body.data).toBeUndefined();
  });

  it('counts a wrong password and answers with the same message as an unknown email', async () => {
    const wrong = await login({ email: 'ops@lushware.test', password: 'nope' });
    db.findStaffByEmail.mockResolvedValue(null);
    const unknown = await login({ email: 'who@lushware.test', password: 'nope' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(db.recordFailedAttempt).toHaveBeenCalledTimes(1);
  });

  it('refuses a locked account even with the right password', async () => {
    db.findStaffByEmail.mockResolvedValue({ ...STAFF, lockedUntil: new Date(Date.now() + 60_000) });

    const res = await login({ email: 'ops@lushware.test', password: 'Correct-Horse-9' });

    expect(res.status).toBe(429);
    expect(res.body.data).toBeUndefined();
  });

  it('refuses a deactivated staff member', async () => {
    db.findStaffByEmail.mockResolvedValue({ ...STAFF, isActive: false });

    const res = await login({ email: 'ops@lushware.test', password: 'Correct-Horse-9' });

    expect(res.status).toBe(401);
  });

  it('rejects unexpected fields before checking anything', async () => {
    const res = await login({ email: 'ops@lushware.test', password: 'x', role: 'platform_admin' });

    expect(res.status).toBe(400);
    expect(db.findStaffByEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/platform/auth/mfa', () => {
  it('starts a session in an http-only, strict cookie scoped to the console API', async () => {
    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^platform_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/platform/);
    expect(res.body.data.user).toEqual({ id: STAFF.id, email: STAFF.email, name: 'Ops', role: 'platform_admin', mustChangePassword: false });
  });

  it('stores only a hash of the session token', async () => {
    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    const token = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    expect(db.createSession.mock.calls[0][0].tokenHash).toBe(hashToken(token));
  });

  it('records the sign-in in the platform audit log', async () => {
    await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(db.recordPlatformAudit.mock.calls[0][2]).toMatchObject({ action: 'platform.signed_in', targetId: STAFF.id });
  });

  it('refuses a wrong code and counts it as a failed attempt', async () => {
    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: '000000' === nowCode() ? '111111' : '000000' });

    expect(res.status).toBe(401);
    expect(db.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it('refuses a code that was already used', async () => {
    db.findStaffById.mockResolvedValue({ ...STAFF, lastTotpStep: currentStep() + 1 });

    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(res.status).toBe(401);
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it('refuses when another request used the same code first', async () => {
    db.recordSuccessfulLogin.mockResolvedValue(false);

    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(res.status).toBe(401);
    expect(db.createSession).not.toHaveBeenCalled();
  });

  it('refuses a forged challenge without looking anyone up', async () => {
    const forged = issueChallenge(STAFF.id, { key: 'z'.repeat(48) });

    const res = await mfa({ challenge: forged, code: nowCode() });

    expect(res.status).toBe(401);
    expect(db.findStaffById).not.toHaveBeenCalled();
  });

  it('refuses an expired challenge', async () => {
    const res = await mfa({ challenge: issueChallenge(STAFF.id, { nowMs: Date.now() - 6 * 60 * 1000 }), code: nowCode() });

    expect(res.status).toBe(401);
  });

  it('refuses a locked account at the second step', async () => {
    db.findStaffById.mockResolvedValue({ ...STAFF, lockedUntil: new Date(Date.now() + 60_000) });

    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(res.status).toBe(429);
    expect(db.createSession).not.toHaveBeenCalled();
  });
});

describe('session checks', () => {
  it('answers /me for a live session', async () => {
    db.findLiveSession.mockResolvedValue({ sessionId: 's-1', id: STAFF.id, email: STAFF.email, name: 'Ops', role: 'platform_admin' });

    const res = await request(app).get('/api/v1/platform/auth/me').set('Cookie', 'platform_session=abc');

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(STAFF.email);
    expect(db.findLiveSession).toHaveBeenCalledWith(hashToken('abc'), { idleMinutes: 30 });
    expect(db.touchSession).toHaveBeenCalledWith('s-1');
  });

  it('refuses /me without the console cookie, even with agency identity headers', async () => {
    const res = await request(app).get('/api/v1/platform/auth/me')
      .set('x-user-id', STAFF.id).set('x-user-role', 'superAdmin').set('Cookie', 'token=agency-jwt');

    expect(res.status).toBe(401);
    expect(db.findLiveSession).not.toHaveBeenCalled();
  });

  it('refuses /me for an expired or revoked session', async () => {
    db.findLiveSession.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/platform/auth/me').set('Cookie', 'platform_session=old');

    expect(res.status).toBe(401);
  });

  it('logs out by revoking the session and clearing the cookie', async () => {
    const res = await request(app).post('/api/v1/platform/auth/logout').set('Cookie', 'platform_session=abc');

    expect(res.status).toBe(200);
    expect(db.revokeSession).toHaveBeenCalledWith(hashToken('abc'));
    expect(res.headers['set-cookie'][0]).toMatch(/platform_session=;/);
  });
});

describe('temporary passwords', () => {
  const session = () => ({ sessionId: 's-1', id: STAFF.id, email: STAFF.email, name: 'Ops', role: 'platform_admin' });
  const asTemporary = () => db.findLiveSession.mockResolvedValue({ ...session(), mustChangePassword: true });
  const change = (body) => request(app).post('/api/v1/platform/auth/change-password').set('Cookie', 'platform_session=abc').send(body);

  it('tells the console after sign-in that the password must be replaced', async () => {
    db.findStaffById.mockResolvedValue({ ...STAFF, mustChangePassword: true });

    const res = await mfa({ challenge: issueChallenge(STAFF.id), code: nowCode() });

    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('still answers /me so the console can show the change-password screen', async () => {
    asTemporary();

    const res = await request(app).get('/api/v1/platform/auth/me').set('Cookie', 'platform_session=abc');

    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
  });

  it('saves the new password and keeps only the current session', async () => {
    asTemporary();
    db.findStaffById.mockResolvedValue({ ...STAFF, mustChangePassword: true });

    const res = await change({ currentPassword: 'Correct-Horse-9', newPassword: 'blue-train-sunset-2026' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(false);
    const [userId, hash, keepSessionId] = db.setOwnPassword.mock.calls[0];
    expect(userId).toBe(STAFF.id);
    expect(keepSessionId).toBe('s-1');
    expect(await bcrypt.compare('blue-train-sunset-2026', hash)).toBe(true);
  });

  it('records setting a first password separately from a later change', async () => {
    asTemporary();
    db.findStaffById.mockResolvedValue({ ...STAFF, mustChangePassword: true });

    await change({ currentPassword: 'Correct-Horse-9', newPassword: 'blue-train-sunset-2026' });

    expect(db.recordPlatformAudit.mock.calls[0][2].action).toBe('platform.password_set');
  });

  it('records a later voluntary change', async () => {
    db.findLiveSession.mockResolvedValue(session());

    await change({ currentPassword: 'Correct-Horse-9', newPassword: 'blue-train-sunset-2026' });

    expect(db.recordPlatformAudit.mock.calls[0][2].action).toBe('platform.password_changed');
  });

  it('refuses a wrong current password and counts it as a failed attempt', async () => {
    asTemporary();

    const res = await change({ currentPassword: 'wrong', newPassword: 'blue-train-sunset-2026' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Your current password is incorrect.');
    expect(db.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(db.setOwnPassword).not.toHaveBeenCalled();
  });

  it('explains why a weak new password was refused', async () => {
    asTemporary();

    const res = await change({ currentPassword: 'Correct-Horse-9', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Use at least 12 characters.');
    expect(db.setOwnPassword).not.toHaveBeenCalled();
  });

  it('refuses to change the password without a session', async () => {
    const res = await request(app).post('/api/v1/platform/auth/change-password')
      .send({ currentPassword: 'Correct-Horse-9', newPassword: 'blue-train-sunset-2026' });

    expect(res.status).toBe(401);
    expect(db.setOwnPassword).not.toHaveBeenCalled();
  });
});

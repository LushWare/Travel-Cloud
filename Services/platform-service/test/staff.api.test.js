import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

process.env.PLATFORM_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_CHALLENGE_SECRET = 'c'.repeat(48);

const { staff, mailer } = vi.hoisted(() => ({
  staff: {
    findLiveSession: vi.fn(), touchSession: vi.fn(), findStaffByEmail: vi.fn(), createPlatformStaff: vi.fn(),
    listPlatformStaff: vi.fn(), findPlatformStaff: vi.fn(), findSetupByTokenHash: vi.fn(),
    completePlatformStaffSetup: vi.fn(), rotateStaffSetup: vi.fn(), updatePlatformStaffRole: vi.fn(),
    deactivatePlatformStaff: vi.fn(), deletePlatformStaff: vi.fn(), recordPlatformAudit: vi.fn(),
  },
  mailer: { sendPlatformSetupEmail: vi.fn() },
}));
vi.mock('../src/db/staff.js', () => staff);
vi.mock('../src/utils/email.client.js', () => mailer);

const { default: app } = await import('../src/app.js');
const { hashToken } = await import('../src/security/tokens.js');
const { codeAt, currentStep, generateSecret } = await import('../src/security/totp.js');
const { seal } = await import('../src/security/secretBox.js');

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin', mustChangePassword: false };
const SUPPORT = { ...ADMIN, role: 'support' };
const TARGET = '00000000-0000-4000-8000-000000000002';
const TOKEN = 'setup-token-123456789012345678901234567890';
const user = (overrides = {}) => ({
  id: TARGET, email: 'new@lushware.test', name: 'New Staff', role: 'support',
  isActive: false, setupPurpose: 'invite', authenticatorSetupRequired: true, ...overrides,
});

beforeEach(() => {
  Object.values(staff).forEach((fn) => fn.mockReset());
  mailer.sendPlatformSetupEmail.mockReset().mockResolvedValue({ messageId: 'message-1' });
  staff.findLiveSession.mockResolvedValue({ ...ADMIN, sessionId: 'session-1' });
  staff.findStaffByEmail.mockResolvedValue(null);
  staff.createPlatformStaff.mockImplementation(async ({ email, name, role }) => ({
    ...user({ email, name, role }), id: TARGET, createdAt: new Date().toISOString(),
  }));
  staff.findPlatformStaff.mockResolvedValue(user());
  staff.rotateStaffSetup.mockImplementation(async ({ purpose }) => user({
    isActive: purpose === 'authenticator_reset', setupPurpose: purpose,
  }));
  staff.updatePlatformStaffRole.mockResolvedValue('updated');
  staff.deactivatePlatformStaff.mockResolvedValue('deactivated');
  staff.deletePlatformStaff.mockResolvedValue({ result: 'deleted', staff: user({ isActive: false }) });
  staff.completePlatformStaffSetup.mockResolvedValue({ id: TARGET, email: 'new@lushware.test', name: 'New Staff', role: 'support' });
});

const authed = (session = ADMIN) => {
  staff.findLiveSession.mockResolvedValue({ ...session, sessionId: 'session-1' });
  return 'platform_session=session-token';
};

describe('platform staff management', () => {
  it('lets only platform admins list staff', async () => {
    const res = await request(app).get('/api/v1/platform/staff').set('Cookie', authed(SUPPORT));
    expect(res.status).toBe(403);
    expect(staff.listPlatformStaff).not.toHaveBeenCalled();
  });

  it('creates a pending account and sends a one-time invitation', async () => {
    const res = await request(app).post('/api/v1/platform/staff').set('Cookie', authed()).send({
      email: ' New@Lushware.test ', name: 'New Staff', role: 'support',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe('new@lushware.test');
    expect(res.body.data).not.toHaveProperty('passwordHash');
    expect(staff.createPlatformStaff).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@lushware.test', role: 'support', setupTokenHash: expect.any(String),
    }));
    expect(mailer.sendPlatformSetupEmail).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'invite', user: expect.objectContaining({ email: 'new@lushware.test' }), token: expect.any(String),
    }));
  });

  it('rejects unknown roles before creating an account', async () => {
    const res = await request(app).post('/api/v1/platform/staff').set('Cookie', authed()).send({
      email: 'new@lushware.test', name: 'New Staff', role: 'owner',
    });
    expect(res.status).toBe(400);
    expect(staff.createPlatformStaff).not.toHaveBeenCalled();
  });

  it('does not send an invitation to an email already in use', async () => {
    staff.findStaffByEmail.mockResolvedValue({ id: TARGET });
    const res = await request(app).post('/api/v1/platform/staff').set('Cookie', authed()).send({
      email: 'new@lushware.test', name: 'New Staff', role: 'support',
    });
    expect(res.status).toBe(409);
    expect(mailer.sendPlatformSetupEmail).not.toHaveBeenCalled();
  });

  it('resends only a pending invite', async () => {
    const res = await request(app).post(`/api/v1/platform/staff/${TARGET}/resend-invite`).set('Cookie', authed());
    expect(res.status).toBe(200);
    expect(mailer.sendPlatformSetupEmail).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'invite' }));
  });

  it('changes roles and revokes the staff member sessions', async () => {
    const res = await request(app).put(`/api/v1/platform/staff/${TARGET}/role`).set('Cookie', authed()).send({ role: 'platform_admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('platform_admin');
    expect(staff.updatePlatformStaffRole).toHaveBeenCalledWith(TARGET, 'platform_admin');
  });

  it('refuses to deactivate the current admin', async () => {
    const res = await request(app).post(`/api/v1/platform/staff/${ADMIN.id}/deactivate`).set('Cookie', authed());
    expect(res.status).toBe(409);
    expect(staff.deactivatePlatformStaff).not.toHaveBeenCalled();
  });

  it('deactivates another account and revokes its sessions', async () => {
    staff.findPlatformStaff.mockResolvedValue(user({ isActive: true, setupPurpose: null }));
    const res = await request(app).post(`/api/v1/platform/staff/${TARGET}/deactivate`).set('Cookie', authed());
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(staff.deactivatePlatformStaff).toHaveBeenCalledWith(TARGET);
  });

  it('cancels a pending invitation', async () => {
    const res = await request(app).post(`/api/v1/platform/staff/${TARGET}/deactivate`).set('Cookie', authed());
    expect(res.status).toBe(200);
    expect(staff.deactivatePlatformStaff).toHaveBeenCalledWith(TARGET);
  });

  it('deletes another staff account while keeping the platform audit trail', async () => {
    const res = await request(app).delete(`/api/v1/platform/staff/${TARGET}`).set('Cookie', authed());
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(staff.deletePlatformStaff).toHaveBeenCalledWith(TARGET, expect.objectContaining({ actor: ADMIN }));
  });

  it('refuses to delete the current admin', async () => {
    const res = await request(app).delete(`/api/v1/platform/staff/${ADMIN.id}`).set('Cookie', authed());
    expect(res.status).toBe(409);
    expect(staff.deletePlatformStaff).not.toHaveBeenCalled();
  });

  it('preserves the last active platform admin', async () => {
    staff.deletePlatformStaff.mockResolvedValue({ result: 'last_admin' });
    const res = await request(app).delete(`/api/v1/platform/staff/${TARGET}`).set('Cookie', authed());
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/at least one active platform admin/);
  });

  it('sends an authenticator reset link and revokes existing sessions', async () => {
    staff.findPlatformStaff.mockResolvedValue(user({ isActive: true, setupPurpose: null }));
    const res = await request(app).post(`/api/v1/platform/staff/${TARGET}/reset-authenticator`).set('Cookie', authed());
    expect(res.status).toBe(200);
    expect(staff.rotateStaffSetup).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'authenticator_reset' }));
    expect(mailer.sendPlatformSetupEmail).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'authenticator_reset' }));
  });
});

describe('public staff setup', () => {
  it('returns authenticator setup details for a valid invitation token', async () => {
    const secret = generateSecret();
    staff.findSetupByTokenHash.mockResolvedValue({ ...user(), totpSecret: seal(secret), lastTotpStep: 0 });
    const res = await request(app).post('/api/v1/platform/auth/setup/details').send({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toBe(secret);
    expect(res.body.data.requiresPassword).toBe(true);
    expect(res.body.data.otpauthUri).toContain('otpauth://totp/');
    expect(staff.findSetupByTokenHash).toHaveBeenCalledWith(hashToken(TOKEN));
  });

  it('activates an invitation only after the authenticator code is verified', async () => {
    const secret = generateSecret();
    const step = currentStep();
    staff.findSetupByTokenHash.mockResolvedValue({
      ...user(), email: 'new@lushware.test', totpSecret: seal(secret), lastTotpStep: 0,
    });
    const res = await request(app).post('/api/v1/platform/auth/setup').send({
      token: TOKEN, code: codeAt(secret, step), password: 'a-long-unique-phrase-930',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.completed).toBe(true);
    expect(staff.completePlatformStaffSetup).toHaveBeenCalledWith(expect.objectContaining({
      id: TARGET, setupTokenHash: hashToken(TOKEN), totpStep: step, passwordHash: expect.any(String),
    }));
  });

  it('does not consume an invite when the authenticator code is wrong', async () => {
    const secret = generateSecret();
    staff.findSetupByTokenHash.mockResolvedValue({ ...user(), totpSecret: seal(secret), lastTotpStep: 0 });
    const res = await request(app).post('/api/v1/platform/auth/setup').send({
      token: TOKEN, code: codeAt(secret, currentStep() + 2), password: 'a-long-unique-phrase-930',
    });
    expect(res.status).toBe(400);
    expect(staff.completePlatformStaffSetup).not.toHaveBeenCalled();
  });

  it('finishes an authenticator reset without changing the existing password', async () => {
    const secret = generateSecret();
    const step = currentStep();
    staff.findSetupByTokenHash.mockResolvedValue({
      ...user({ isActive: true, setupPurpose: 'authenticator_reset' }),
      email: 'new@lushware.test', totpSecret: seal(secret), lastTotpStep: 0,
    });
    const res = await request(app).post('/api/v1/platform/auth/setup').send({ token: TOKEN, code: codeAt(secret, step) });
    expect(res.status).toBe(200);
    expect(staff.completePlatformStaffSetup).toHaveBeenCalledWith({
      id: TARGET, setupTokenHash: hashToken(TOKEN), totpStep: step, passwordHash: null,
    });
  });
});
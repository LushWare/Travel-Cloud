import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { staff, agencies, settings, mail } = vi.hoisted(() => ({
  staff: { findLiveSession: vi.fn(), touchSession: vi.fn() },
  agencies: {
    SORTS: { name: '' },
    findAgency: vi.fn(), decidePendingSignup: vi.fn(),
    listAgencies: vi.fn(), agencyDetail: vi.fn(), agencyHistory: vi.fn(),
    setAgencyStatus: vi.fn(), statusBeforeSuspension: vi.fn(),
  },
  settings: { getSignupApprovalRequired: vi.fn(), setSignupApprovalRequired: vi.fn() },
  mail: { sendSignupDecisionEmail: vi.fn(), sendPlatformSetupEmail: vi.fn() },
}));

vi.mock('../src/db/staff.js', () => staff);
vi.mock('../src/db/agencies.js', () => agencies);
vi.mock('../src/db/settings.js', () => settings);
vi.mock('../src/utils/email.client.js', () => mail);

const { default: app } = await import('../src/app.js');

const PENDING = { id: '00000000-0000-4000-8000-000000000009', name: 'North Star Travel', slug: 'north-star', status: 'pending_approval' };
const OWNER = { name: 'Alex Owner', email: 'alex@example.com' };
const admin = { sessionId: 's-1', id: 'p-1', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin', mustChangePassword: false };
const support = { ...admin, role: 'support' };

const cookie = (session) => { staff.findLiveSession.mockResolvedValue(session); return 'platform_session=abc'; };
const post = (path, body, session = admin) => request(app).post(`/api/v1/platform${path}`).set('Cookie', cookie(session)).send(body);
const put = (path, body, session = admin) => request(app).put(`/api/v1/platform${path}`).set('Cookie', cookie(session)).send(body);

beforeEach(() => {
  vi.clearAllMocks();
  agencies.findAgency.mockResolvedValue(PENDING);
  agencies.decidePendingSignup.mockResolvedValue([OWNER]);
  mail.sendSignupDecisionEmail.mockResolvedValue({});
  settings.getSignupApprovalRequired.mockResolvedValue(false);
});

describe('approving a waiting sign-up', () => {
  it('starts the agency on its trial', async () => {
    const res = await post(`/agencies/${PENDING.id}/approve`, {});

    expect(res.status).toBe(200);
    expect(res.body.data.agency.status).toBe('trial');
    expect(agencies.decidePendingSignup).toHaveBeenCalledWith(PENDING.id, expect.objectContaining({
      approve: true,
      audit: expect.objectContaining({ action: 'platform.agency_approved', actorEmail: 'ops@lushware.test' }),
    }));
  });

  it('emails the owner that the agency is ready', async () => {
    await post(`/agencies/${PENDING.id}/approve`, {});

    expect(mail.sendSignupDecisionEmail).toHaveBeenCalledWith({ owner: OWNER, agencyName: 'North Star Travel', approved: true });
  });

  it('still approves when the email cannot be sent, and says so', async () => {
    mail.sendSignupDecisionEmail.mockRejectedValue(new Error('smtp down'));

    const res = await post(`/agencies/${PENDING.id}/approve`, {});

    expect(res.status).toBe(200);
    expect(res.body.data.ownersEmailed).toBe(false);
  });

  it('refuses an agency that is not waiting for approval', async () => {
    agencies.findAgency.mockResolvedValue({ ...PENDING, status: 'active' });

    const res = await post(`/agencies/${PENDING.id}/approve`, {});

    expect(res.status).toBe(409);
    expect(agencies.decidePendingSignup).not.toHaveBeenCalled();
  });

  it('answers 409 when another admin decided first', async () => {
    agencies.decidePendingSignup.mockResolvedValue(null);

    const res = await post(`/agencies/${PENDING.id}/approve`, {});

    expect(res.status).toBe(409);
    expect(mail.sendSignupDecisionEmail).not.toHaveBeenCalled();
  });

  it('refuses support staff', async () => {
    const res = await post(`/agencies/${PENDING.id}/approve`, {}, support);

    expect(res.status).toBe(403);
  });
});

describe('rejecting a waiting sign-up', () => {
  it('needs a reason of at least 5 characters', async () => {
    const res = await post(`/agencies/${PENDING.id}/reject`, { reason: 'no' });

    expect(res.status).toBe(400);
    expect(agencies.decidePendingSignup).not.toHaveBeenCalled();
  });

  it('closes the agency and records the reason', async () => {
    const res = await post(`/agencies/${PENDING.id}/reject`, { reason: 'Looks like a spam sign-up' });

    expect(res.body.data.agency.status).toBe('deleted');
    expect(agencies.decidePendingSignup).toHaveBeenCalledWith(PENDING.id, expect.objectContaining({
      approve: false,
      audit: expect.objectContaining({ action: 'platform.agency_rejected', details: { reason: 'Looks like a spam sign-up' } }),
    }));
  });

  it('emails the owner the decision', async () => {
    await post(`/agencies/${PENDING.id}/reject`, { reason: 'Looks like a spam sign-up' });

    expect(mail.sendSignupDecisionEmail).toHaveBeenCalledWith(expect.objectContaining({ approved: false }));
  });
});

describe('the sign-up approval switch', () => {
  it('shows the current setting to any platform staff', async () => {
    settings.getSignupApprovalRequired.mockResolvedValue(true);

    const res = await request(app).get('/api/v1/platform/settings').set('Cookie', cookie(support));

    expect(res.body.data).toEqual({ requireSignupApproval: true });
  });

  it('lets a platform admin turn it on, recording who did it', async () => {
    const res = await put('/settings/signup-approval', { enabled: true });

    expect(res.status).toBe(200);
    expect(settings.setSignupApprovalRequired).toHaveBeenCalledWith(true, expect.objectContaining({ actorEmail: 'ops@lushware.test' }));
  });

  it('refuses support staff', async () => {
    const res = await put('/settings/signup-approval', { enabled: true }, support);

    expect(res.status).toBe(403);
    expect(settings.setSignupApprovalRequired).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ enabled: 'yes' }], [{ enabled: true, extra: 1 }]])('refuses the body %j', async (body) => {
    const res = await put('/settings/signup-approval', body);

    expect(res.status).toBe(400);
  });
});

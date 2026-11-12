import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

process.env.PLATFORM_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_CHALLENGE_SECRET = 'c'.repeat(48);

const { staff, agencies, help, plans } = vi.hoisted(() => ({
  help: { startHelpAccess: vi.fn() },
  staff: { findLiveSession: vi.fn(), touchSession: vi.fn() },
  plans: { getAgencyPlan: vi.fn() },
  agencies: {
    SORTS: { name: '', created: '', activity: '', staff: '' },
    listAgencies: vi.fn(), findAgency: vi.fn(), agencyDetail: vi.fn(), agencyHistory: vi.fn(),
    setAgencyStatus: vi.fn(), statusBeforeSuspension: vi.fn(),
  },
}));
vi.mock('../src/db/staff.js', () => staff);
vi.mock('../src/db/agencies.js', () => agencies);
vi.mock('../src/db/help.js', () => help);
vi.mock('../src/db/plans.js', () => plans);

const { default: app } = await import('../src/app.js');
const { hashToken } = await import('../src/security/tokens.js');

const ACME = { id: '00000000-0000-4000-8000-000000000002', name: 'Acme Tours', slug: 'acme-tours', status: 'active' };
const DEMO = { id: '00000000-0000-4000-8000-000000000001', name: 'Lush Demo', slug: 'lush-demo', status: 'active' };
const admin = { sessionId: 's-1', id: 'p-1', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin', mustChangePassword: false };
const support = { ...admin, role: 'support' };

const as = (session) => { staff.findLiveSession.mockResolvedValue(session); return 'platform_session=abc'; };
const get = (path, session = admin) => request(app).get(`/api/v1/platform/agencies${path}`).set('Cookie', as(session));
const post = (path, body, session = admin) => request(app).post(`/api/v1/platform/agencies${path}`).set('Cookie', as(session)).send(body);

beforeEach(() => {
  Object.values(agencies).forEach((fn) => typeof fn === 'function' && fn.mockReset());
  staff.findLiveSession.mockReset();
  agencies.findAgency.mockResolvedValue(ACME);
  agencies.setAgencyStatus.mockResolvedValue(true);
  agencies.listAgencies.mockResolvedValue({ rows: [{ ...ACME, staff: 23 }], total: 1 });
  agencies.agencyDetail.mockResolvedValue({ people: { total: 23 }, owners: [], usage: {}, activity: {}, setup: {} });
  agencies.agencyHistory.mockResolvedValue([]);
  plans.getAgencyPlan.mockResolvedValue({ assignment: null, overrides: [] });
  help.startHelpAccess.mockReset().mockResolvedValue({ id: 'g-1', expiresAt: '2026-11-11T10:30:00.000Z' });
});

describe('GET /agencies', () => {
  it('lists agencies one page at a time', async () => {
    const res = await get('?page=2&limit=10&sort=activity&status=active&search=acme');

    expect(res.status).toBe(200);
    expect(res.body.data[0].slug).toBe('acme-tours');
    expect(res.body.pagination).toEqual({ page: 2, limit: 10, total: 1, pages: 1 });
    expect(agencies.listAgencies).toHaveBeenCalledWith({ search: 'acme', status: 'active', sort: 'activity', limit: 10, offset: 10 });
  });

  it('lets support staff look', async () => {
    const res = await get('', support);

    expect(res.status).toBe(200);
  });

  it('refuses anyone without a console session', async () => {
    const res = await request(app).get('/api/v1/platform/agencies');

    expect(res.status).toBe(401);
    expect(agencies.listAgencies).not.toHaveBeenCalled();
  });

  it('refuses someone who still has a temporary password', async () => {
    const res = await get('', { ...admin, mustChangePassword: true });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it.each([
    ['an unknown status', '?status=banned'],
    ['an unknown sort', '?sort=revenue'],
    ['a page size over 100', '?limit=500'],
    ['an unknown filter', '?tenantId=x'],
  ])('rejects %s', async (_label, query) => {
    const res = await get(query);

    expect(res.status).toBe(400);
    expect(agencies.listAgencies).not.toHaveBeenCalled();
  });
});

describe('GET /agencies/:id', () => {
  it('returns the agency with its counts and platform history', async () => {
    const res = await get(`/${ACME.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.agency.slug).toBe('acme-tours');
    expect(res.body.data.people.total).toBe(23);
    expect(res.body.data.isPublicSite).toBe(false);
  });

  it('flags the agency that runs the public website', async () => {
    agencies.findAgency.mockResolvedValue(DEMO);

    const res = await get(`/${DEMO.id}`);

    expect(res.body.data.isPublicSite).toBe(true);
  });

  it('answers 404 for an unknown agency', async () => {
    agencies.findAgency.mockResolvedValue(null);

    const res = await get(`/${ACME.id}`);

    expect(res.status).toBe(404);
  });

  it('rejects an id that is not a uuid', async () => {
    const res = await get('/acme-tours');

    expect(res.status).toBe(400);
    expect(agencies.findAgency).not.toHaveBeenCalled();
  });
});

describe('POST /agencies/:id/suspend', () => {
  it('suspends, ends its sessions and records who did it and why', async () => {
    const res = await post(`/${ACME.id}/suspend`, { reason: 'Unpaid for 60 days' });

    expect(res.status).toBe(200);
    expect(res.body.data.agency.status).toBe('suspended');
    const [id, change] = agencies.setAgencyStatus.mock.calls[0];
    expect(id).toBe(ACME.id);
    expect(change).toMatchObject({ status: 'suspended', expectedStatus: 'active', revokeSessions: true });
    expect(change.audit).toMatchObject({
      action: 'platform.agency_suspended', actorEmail: 'ops@lushware.test',
      details: { previousStatus: 'active', reason: 'Unpaid for 60 days' },
    });
  });

  it('refuses support staff', async () => {
    const res = await post(`/${ACME.id}/suspend`, { reason: 'Unpaid for 60 days' }, support);

    expect(res.status).toBe(403);
    expect(agencies.setAgencyStatus).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const res = await post(`/${ACME.id}/suspend`, { reason: ' ' });

    expect(res.status).toBe(400);
    expect(agencies.setAgencyStatus).not.toHaveBeenCalled();
  });

  it('refuses to suspend the agency that runs the public website', async () => {
    agencies.findAgency.mockResolvedValue(DEMO);

    const res = await post(`/${DEMO.id}/suspend`, { reason: 'Testing suspension' });

    expect(res.status).toBe(409);
    expect(agencies.setAgencyStatus).not.toHaveBeenCalled();
  });

  it('refuses an agency that is already suspended', async () => {
    agencies.findAgency.mockResolvedValue({ ...ACME, status: 'suspended' });

    const res = await post(`/${ACME.id}/suspend`, { reason: 'Unpaid for 60 days' });

    expect(res.status).toBe(409);
  });

  it('reports a conflict when the agency changed in the meantime', async () => {
    agencies.setAgencyStatus.mockResolvedValue(false);

    const res = await post(`/${ACME.id}/suspend`, { reason: 'Unpaid for 60 days' });

    expect(res.status).toBe(409);
  });
});

describe('POST /agencies/:id/restore', () => {
  it('puts back the status the agency had before it was suspended', async () => {
    agencies.findAgency.mockResolvedValue({ ...ACME, status: 'suspended' });
    agencies.statusBeforeSuspension.mockResolvedValue('trial');

    const res = await post(`/${ACME.id}/restore`, { reason: 'Payment received' });

    expect(res.status).toBe(200);
    expect(res.body.data.agency.status).toBe('trial');
    expect(agencies.setAgencyStatus.mock.calls[0][1]).toMatchObject({
      status: 'trial', expectedStatus: 'suspended', revokeSessions: false, audit: { action: 'platform.agency_restored' },
    });
  });

  it('restores to active when the earlier status is unknown', async () => {
    agencies.findAgency.mockResolvedValue({ ...ACME, status: 'suspended' });
    agencies.statusBeforeSuspension.mockResolvedValue(null);

    const res = await post(`/${ACME.id}/restore`, { reason: 'Payment received' });

    expect(res.body.data.agency.status).toBe('active');
  });

  it('refuses to restore an agency that is not suspended', async () => {
    const res = await post(`/${ACME.id}/restore`, { reason: 'Payment received' });

    expect(res.status).toBe(409);
    expect(agencies.setAgencyStatus).not.toHaveBeenCalled();
  });

  it('refuses support staff', async () => {
    agencies.findAgency.mockResolvedValue({ ...ACME, status: 'suspended' });

    const res = await post(`/${ACME.id}/restore`, { reason: 'Payment received' }, support);

    expect(res.status).toBe(403);
  });
});

describe('POST /agencies/:id/help-access', () => {
  it('opens view-only access and returns a one-time code whose hash alone is stored', async () => {
    const res = await post(`/${ACME.id}/help-access`, { reason: 'Invoice PDF looks wrong', minutes: 30 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ grantId: 'g-1', expiresAt: '2026-11-11T10:30:00.000Z' });
    const stored = help.startHelpAccess.mock.calls[0][0];
    expect(stored.handoffCodeHash).toBe(hashToken(res.body.data.code));
    expect(stored).toMatchObject({ tenantId: ACME.id, minutes: 30, reason: 'Invoice PDF looks wrong', handoffSeconds: 120 });
    expect(stored.audit.summary).toBe('Lushware staff ops@lushware.test opened view-only help access for 30 minutes: Invoice PDF looks wrong');
  });

  it('lets support staff open help access', async () => {
    const res = await post(`/${ACME.id}/help-access`, { reason: 'Customer cannot see quote', minutes: 15 }, support);

    expect(res.status).toBe(201);
  });

  it.each([
    ['no reason', { minutes: 30 }],
    ['a too-short reason', { reason: 'x', minutes: 30 }],
    ['more than 30 minutes', { reason: 'Invoice PDF looks wrong', minutes: 60 }],
    ['an odd duration', { reason: 'Invoice PDF looks wrong', minutes: 20 }],
    ['write access', { reason: 'Invoice PDF looks wrong', minutes: 30, mode: 'write' }],
  ])('refuses %s', async (_label, body) => {
    const res = await post(`/${ACME.id}/help-access`, body);

    expect(res.status).toBe(400);
    expect(help.startHelpAccess).not.toHaveBeenCalled();
  });

  it('refuses an agency that is being deleted', async () => {
    agencies.findAgency.mockResolvedValue({ ...ACME, status: 'pending_deletion' });

    const res = await post(`/${ACME.id}/help-access`, { reason: 'Invoice PDF looks wrong', minutes: 30 });

    expect(res.status).toBe(409);
  });

  it('refuses without a console session', async () => {
    const res = await request(app).post(`/api/v1/platform/agencies/${ACME.id}/help-access`).send({ reason: 'Invoice PDF looks wrong', minutes: 30 });

    expect(res.status).toBe(401);
    expect(help.startHelpAccess).not.toHaveBeenCalled();
  });
});

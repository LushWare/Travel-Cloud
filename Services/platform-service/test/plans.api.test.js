import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

process.env.PLATFORM_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_CHALLENGE_SECRET = 'c'.repeat(48);

const { staff, plans, agencies } = vi.hoisted(() => ({
  staff: { findLiveSession: vi.fn(), touchSession: vi.fn() },
  plans: {
    listPlans: vi.fn(), createPlan: vi.fn(), createPlanVersion: vi.fn(), findPlanVersion: vi.fn(),
    findPlan: vi.fn(), archivePlan: vi.fn(), getAgencyPlan: vi.fn(), assignAgencyPlan: vi.fn(),
    setAgencyOverride: vi.fn(), removeAgencyOverride: vi.fn(),
  },
  agencies: { SORTS: { name: '', created: '', activity: '', staff: '' }, findAgency: vi.fn() },
}));
vi.mock('../src/db/staff.js', () => staff);
vi.mock('../src/db/plans.js', () => plans);
vi.mock('../src/db/agencies.js', () => agencies);

const { default: app } = await import('../src/app.js');

const AGENCY_ID = '00000000-0000-4000-8000-000000000002';
const PLAN_ID = '00000000-0000-4000-8000-000000000010';
const VERSION_ID = '00000000-0000-4000-8000-000000000011';
const admin = { id: 'p-1', email: 'ops@lushware.test', role: 'platform_admin', mustChangePassword: false };
const support = { ...admin, role: 'support' };
const planInput = {
  key: 'starter', name: 'Starter', currency: 'USD',
  entitlements: { staff_seats: 3, packages: 10, features: { ai_itinerary_builder: true } },
};
const reason = 'Approved by account lead';

const cookie = (session) => {
  staff.findLiveSession.mockResolvedValue(session);
  return 'platform_session=abc';
};
const get = (path, session = admin) => request(app).get(`/api/v1/platform${path}`).set('Cookie', cookie(session));
const post = (path, body, session = admin) => request(app).post(`/api/v1/platform${path}`).set('Cookie', cookie(session)).send(body);
const put = (path, body, session = admin) => request(app).put(`/api/v1/platform${path}`).set('Cookie', cookie(session)).send(body);
const remove = (path, body, session = admin) => request(app).delete(`/api/v1/platform${path}`).set('Cookie', cookie(session)).send(body);

beforeEach(() => {
  for (const mock of Object.values({ ...staff, ...plans, ...agencies }).filter((value) => typeof value?.mockReset === 'function')) mock.mockReset();
  staff.findLiveSession.mockResolvedValue(admin);
  plans.listPlans.mockResolvedValue([]);
  plans.createPlan.mockResolvedValue({ id: PLAN_ID, key: planInput.key });
  plans.createPlanVersion.mockResolvedValue({ version: 2 });
  plans.findPlanVersion.mockResolvedValue({ ...planInput, id: VERSION_ID, archivedAt: null });
  plans.findPlan.mockResolvedValue({ id: PLAN_ID, key: planInput.key });
  plans.archivePlan.mockResolvedValue(true);
  plans.getAgencyPlan.mockResolvedValue({ assignment: null, overrides: [] });
  plans.assignAgencyPlan.mockResolvedValue({ planVersionId: VERSION_ID });
  plans.setAgencyOverride.mockResolvedValue({ entitlementKey: 'staff_seats', value: 5 });
  plans.removeAgencyOverride.mockResolvedValue(true);
  agencies.findAgency.mockResolvedValue({ id: AGENCY_ID, status: 'active' });
});

describe('platform plan API', () => {
  it('lets support staff read the plan catalog', async () => {
    const res = await get('/plans', support);
    expect(res.status).toBe(200);
    expect(plans.listPlans).toHaveBeenCalledOnce();
  });

  it('restricts plan writes to platform admins', async () => {
    const res = await post('/plans', planInput, support);
    expect(res.status).toBe(403);
    expect(plans.createPlan).not.toHaveBeenCalled();
  });

  it('rejects unsupported entitlement keys when creating a plan', async () => {
    const res = await post('/plans', { ...planInput, entitlements: { staff: 3 } });
    expect(res.status).toBe(400);
    expect(plans.createPlan).not.toHaveBeenCalled();
  });

  it('creates a normalized versioned plan', async () => {
    const res = await post('/plans', planInput);
    expect(res.status).toBe(201);
    expect(plans.createPlan).toHaveBeenCalledWith(expect.objectContaining({
      key: 'starter', entitlements: expect.objectContaining({ staff_seats: 3, packages: 10 }),
    }), expect.objectContaining({ platformUser: admin }));
  });

  it('returns a conflict when the plan key already exists', async () => {
    plans.createPlan.mockRejectedValueOnce({ code: '23505' });

    const res = await post('/plans', planInput);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already uses that key/);
  });

  it('requires a reason before assigning a plan to an agency', async () => {
    const res = await put(`/agencies/${AGENCY_ID}/plan`, { planVersionId: VERSION_ID });
    expect(res.status).toBe(400);
    expect(plans.assignAgencyPlan).not.toHaveBeenCalled();
  });

  it('rejects an unsupported agency override key', async () => {
    const res = await put(`/agencies/${AGENCY_ID}/overrides/not_a_real_limit`, { value: 5, reason });
    expect(res.status).toBe(400);
    expect(plans.setAgencyOverride).not.toHaveBeenCalled();
  });

  it('requires a reason when removing an agency override', async () => {
    const res = await remove(`/agencies/${AGENCY_ID}/overrides/staff_seats`, {});
    expect(res.status).toBe(400);
    expect(plans.removeAgencyOverride).not.toHaveBeenCalled();
  });
});
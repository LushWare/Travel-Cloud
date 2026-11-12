import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { buildUserRow, authHeaders, stubMemberships, stubPlanChecks } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    membership: {
      findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';

describe('Sales Rep API — /api/v1/sales-reps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPlanChecks(mockPrisma);
    stubMemberships(mockPrisma.membership);
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ role: 'salesRep' }));
  });

  it('returns 401 without auth headers', async () => {
    const res = await request(app).get('/api/v1/sales-reps');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin role', async () => {
    const res = await request(app)
      .get('/api/v1/sales-reps')
      .set(authHeaders({ role: 'salesRep' }));
    expect(res.status).toBe(403);
  });

  it('GET / returns a flat array with top-level pagination', async () => {
    mockPrisma.user.findMany.mockResolvedValue([buildUserRow({ role: 'salesRep' })]);
    mockPrisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toEqual({ total: 1, page: 1, limit: 10, pages: 1 });
  });

  it('POST / creates a sales rep', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'salesRep' }));

    const res = await request(app)
      .post('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya Nair', email: 'priya@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.tempPassword).toBeUndefined();
  });

  it('POST / rejects a payload with an unknown field (role is not client-settable)', async () => {
    const res = await request(app)
      .post('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya Nair', email: 'priya@test.com', role: 'admin' });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('GET /online-status returns reps active within the last 5 minutes', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/sales-reps/online-status')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
  });

  it('GET /:id/performance returns the documented stub shape', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ id: ID, role: 'salesRep', name: 'Priya Nair' }));

    const res = await request(app)
      .get(`/api/v1/sales-reps/${ID}/performance`)
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(res.body.data.metrics.note).toMatch(/analytics-service/);
  });

  it('PATCH /:id/commission saves the new rate', async () => {
    mockPrisma.user.update.mockResolvedValue(buildUserRow({ id: ID, role: 'salesRep', commissionRate: 20 }));

    const res = await request(app)
      .patch(`/api/v1/sales-reps/${ID}/commission`)
      .set(authHeaders({ role: 'admin' }))
      .send({ commissionRate: 20 });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: ID }, data: { commissionRate: 20 } });
  });

  it('DELETE /:id returns 404 when the rep does not exist', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/v1/sales-reps/${ID}`)
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(404);
  });
});

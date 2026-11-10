import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { buildUserRow, authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    vendorProfile: {
      groupBy: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';

describe('Vendor API — /api/v1/vendors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ role: 'vendor' }));
  });

  it('returns 401 without auth headers', async () => {
    const res = await request(app).get('/api/v1/vendors');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin role', async () => {
    const res = await request(app)
      .get('/api/v1/vendors')
      .set(authHeaders({ role: 'vendor' }));
    expect(res.status).toBe(403);
  });

  it('GET / returns a flat array with top-level pagination', async () => {
    mockPrisma.user.findMany.mockResolvedValue([buildUserRow({ role: 'vendor' })]);
    mockPrisma.user.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/vendors')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toEqual({ total: 1, page: 1, limit: 10, pages: 1 });
  });

  it('GET /?vendorStatus=suspended actually filters by vendorStatus (regression for the fixed bug)', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/vendors?vendorStatus=suspended')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'vendor', vendorProfile: { vendorStatus: 'suspended' } },
    }));
  });

  it('POST / creates a vendor with a nested vendorProfile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'vendor' }));

    const res = await request(app)
      .post('/api/v1/vendors')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Sunrise Hotels', email: 'sunrise@test.com', serviceType: 'hotel' });

    expect(res.status).toBe(201);
    expect(res.body.data.tempPassword).toBeUndefined();
  });

  it('POST / rejects an unknown serviceType', async () => {
    const res = await request(app)
      .post('/api/v1/vendors')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Sunrise Hotels', email: 'sunrise@test.com', serviceType: 'spaceship' });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('PATCH /:id/status updates vendorStatus', async () => {
    mockPrisma.vendorProfile.update.mockResolvedValue({ userId: ID, vendorStatus: 'verified' });

    const res = await request(app)
      .patch(`/api/v1/vendors/${ID}/status`)
      .set(authHeaders({ role: 'admin' }))
      .send({ vendorStatus: 'verified' });

    expect(res.status).toBe(200);
  });

  it('PATCH /:id/rating rejects a rating above 5', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ID}/rating`)
      .set(authHeaders({ role: 'admin' }))
      .send({ rating: 9 });

    expect(res.status).toBe(400);
    expect(mockPrisma.vendorProfile.update).not.toHaveBeenCalled();
  });

  it('GET /by-service/:serviceType returns vendors for a valid service type', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/vendors/by-service/hotel')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
  });

  it('GET /by-service/:serviceType returns 400 for an invalid service type', async () => {
    const res = await request(app)
      .get('/api/v1/vendors/by-service/spaceship')
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(400);
  });

  it('DELETE /:id returns 404 when the vendor does not exist', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/v1/vendors/${ID}`)
      .set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(404);
  });
});

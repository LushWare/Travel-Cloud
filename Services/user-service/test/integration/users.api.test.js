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
      groupBy: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

describe('User API — /api/v1/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPlanChecks(mockPrisma);
    stubMemberships(mockPrisma.membership);
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ role: 'salesRep' }));
  });

  describe('GET /profile/me', () => {
    it('returns the acting user profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(buildUserRow({ id: 'a0000000-0000-4000-8000-000000000099' }));

      const res = await request(app)
        .get('/api/v1/users/profile/me')
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data.user.password).toBeUndefined();
    });

    it('returns 401 without auth headers', async () => {
      const res = await request(app).get('/api/v1/users/profile/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /profile', () => {
    it('updates the acting user profile without requiring admin role', async () => {
      mockPrisma.user.update.mockResolvedValue(buildUserRow({ name: 'New Name' }));

      const res = await request(app)
        .put('/api/v1/users/profile')
        .set(authHeaders({ role: 'customer' }))
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe('New Name');
    });
  });

  describe('GET / (list)', () => {
    it('returns 403 for a non-admin role', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set(authHeaders({ role: 'customer' }));

      expect(res.status).toBe(403);
    });

    it('returns a flat array in data with top-level pagination for an admin', async () => {
      mockPrisma.user.findMany.mockResolvedValue([buildUserRow()]);
      mockPrisma.user.count.mockResolvedValue(1);

      const res = await request(app)
        .get('/api/v1/users')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toEqual({ total: 1, page: 1, limit: 10, pages: 1 });
    });

    it('allows superAdmin regardless of role header (isSuperAdmin bypass)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/v1/users')
        .set(authHeaders({ role: 'customer', isSuperAdmin: true }));

      expect(res.status).toBe(200);
    });

    it('returns 400 for an invalid role filter', async () => {
      const res = await request(app)
        .get('/api/v1/users?role=ceo')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(400);
    });
  });

  describe('POST / (create)', () => {
    it('creates a user and returns 201 without any password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'customer' }));

      const res = await request(app)
        .post('/api/v1/users')
        .set(authHeaders({ role: 'admin' }))
        .send({ name: 'New Customer', email: 'newcustomer@test.com', role: 'customer' });

      expect(res.status).toBe(201);
      expect(res.body.data.tempPassword).toBeUndefined();
    });

    it('returns 400 when the payload fails validation', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set(authHeaders({ role: 'admin' }))
        .send({ name: '', email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('returns 403 for a non-admin caller', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .set(authHeaders({ role: 'salesRep' }))
        .send({ name: 'X', email: 'x@test.com', role: 'customer' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /:id', () => {
    it('returns 404 when the user is not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/users/a0000000-0000-4000-8000-000000000001')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed id', async () => {
      const res = await request(app)
        .get('/api/v1/users/not-a-uuid')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 403 when the user cannot be deleted', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ canBeDeleted: false }));

      const res = await request(app)
        .delete('/api/v1/users/a0000000-0000-4000-8000-000000000001')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /:id/role', () => {
    it("changes the person's role in this agency, not on their account", async () => {
      const userId = 'a0000000-0000-4000-8000-000000000001';
      mockPrisma.membership.findMany.mockResolvedValue([
        { id: 'm-1', userId, role: 'vendor', permissions: [], isOwner: false, status: 'active' },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ id: userId, role: 'salesRep' }));

      const res = await request(app)
        .patch(`/api/v1/users/${userId}/role`)
        .set(authHeaders({ role: 'admin' }))
        .send({ role: 'vendor' });

      expect(res.status).toBe(200);
      expect(mockPrisma.membership.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'vendor', isOwner: false } }));
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(res.body.data.user.role).toBe('vendor');
    });
  });

  describe('GET /stats', () => {
    it('returns aggregate stats for an admin', async () => {
      mockPrisma.membership.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2);
      mockPrisma.membership.groupBy.mockResolvedValue([{ role: 'salesRep', _count: 10 }]);

      const res = await request(app)
        .get('/api/v1/users/stats')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(10);
    });
  });
});

describe('User API — health & unknown routes', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 404 for an unknown route', async () => {
    const res = await request(app)
      .get('/api/v1/users/not/a/real/route/at/all')
      .set(authHeaders({ role: 'admin' }));
    expect(res.status).toBe(404);
  });
});

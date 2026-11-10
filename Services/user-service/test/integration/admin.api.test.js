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
      groupBy: vi.fn(),
    },
    organizationSettings: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';

describe('Admin API — /api/v1/admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ role: 'admin' }));
  });

  describe('GET /internal/organization-settings', () => {
    it('returns settings for a valid internal token, bypassing user auth entirely', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
      mockPrisma.organizationSettings.findFirst.mockResolvedValue({ id: 'org-1', bankAccountNumber: '999' });

      const res = await request(app)
        .get('/api/v1/admin/internal/organization-settings')
        .set('x-internal-token', 'test-internal-key');

      expect(res.status).toBe(200);
      expect(res.body.data.settings.bankAccountNumber).toBe('999');
    });

    it('returns 401 for a missing/incorrect internal token', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';

      const res = await request(app)
        .get('/api/v1/admin/internal/organization-settings')
        .set('x-internal-token', 'wrong-key');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /organization-branding', () => {
    it('is available to any authenticated role, not just admin', async () => {
      mockPrisma.organizationSettings.findFirst.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });

      const res = await request(app)
        .get('/api/v1/admin/organization-branding')
        .set(authHeaders({ role: 'salesRep' }));

      expect(res.status).toBe(200);
      expect(res.body.data.branding.companyName).toBe('Lush Travel');
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/admin/organization-branding');
      expect(res.status).toBe(401);
    });
  });

  describe('admin-gated routes', () => {
    it('returns 403 for a non-admin/superAdmin role', async () => {
      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set(authHeaders({ role: 'salesRep' }));

      expect(res.status).toBe(403);
    });

    it('GET /stats returns dashboard stats for an admin', async () => {
      mockPrisma.user.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
      mockPrisma.user.groupBy.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/admin/stats')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(5);
    });

    it('GET /permissions/available lists the canonical permissions', async () => {
      const res = await request(app)
        .get('/api/v1/admin/permissions/available')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
      expect(res.body.data.permissions).toContain('manage_users');
    });

    it('POST /users creates staff and returns 201', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'admin' }));

      const res = await request(app)
        .post('/api/v1/admin/users')
        .set(authHeaders({ role: 'admin' }))
        .send({ name: 'New Admin', email: 'newadmin@test.com', role: 'admin' });

      expect(res.status).toBe(201);
      expect(res.body.data.tempPassword).toBeUndefined();
    });

    it('POST /users rejects an invalid permission on create', async () => {
      const res = await request(app)
        .post('/api/v1/admin/users')
        .set(authHeaders({ role: 'admin' }))
        .send({ name: 'New Admin', email: 'newadmin@test.com', role: 'admin', permissions: ['not_real'] });

      expect(res.status).toBe(400);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('PATCH /users/:id/permissions updates the permission list', async () => {
      mockPrisma.user.update.mockResolvedValue(buildUserRow({ permissions: ['manage_leads'] }));

      const res = await request(app)
        .patch(`/api/v1/admin/users/${ID}/permissions`)
        .set(authHeaders({ role: 'admin' }))
        .send({ permissions: ['manage_leads'] });

      expect(res.status).toBe(200);
    });

    it('no longer offers an endpoint that hands back someone else\'s password', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/users/${ID}/reset-password`)
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).not.toBe(200);
      expect(res.body.data?.tempPassword).toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses a normal admin who tries to create a super admin', async () => {
      const res = await request(app)
        .post('/api/v1/admin/users')
        .set(authHeaders({ role: 'admin' }))
        .send({ name: 'Sneaky', email: 'sneaky@test.com', role: 'superAdmin' });

      expect(res.status).toBe(403);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('PUT /settings rejects unknown fields (strict contract)', async () => {
      const res = await request(app)
        .put('/api/v1/admin/settings')
        .set(authHeaders({ role: 'admin' }))
        .send({ notARealSetting: true });

      expect(res.status).toBe(400);
    });
  });

  describe('superAdmin-only sub-router', () => {
    it('returns 403 for a plain admin', async () => {
      const res = await request(app)
        .get('/api/v1/admin/super/list')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(403);
    });

    it('GET /super/list succeeds for superAdmin', async () => {
      mockPrisma.user.findMany.mockResolvedValue([buildUserRow({ role: 'superAdmin' })]);

      const res = await request(app)
        .get('/api/v1/admin/super/list')
        .set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }));

      expect(res.status).toBe(200);
    });

    it('POST /super/promote requires a UUID userId', async () => {
      const res = await request(app)
        .post('/api/v1/admin/super/promote')
        .set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }))
        .send({ userId: 'not-a-uuid' });

      expect(res.status).toBe(400);
    });

    it('POST /super/promote succeeds with a valid userId', async () => {
      mockPrisma.user.update.mockResolvedValue(buildUserRow({ role: 'superAdmin', isSuperAdmin: true }));

      const res = await request(app)
        .post('/api/v1/admin/super/promote')
        .set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }))
        .send({ userId: ID });

      expect(res.status).toBe(200);
    });
  });
});

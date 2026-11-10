import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), groupBy: vi.fn(),
    },
    organizationSettings: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    policyDocument: {
      findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';

describe('Policy Documents API — /api/v1/admin/policy-documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /internal/policy-documents', () => {
    it('returns documents for a valid internal token, bypassing user auth entirely', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
      mockPrisma.policyDocument.findMany.mockResolvedValue([{ id: ID, title: 'Refunds', body: 'Full refund within 24h.' }]);

      const res = await request(app)
        .get('/api/v1/admin/internal/policy-documents')
        .set('x-internal-token', 'test-internal-key');

      expect(res.status).toBe(200);
      expect(res.body.data.documents[0].title).toBe('Refunds');
    });

    it('returns 401 for a missing/incorrect internal token', async () => {
      process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';

      const res = await request(app)
        .get('/api/v1/admin/internal/policy-documents')
        .set('x-internal-token', 'wrong-key');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /policy-documents', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/v1/admin/policy-documents');
      expect(res.status).toBe(401);
    });

    it('returns 403 for a non-admin role', async () => {
      const res = await request(app)
        .get('/api/v1/admin/policy-documents')
        .set(authHeaders({ role: 'salesRep' }));

      expect(res.status).toBe(403);
    });

    it('returns the document list for an admin', async () => {
      mockPrisma.policyDocument.findMany.mockResolvedValue([{ id: ID, title: 'Refunds' }]);

      const res = await request(app)
        .get('/api/v1/admin/policy-documents')
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
      expect(res.body.data.documents).toHaveLength(1);
    });
  });

  describe('POST /policy-documents', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).post('/api/v1/admin/policy-documents').send({ title: 'Refunds', body: 'text' });
      expect(res.status).toBe(401);
    });

    it('creates a document for an admin', async () => {
      mockPrisma.policyDocument.create.mockResolvedValue({ id: ID, title: 'Refunds', body: 'Full refund within 24h.' });

      const res = await request(app)
        .post('/api/v1/admin/policy-documents')
        .set(authHeaders({ id: 'admin-42', role: 'admin' }))
        .send({ title: 'Refunds', body: 'Full refund within 24h.' });

      expect(res.status).toBe(201);
      expect(mockPrisma.policyDocument.create).toHaveBeenCalledWith({
        data: { title: 'Refunds', body: 'Full refund within 24h.', updatedById: 'admin-42' },
      });
    });
  });

  describe('PUT /policy-documents/:id', () => {
    it('returns 404 when the document does not exist', async () => {
      mockPrisma.policyDocument.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .put(`/api/v1/admin/policy-documents/${ID}`)
        .set(authHeaders({ role: 'admin' }))
        .send({ title: 'Updated' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /policy-documents/:id', () => {
    it('deletes an existing document for an admin', async () => {
      mockPrisma.policyDocument.findUnique.mockResolvedValue({ id: ID });
      mockPrisma.policyDocument.delete.mockResolvedValue({ id: ID });

      const res = await request(app)
        .delete(`/api/v1/admin/policy-documents/${ID}`)
        .set(authHeaders({ role: 'admin' }));

      expect(res.status).toBe(200);
    });
  });
});

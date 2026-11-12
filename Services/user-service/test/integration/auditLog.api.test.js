import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { auditLog: { findMany: vi.fn() } },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const entry = (n) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  action: 'staff.removed',
  summary: `Entry ${n}`,
  createdAt: new Date(Date.UTC(2026, 10, 11, 12, 0, n)).toISOString(),
});

describe('GET /api/v1/admin/audit-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
  });

  it('refuses a sales rep', async () => {
    const res = await request(app).get('/api/v1/admin/audit-log').set(authHeaders({ role: 'salesRep' }));

    expect(res.status).toBe(403);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns entries newest first for an admin', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([entry(2), entry(1)]);

    const res = await request(app).get('/api/v1/admin/audit-log').set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.summary)).toEqual(['Entry 2', 'Entry 1']);
    expect(res.body.pagination).toEqual({ limit: 50, nextCursor: null });
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
    }));
  });

  it('returns a cursor for the next page when there are more entries', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([entry(3), entry(2), entry(1)]);

    const res = await request(app).get('/api/v1/admin/audit-log?limit=2').set(authHeaders({ role: 'admin' }));

    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.nextCursor).toBe(entry(2).id);
  });

  it('continues after the given cursor', async () => {
    await request(app).get(`/api/v1/admin/audit-log?cursor=${entry(2).id}`).set(authHeaders({ role: 'admin' }));

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { id: entry(2).id }, skip: 1 }));
  });

  it('filters a whole group of actions by its prefix', async () => {
    await request(app).get('/api/v1/admin/audit-log?action=staff').set(authHeaders({ role: 'admin' }));

    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where).toEqual({ action: { startsWith: 'staff.' } });
  });

  it('filters by one exact action, a person and a date range covering the whole last day', async () => {
    await request(app)
      .get('/api/v1/admin/audit-log?action=settings.bank_details_changed&actorId=u-1&from=2026-11-01&to=2026-11-10')
      .set(authHeaders({ role: 'superAdmin' }));

    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where).toEqual({
      action: 'settings.bank_details_changed',
      actorId: 'u-1',
      createdAt: { gte: new Date('2026-11-01'), lte: new Date('2026-11-10T23:59:59.999Z') },
    });
  });

  it.each([
    ['an action with SQL in it', 'action=staff%27%3B--'],
    ['a limit over 100', 'limit=500'],
    ['a cursor that is not an id', 'cursor=abc'],
    ['an unknown filter', 'tenantId=00000000-0000-4000-8000-000000000003'],
  ])('rejects %s with 400', async (_label, query) => {
    const res = await request(app).get(`/api/v1/admin/audit-log?${query}`).set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(400);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

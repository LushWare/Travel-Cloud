import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { auditLog: { findMany: vi.fn() } },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const visit = (n, details) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: new Date(Date.UTC(2026, 10, 12, 10, n)).toISOString(),
  details,
});

describe('GET /api/v1/admin/support-access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
  });

  it('refuses a sales rep', async () => {
    const res = await request(app).get('/api/v1/admin/support-access').set(authHeaders({ role: 'salesRep' }));

    expect(res.status).toBe(403);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('returns each Lushware support visit with its date, length and reason', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      visit(2, { reason: 'Help with invoice PDF', minutes: 15, viewOnly: true }),
    ]);

    const res = await request(app).get('/api/v1/admin/support-access').set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{
      id: '00000000-0000-4000-8000-000000000002',
      startedAt: '2026-11-12T10:02:00.000Z',
      minutes: 15,
      reason: 'Help with invoice PDF',
    }]);
  });

  it('reads only support-visit entries, never plan changes or other audit history', async () => {
    await request(app).get('/api/v1/admin/support-access').set(authHeaders({ role: 'admin' }));

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { action: 'platform.help_access_started' },
      take: 10,
      select: { id: true, createdAt: true, details: true },
    }));
  });

  it('never returns which Lushware staff member visited', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([visit(1, { reason: 'Check', minutes: 30 })]);

    const res = await request(app).get('/api/v1/admin/support-access').set(authHeaders({ role: 'admin' }));

    expect(Object.keys(res.body.data[0]).sort()).toEqual(['id', 'minutes', 'reason', 'startedAt']);
  });

  it('shows a visit with missing details as unknown length and reason', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([visit(1, null)]);

    const res = await request(app).get('/api/v1/admin/support-access').set(authHeaders({ role: 'admin' }));

    expect(res.body.data[0]).toMatchObject({ minutes: null, reason: null });
  });

  it('no longer serves the full audit log', async () => {
    const res = await request(app).get('/api/v1/admin/audit-log').set(authHeaders({ role: 'admin' }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

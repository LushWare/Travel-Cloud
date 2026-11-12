import { describe, it, expect, vi, beforeEach } from 'vitest';

const AGENCY = '00000000-0000-4000-8000-000000000001';
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => AGENCY,
}));
const { mockM } = vi.hoisted(() => ({
  mockM: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

const { mockFindUnique, mockFindFirst, mockFindMany, mockCount, mockCreate, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../db/client.js', () => {
  const client = {
    user: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      count: mockCount,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
    membership: mockM,
  };
  return { default: client, identityPrisma: client };
});
vi.mock('../../services/plan.service.js', () => ({
  withStaffSeat: (operation) => operation({ user: { create: mockCreate }, membership: mockM }),
}));

import {
  getAllSalesReps, getSalesRepById, createSalesRep, updateSalesRep, deleteSalesRep,
  getSalesRepStats, toggleSalesRepStatus, getSalesRepPerformance,
  updateSalesRepCommission, getOnlineSalesReps,
} from '../salesRep.controller.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REP_MEMBERSHIP = { id: 'm-1', userId: ID, role: 'salesRep', permissions: [], isOwner: false, status: 'active', joinedAt: new Date() };
const inAgency = (where) => ({ memberships: { some: { tenantId: AGENCY, ...where } } });
const ACTOR = { id: '22222222-2222-4222-8222-222222222222', role: 'admin', tenantId: '00000000-0000-4000-8000-000000000001' };

function buildReqRes({ body = {}, params = {}, query = {}, user = ACTOR } = {}) {
  const req = { body, params, query, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockFindFirst.mockReset();
  mockFindMany.mockReset();
  mockCount.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  Object.values(mockM).forEach((fn) => fn.mockReset());
  mockM.findFirst.mockResolvedValue(REP_MEMBERSHIP);
  mockM.findMany.mockResolvedValue([]);
});

describe('getAllSalesReps', () => {
  it('scopes the query to role: salesRep and returns a flat array + top-level pagination', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, role: 'salesRep', password: 'hash' }]);
    mockCount.mockResolvedValue(1);
    const { req, res, next } = buildReqRes();

    await getAllSalesReps(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: inAgency({ role: 'salesRep' }) }));
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: [{ id: ID, role: 'salesRep', commissionRate: null }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });
  });
});

describe('getSalesRepById', () => {
  it('returns 404 when no salesRep with that id exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getSalesRepById(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('createSalesRep', () => {
  it('creates the user with role salesRep and a generated temp password', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: ID, role: 'salesRep', password: 'hashed' });
    const { req, res, next } = buildReqRes({ body: { name: 'Priya Nair', email: 'priya@test.com' } });

    await createSalesRep(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'salesRep', isTempPassword: true, mustChangePassword: true }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects a duplicate email', async () => {
    mockFindUnique.mockResolvedValue({ id: 'existing' });
    const { req, res, next } = buildReqRes({ body: { name: 'Priya Nair', email: 'priya@test.com' } });

    await createSalesRep(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateSalesRep', () => {
  it('updates the provided fields', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep' });
    mockUpdate.mockResolvedValue({ id: ID, name: 'Updated Rep' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'Updated Rep' } });

    await updateSalesRep(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { name: 'Updated Rep' } });
  });

  it('only reaches people who are sales reps in this agency', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep' });
    mockUpdate.mockResolvedValue({ id: ID });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'x' } });

    await updateSalesRep(req, res, next);

    expect(mockM.findFirst.mock.calls[0][0].where).toEqual({ userId: ID, role: 'salesRep' });
  });

  it('returns 404 instead of editing someone who is not a sales rep here', async () => {
    mockM.findFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { email: 'attacker@evil.com' } });

    await updateSalesRep(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stops a normal admin from editing an agency owner through this endpoint', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep' });
    mockM.findFirst.mockResolvedValue({ ...REP_MEMBERSHIP, isOwner: true });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { email: 'attacker@evil.com' }, user: { id: '99999999-9999-4999-8999-999999999999', role: 'admin', isSuperAdmin: false } });

    await updateSalesRep(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('updateSalesRep email', () => {
  it("refuses to change a rep's login email, which their other agencies also use", async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep', email: 'rep@test.com' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { email: 'new@test.com' } });

    await updateSalesRep(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('accepts the form when the email is unchanged', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep', email: 'rep@test.com' });
    mockUpdate.mockResolvedValue({ id: ID, name: 'Rep' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { email: 'rep@test.com', name: 'Rep' } });

    await updateSalesRep(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { name: 'Rep' } });
  });
});

describe('deleteSalesRep', () => {
  it('removes the rep from this agency only, keeping their account', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep' });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteSalesRep(req, res, next);

    expect(mockM.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 404 when the rep is not in this agency', async () => {
    mockM.findFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteSalesRep(req, res, next);

    expect(mockM.delete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('getSalesRepStats', () => {
  it('returns total/active/inactive scoped to salesRep', async () => {
    mockM.count.mockResolvedValueOnce(6).mockResolvedValueOnce(4);
    const { req, res, next } = buildReqRes();

    await getSalesRepStats(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { total: 6, active: 4, inactive: 2 } });
  });
});

describe('toggleSalesRepStatus', () => {
  it('suspends the rep in this agency without deactivating their account', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep', isActive: true });
    mockM.findMany.mockResolvedValue([REP_MEMBERSHIP]);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await toggleSalesRepStatus(req, res, next);

    expect(mockM.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { status: 'suspended' } });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('getSalesRepPerformance (documented stub)', () => {
  it('returns a placeholder note instead of real metrics', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, name: 'Priya Nair', role: 'salesRep' });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getSalesRepPerformance(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { salesRepId: ID, name: 'Priya Nair', metrics: { note: 'Detailed performance available via analytics-service' } },
    });
  });
});

describe('updateSalesRepCommission', () => {
  it('saves the new commission rate', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'salesRep' });
    mockUpdate.mockResolvedValue({ id: ID, role: 'salesRep', commissionRate: 15 });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { commissionRate: 15 } });

    await updateSalesRepCommission(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { commissionRate: 15 } });
    expect(res.json.mock.calls[0][0].data.salesRep.commissionRate).toBe(15);
  });

  it('still rejects a malformed id with 400', async () => {
    const { req, res, next } = buildReqRes({ params: { id: 'not-a-uuid' } });

    await updateSalesRepCommission(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getOnlineSalesReps', () => {
  it('queries active reps with lastActivity within the 5-minute cutoff', async () => {
    mockFindMany.mockResolvedValue([]);
    const { req, res, next } = buildReqRes();

    await getOnlineSalesReps(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        lastActivity: { gte: expect.any(Date) },
        ...inAgency({ role: 'salesRep', status: { in: ['active', 'invited'] } }),
      }),
    }));
  });
});

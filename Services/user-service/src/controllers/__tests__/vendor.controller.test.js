import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockFindFirst, mockFindMany, mockCount, mockCreate, mockUpdate, mockDelete, mockVpGroupBy, mockVpUpdate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockVpGroupBy: vi.fn(),
  mockVpUpdate: vi.fn(),
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
    vendorProfile: {
      groupBy: mockVpGroupBy,
      update: mockVpUpdate,
    },
  };
  return { default: client, identityPrisma: client };
});

import {
  getAllVendors, getVendorById, createVendor, updateVendor, deleteVendor, getVendorStats,
  toggleVendorStatus, getVendorPerformance, updateVendorStatus,
  updateVendorRating, getVendorsByServiceType,
} from '../vendor.controller.js';

const ID = '11111111-1111-4111-8111-111111111111';
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
  mockVpGroupBy.mockReset();
  mockVpUpdate.mockReset();
  mockFindFirst.mockResolvedValue({ id: ID, role: 'vendor' });
});

describe('getAllVendors', () => {
  it('scopes to role: vendor with flat data + top-level pagination', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, role: 'vendor', password: 'hash' }]);
    mockCount.mockResolvedValue(1);
    const { req, res, next } = buildReqRes();

    await getAllVendors(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'vendor' } }));
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: [{ id: ID, role: 'vendor' }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });
  });

  it('filters by serviceType', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const { req, res, next } = buildReqRes({ query: { serviceType: 'hotel' } });

    await getAllVendors(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'vendor', vendorProfile: { serviceType: 'hotel' } },
    }));
  });

  it('filters by vendorStatus (regression: this was previously silently ignored)', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const { req, res, next } = buildReqRes({ query: { vendorStatus: 'suspended' } });

    await getAllVendors(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'vendor', vendorProfile: { vendorStatus: 'suspended' } },
    }));
  });

  it('combines serviceType and vendorStatus filters', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const { req, res, next } = buildReqRes({ query: { serviceType: 'hotel', vendorStatus: 'verified' } });

    await getAllVendors(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'vendor', vendorProfile: { serviceType: 'hotel', vendorStatus: 'verified' } },
    }));
  });

  it('rejects an invalid vendorStatus filter with 400', async () => {
    const { req, res, next } = buildReqRes({ query: { vendorStatus: 'bogus' } });

    await getAllVendors(req, res, next);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getVendorById', () => {
  it('returns 404 when not found', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getVendorById(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('createVendor', () => {
  const valid = { name: 'Sunrise Hotels', email: 'sunrise@test.com' };

  it('creates the vendor with a nested vendorProfile', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({
      body: { ...valid, businessName: 'Sunrise', serviceType: 'hotel', address: { city: 'Colombo' } },
    });
    mockCreate.mockResolvedValue({ id: ID, role: 'vendor', password: 'hashed', vendorProfile: { businessName: 'Sunrise' } });

    await createVendor(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'vendor',
        vendorProfile: { create: expect.objectContaining({ businessName: 'Sunrise', serviceType: 'hotel', addressCity: 'Colombo' }) },
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects an unknown serviceType before touching the DB', async () => {
    const { req, res, next } = buildReqRes({ body: { ...valid, serviceType: 'spaceship' } });

    await createVendor(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateVendor', () => {
  it('maps nested address/contactPerson/bankDetails fields onto the vendorProfile update', async () => {
    mockUpdate.mockResolvedValue({ id: ID, vendorProfile: {} });
    const { req, res, next } = buildReqRes({
      params: { id: ID },
      body: { address: { city: 'Kandy' }, bankDetails: { accountNumber: '999' } },
    });

    await updateVendor(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: ID },
      data: {
        vendorProfile: { update: { addressCity: 'Kandy', bankAccountNumber: '999' } },
      },
      include: { vendorProfile: true },
    });
  });
});

describe('deleteVendor', () => {
  it('returns 404 when the vendor does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteVendor(req, res, next);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('getVendorStats', () => {
  it('returns total/active/inactive/byServiceType', async () => {
    mockCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    mockVpGroupBy.mockResolvedValue([{ serviceType: 'hotel', _count: 3 }]);
    const { req, res, next } = buildReqRes();

    await getVendorStats(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { total: 3, active: 2, inactive: 1, byServiceType: [{ serviceType: 'hotel', _count: 3 }] },
    });
  });
});

describe('toggleVendorStatus', () => {
  it('flips isActive for an existing vendor', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'vendor', isActive: false });
    mockUpdate.mockResolvedValue({ id: ID, isActive: true });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await toggleVendorStatus(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { isActive: true } });
  });
});

describe('vendor account protection', () => {
  it('returns 404 instead of editing an account that is not a vendor', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'x' } });

    await updateVendor(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('only changes the status of a vendor account', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { vendorStatus: 'verified' } });

    await updateVendorStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockVpUpdate).not.toHaveBeenCalled();
  });
});

describe('getVendorPerformance', () => {
  it('returns the vendorProfile for an existing vendor', async () => {
    mockFindFirst.mockResolvedValue({ id: ID, role: 'vendor', vendorProfile: { rating: 4.2 } });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getVendorPerformance(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { vendorId: ID, profile: { rating: 4.2 } } });
  });
});

describe('updateVendorStatus', () => {
  it('updates the vendorProfile.vendorStatus field', async () => {
    mockVpUpdate.mockResolvedValue({ userId: ID, vendorStatus: 'verified' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { vendorStatus: 'verified' } });

    await updateVendorStatus(req, res, next);

    expect(mockVpUpdate).toHaveBeenCalledWith({ where: { userId: ID }, data: { vendorStatus: 'verified' } });
  });

  it('rejects an invalid vendorStatus value', async () => {
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { vendorStatus: 'nope' } });

    await updateVendorStatus(req, res, next);

    expect(mockVpUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateVendorRating', () => {
  it('coerces and stores the rating', async () => {
    mockVpUpdate.mockResolvedValue({ userId: ID, rating: 4.5 });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { rating: '4.5' } });

    await updateVendorRating(req, res, next);

    expect(mockVpUpdate).toHaveBeenCalledWith({ where: { userId: ID }, data: { rating: 4.5 } });
  });

  it('rejects a rating above 5', async () => {
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { rating: 9 } });

    await updateVendorRating(req, res, next);

    expect(mockVpUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getVendorsByServiceType', () => {
  it('returns vendors filtered by the serviceType param', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, password: 'hash' }]);
    const { req, res, next } = buildReqRes({ params: { serviceType: 'hotel' } });

    await getVendorsByServiceType(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'vendor', vendorProfile: { serviceType: 'hotel' } },
    }));
    expect(res.json).toHaveBeenCalledWith({ status: 'success', count: 1, data: [{ id: ID }] });
  });

  it('rejects an unknown serviceType param', async () => {
    const { req, res, next } = buildReqRes({ params: { serviceType: 'spaceship' } });

    await getVendorsByServiceType(req, res, next);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

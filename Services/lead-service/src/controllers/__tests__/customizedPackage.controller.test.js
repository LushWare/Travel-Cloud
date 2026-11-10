import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests call handlers directly, so they run as one fixed agency.
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

const {
  mockLeadCreate,
  mockLeadFindMany,
  mockCustomizedPackageCreate,
  mockCustomizedPackageFindUnique,
  mockCustomizedPackageUpdate,
  mockSettingsUpsert,
  mockSettingsUpdate,
  mockTransaction,
  mockFetchPackage,
} = vi.hoisted(() => ({
  mockLeadCreate: vi.fn(),
  mockLeadFindMany: vi.fn(),
  mockCustomizedPackageCreate: vi.fn(),
  mockCustomizedPackageFindUnique: vi.fn(),
  mockCustomizedPackageUpdate: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockFetchPackage: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: { create: mockLeadCreate, findMany: mockLeadFindMany },
    customizedPackage: {
      create: mockCustomizedPackageCreate,
      findUnique: mockCustomizedPackageFindUnique,
      update: mockCustomizedPackageUpdate,
    },
    settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../services/lead-draft.service.js', () => ({ fetchPackage: mockFetchPackage }));

import {
  createWebsiteCustomizedPackage,
  fetchMyCustomizedPackages,
  getCustomizedPackageById,
  updateCustomizedPackage,
} from '../customizedPackage.controller.js';

function buildReqRes({ body = {}, params = {}, user = null } = {}) {
  const req = { body, params, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

const txLead = () => ({ create: mockLeadCreate });
const txCustomizedPackage = () => ({ create: mockCustomizedPackageCreate });
const txSettings = () => ({ upsert: mockSettingsUpsert, update: mockSettingsUpdate });

describe('createWebsiteCustomizedPackage', () => {
  beforeEach(() => {
    mockLeadCreate.mockReset();
    mockCustomizedPackageCreate.mockReset();
    mockSettingsUpsert.mockReset();
    mockSettingsUpdate.mockReset();
    mockFetchPackage.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) =>
      fn({ lead: txLead(), customizedPackage: txCustomizedPackage(), settings: txSettings() }),
    );
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', assignmentMode: 'manual', autoStrategy: 'round_robin', enabledSalesRepIds: [], roundRobinIndex: 0 });
  });

  const validBody = {
    packageId: 'pkg-1',
    name: 'Jane Doe',
    email: 'JANE@Example.com',
    travelDate: '2027-01-01',
  };

  it('creates a lead + customized package inside one transaction and returns 201', async () => {
    mockFetchPackage.mockResolvedValue({
      id: 'pkg-1', title: 'Bali Getaway', destination: 'Bali', durationDays: 5, sellPrice: 1200, category: 'ADVENTURE',
    });
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });
    mockCustomizedPackageCreate.mockResolvedValue({ id: 'cp-1' });

    const { req, res, next } = buildReqRes({ body: validBody });
    await createWebsiteCustomizedPackage(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'jane@example.com', destination: 'Bali', tags: ['website-customization'] }),
    }));
    expect(mockCustomizedPackageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-1', originalPackageId: 'pkg-1', destination: 'Bali', duration: 5, price: 1200 }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { customizedPackageId: 'cp-1', leadId: 'lead-1', salesRepId: null },
    }));
  });

  it('throws a 404 when the package is not found', async () => {
    mockFetchPackage.mockRejectedValue(Object.assign(new Error('Package not found: pkg-1'), { statusCode: 404 }));

    const { req, res, next } = buildReqRes({ body: validBody });
    await createWebsiteCustomizedPackage(req, res, next);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejects an invalid payload with 400 and does not fetch the package', async () => {
    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe' } });
    await createWebsiteCustomizedPackage(req, res, next);

    expect(mockFetchPackage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('fetchMyCustomizedPackages', () => {
  beforeEach(() => {
    mockLeadFindMany.mockReset();
  });

  it('returns the flattened, createdAt-descending list for the matched leads', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', customizedPackages: [{ id: 'cp-1', createdAt: new Date('2027-01-01') }] },
      { id: 'lead-2', customizedPackages: [{ id: 'cp-2', createdAt: new Date('2027-02-01') }] },
    ]);

    const { req, res, next } = buildReqRes({ user: { email: 'Jane@Example.com' } });
    await fetchMyCustomizedPackages(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'jane@example.com' } }));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'cp-2', createdAt: new Date('2027-02-01') }, { id: 'cp-1', createdAt: new Date('2027-01-01') }],
    });
  });
});

describe('getCustomizedPackageById', () => {
  beforeEach(() => {
    mockCustomizedPackageFindUnique.mockReset();
  });

  it('returns a 404 AppError when not found', async () => {
    mockCustomizedPackageFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: 'missing' } });
    await getCustomizedPackageById(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('updateCustomizedPackage', () => {
  beforeEach(() => {
    mockCustomizedPackageFindUnique.mockReset();
    mockCustomizedPackageUpdate.mockReset();
  });

  it('updates an existing customized package', async () => {
    mockCustomizedPackageFindUnique.mockResolvedValue({ id: 'cp-1' });
    mockCustomizedPackageUpdate.mockResolvedValue({ id: 'cp-1', name: 'Updated' });

    const { req, res, next } = buildReqRes({ params: { id: 'cp-1' }, body: { name: 'Updated' } });
    await updateCustomizedPackage(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCustomizedPackageUpdate).toHaveBeenCalledWith({ where: { id: 'cp-1' }, data: { name: 'Updated' } });
  });
});

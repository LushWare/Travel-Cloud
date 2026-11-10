import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests call handlers directly, so they run as one fixed agency.
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

const {
  mockLeadCreate,
  mockLeadFindMany,
  mockManualItineraryCreate,
  mockManualItineraryFindFirst,
  mockManualItineraryFindUnique,
  mockManualItineraryUpdate,
  mockManualItineraryDelete,
  mockSettingsUpsert,
  mockSettingsUpdate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockLeadCreate: vi.fn(),
  mockLeadFindMany: vi.fn(),
  mockManualItineraryCreate: vi.fn(),
  mockManualItineraryFindFirst: vi.fn(),
  mockManualItineraryFindUnique: vi.fn(),
  mockManualItineraryUpdate: vi.fn(),
  mockManualItineraryDelete: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: { create: mockLeadCreate, findMany: mockLeadFindMany },
    manualItinerary: {
      create: mockManualItineraryCreate,
      findFirst: mockManualItineraryFindFirst,
      findUnique: mockManualItineraryFindUnique,
      update: mockManualItineraryUpdate,
      delete: mockManualItineraryDelete,
    },
    settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
    $transaction: mockTransaction,
  },
}));

import {
  createWebsiteManualItinerary,
  fetchMyManualItineraries,
  upsertManualItineraryForLead,
  deleteManualItinerary,
} from '../manualItinerary.controller.js';

function buildReqRes({ body = {}, params = {}, user = null } = {}) {
  const req = { body, params, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

const validBody = {
  name: 'Jane Doe',
  email: 'JANE@Example.com',
  days: [{ dayNumber: 1, title: 'Arrival' }],
};

describe('createWebsiteManualItinerary', () => {
  beforeEach(() => {
    mockLeadCreate.mockReset();
    mockManualItineraryCreate.mockReset();
    mockSettingsUpsert.mockReset();
    mockSettingsUpdate.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) =>
      fn({
        lead: { create: mockLeadCreate },
        manualItinerary: { create: mockManualItineraryCreate },
        settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
      }),
    );
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', assignmentMode: 'manual', autoStrategy: 'round_robin', enabledSalesRepIds: [], roundRobinIndex: 0 });
  });

  it('creates a lead + manual itinerary inside one transaction and returns 201', async () => {
    mockLeadCreate.mockResolvedValue({ id: 'lead-1' });
    mockManualItineraryCreate.mockResolvedValue({ id: 'mi-1' });

    const { req, res, next } = buildReqRes({ body: validBody });
    await createWebsiteManualItinerary(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'jane@example.com', tags: ['website-manual-itinerary'] }),
    }));
    expect(mockManualItineraryCreate).toHaveBeenCalledWith({
      data: { leadId: 'lead-1', days: validBody.days },
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: { leadId: 'lead-1', manualItineraryId: 'mi-1', salesRepId: null },
    }));
  });

  it('rejects an invalid payload (empty days) with 400', async () => {
    const { req, res, next } = buildReqRes({ body: { ...validBody, days: [] } });
    await createWebsiteManualItinerary(req, res, next);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('fetchMyManualItineraries', () => {
  beforeEach(() => {
    mockLeadFindMany.mockReset();
  });

  it('returns the flattened list with lead context attached', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-1', name: 'Jane Doe', destination: 'Bali', numberOfTravelers: 2,
        manualItineraries: [{ id: 'mi-1', createdAt: new Date('2027-01-01') }],
      },
    ]);

    const { req, res, next } = buildReqRes({ user: { email: 'jane@example.com' } });
    await fetchMyManualItineraries(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 'mi-1', createdAt: new Date('2027-01-01'), lead: { name: 'Jane Doe', destination: 'Bali', numberOfTravelers: 2 } }],
    });
  });
});

describe('upsertManualItineraryForLead', () => {
  beforeEach(() => {
    mockManualItineraryFindFirst.mockReset();
    mockManualItineraryCreate.mockReset();
    mockManualItineraryUpdate.mockReset();
  });

  it('creates a new manual itinerary when none exists for the lead', async () => {
    mockManualItineraryFindFirst.mockResolvedValue(null);
    mockManualItineraryCreate.mockResolvedValue({ id: 'mi-1' });

    const { req, res, next } = buildReqRes({ params: { leadId: 'lead-1' }, body: { days: validBody.days } });
    await upsertManualItineraryForLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockManualItineraryCreate).toHaveBeenCalledWith({ data: { leadId: 'lead-1', days: validBody.days } });
    expect(mockManualItineraryUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updates the same row (does not create a second one) when one already exists', async () => {
    mockManualItineraryFindFirst.mockResolvedValue({ id: 'mi-1' });
    mockManualItineraryUpdate.mockResolvedValue({ id: 'mi-1', version: 2 });

    const { req, res, next } = buildReqRes({ params: { leadId: 'lead-1' }, body: { days: validBody.days } });
    await upsertManualItineraryForLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockManualItineraryCreate).not.toHaveBeenCalled();
    expect(mockManualItineraryUpdate).toHaveBeenCalledWith({
      where: { id: 'mi-1' },
      data: { days: validBody.days, version: { increment: 1 } },
    });
  });
});

describe('deleteManualItinerary', () => {
  beforeEach(() => {
    mockManualItineraryFindUnique.mockReset();
    mockManualItineraryDelete.mockReset();
  });

  it('returns a 404 AppError when not found', async () => {
    mockManualItineraryFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: 'missing' } });
    await deleteManualItinerary(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockManualItineraryDelete).not.toHaveBeenCalled();
  });
});

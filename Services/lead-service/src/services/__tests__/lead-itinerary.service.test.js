import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLeadFindUnique,
  mockLeadUpdate,
  mockSelectionFindUnique,
  mockSelectionUpdate,
  mockPricingCreate,
  mockPricingUpdate,
  mockDayDeleteMany,
  mockLineDeleteMany,
  mockLineFindMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockLeadFindUnique: vi.fn(),
  mockLeadUpdate: vi.fn(),
  mockSelectionFindUnique: vi.fn(),
  mockSelectionUpdate: vi.fn(),
  mockPricingCreate: vi.fn(),
  mockPricingUpdate: vi.fn(),
  mockDayDeleteMany: vi.fn(),
  mockLineDeleteMany: vi.fn(),
  mockLineFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: { findUnique: mockLeadFindUnique, update: mockLeadUpdate },
    leadPackageSelection: { findUnique: mockSelectionFindUnique, update: mockSelectionUpdate },
    leadPricing: { create: mockPricingCreate, update: mockPricingUpdate },
    leadItineraryDay: { deleteMany: mockDayDeleteMany },
    leadCostLine: { deleteMany: mockLineDeleteMany, findMany: mockLineFindMany },
    $transaction: mockTransaction,
  },
}));

import {
  buildDaysCreateData,
  buildAutoCostLines,
  serializeLeadDays,
  applyLeadSelectionItinerary,
} from '../lead-itinerary.service.js';
import { computePricing, toLineDescriptor } from '../pricing.service.js';
import AppError from '../../utils/appError.js';

const editorDays = [
  {
    dayNumber: 1,
    title: 'Kandy',
    breakfastCount: 2,
    lunchCount: 1,
    dinnerCount: 1,
    accommodation: { totalAmount: 100 },
    flights: [],
    places: [{ placeId: 'p1', customName: 'Temple', orderIndex: 0 }],
    activities: [{ activityId: null, name: 'Tour', defaultCost: 50, costOverride: null }],
    transports: [{ routeType: 'DAILY_ROUTING', transportMode: 'VAN', pricingModel: 'PER_VEHICLE', unitCost: 300 }],
  },
];

const leadFixture = (overrides = {}) => ({
  id: 'lead-1',
  lifecycleStatus: 'NEW',
  numberOfTravelers: 2,
  primarySelectionId: null,
  ...overrides,
});

const selectionFixture = (overrides = {}) => ({
  id: 'sel-1',
  leadId: 'lead-1',
  packageId: 'pkg-1',
  isManual: false,
  pricing: null,
  costLines: [],
  itineraryDays: [],
  ...overrides,
});

describe('buildDaysCreateData', () => {
  it('maps editor days into nested prisma create payloads', () => {
    const data = buildDaysCreateData(editorDays);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      dayNumber: 1,
      breakfastCount: 2,
      accommodation: { totalAmount: 100 },
    });
    expect(data[0].places.create[0]).toEqual({ placeId: 'p1', customName: 'Temple', orderIndex: 0 });
    expect(data[0].activities.create[0]).toMatchObject({ name: 'Tour', defaultCost: 50 });
    expect(data[0].transports.create[0]).toMatchObject({ pricingModel: 'PER_VEHICLE', unitCost: 300 });
  });

  it('handles the editor day shape: string activities, activityCosts and locations', () => {
    const data = buildDaysCreateData([{
      dayNumber: 1,
      breakfastCount: 1,
      activities: ['Temple Tour', 'Tea Tasting'],
      activityCosts: {
        'Temple Tour': { defaultCost: 40, costOverride: 35 },
        'Tea Tasting': { defaultCost: 25, costOverride: null },
      },
      locations: ['Kandy', 'Tea Plantation'],
      transports: [],
    }]);
    expect(data[0].activities.create[0]).toEqual({
      activityId: null,
      name: 'Temple Tour',
      description: null,
      defaultCost: 40,
      costOverride: 35,
      orderIndex: 0,
    });
    expect(data[0].activities.create[1]).toMatchObject({ name: 'Tea Tasting', costOverride: null });
    expect(data[0].places.create).toEqual([
      { placeId: null, customName: 'Kandy', orderIndex: 0 },
      { placeId: null, customName: 'Tea Plantation', orderIndex: 1 },
    ]);
  });

  it('maps day images (object and plain-string shapes) into nested prisma create payloads', () => {
    const data = buildDaysCreateData([{
      dayNumber: 1,
      images: [
        { url: 'https://res.cloudinary.com/x/a.jpg', public_id: 'x/a' },
        'https://res.cloudinary.com/x/b.jpg',
      ],
    }]);
    expect(data[0].images.create).toEqual([
      { url: 'https://res.cloudinary.com/x/a.jpg', altText: null, orderIndex: 0 },
      { url: 'https://res.cloudinary.com/x/b.jpg', altText: null, orderIndex: 1 },
    ]);
  });

  it('resolves an activity description from the _relational catalog match', () => {
    const data = buildDaysCreateData([{
      dayNumber: 1,
      activities: ['Temple Tour'],
      locations: [],
      transports: [],
      _relational: {
        activities: [{ name: 'Temple Tour', activityId: 'a1', description: 'A guided tour of the temple.' }],
      },
    }]);
    expect(data[0].activities.create[0]).toMatchObject({
      name: 'Temple Tour',
      description: 'A guided tour of the temple.',
    });
  });

  it('leaves a freeform activity with no catalog match with a null description', () => {
    const data = buildDaysCreateData([{
      dayNumber: 1,
      activities: ['Made-up Activity'],
      locations: [],
      transports: [],
    }]);
    expect(data[0].activities.create[0]).toMatchObject({ name: 'Made-up Activity', description: null });
  });
});

describe('buildAutoCostLines', () => {
  it('builds persistence-shaped AUTO lines from editor days', () => {
    const lines = buildAutoCostLines(editorDays);
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'food', basis: 'PER_PERSON', estimatedUnitPrice: 60, source: 'AUTO' }),
      expect.objectContaining({ category: 'activity', basis: 'PER_PERSON', estimatedUnitPrice: 50, source: 'AUTO' }),
      expect.objectContaining({ category: 'transportation', basis: 'PER_VEHICLE', estimatedUnitPrice: 300, source: 'AUTO' }),
      expect.objectContaining({ category: 'accommodation', basis: 'PER_PERSON', estimatedUnitPrice: 100, source: 'AUTO' }),
    ]));
    expect(lines.every((l) => l.estimatedUnitPrice != null)).toBe(true);
  });

  it('uses activityCosts overrides from the editor shape', () => {
    const lines = buildAutoCostLines([{
      dayNumber: 1,
      activities: ['Temple Tour'],
      activityCosts: { 'Temple Tour': { defaultCost: 40, costOverride: 35 } },
    }]);
    const activity = lines.find((l) => l.category === 'activity');
    expect(activity.estimatedUnitPrice).toBe(35);
  });

  it('forwards a per-day mealPriceOverride into the meal cost line', () => {
    const lines = buildAutoCostLines([{
      dayNumber: 1,
      breakfastCount: 1,
      lunchCount: 1,
      dinnerCount: 1,
      mealPriceOverride: 100,
    }]);
    const food = lines.find((l) => l.category === 'food');
    expect(food.estimatedUnitPrice).toBe(300); // 3 meals × $100, not the $15 default
  });
});

describe('itinerary-cost edit → recomputed quote (workflow)', () => {
  const quote = (days, travelers = 2) =>
    computePricing({ lines: buildAutoCostLines(days).map(toLineDescriptor), travelers });

  it('reflects an edited meal price in the recomputed total', () => {
    const day = { dayNumber: 1, breakfastCount: 1, lunchCount: 1, dinnerCount: 1 };
    const withDefault = quote([{ ...day }]);                        // meals at $15
    const withOverride = quote([{ ...day, mealPriceOverride: 100 }]); // meals at $100

    expect(withOverride.totalAmount).toBeGreaterThan(withDefault.totalAmount);
    // 3 meals × $100 × 2 pax = $600 cost; must flow into the sell total, not $0.
    expect(withOverride.sellSubtotal).toBeGreaterThanOrEqual(600);
  });

  it('does not zero the total when a day carries real accommodation/activity costs', () => {
    const financials = quote([{
      dayNumber: 1, breakfastCount: 1, lunchCount: 0, dinnerCount: 1, mealPriceOverride: 50,
      accommodation: { totalAmount: 200 },
      activities: ['City Tour'],
      activityCosts: { 'City Tour': { defaultCost: 0, costOverride: 80 } },
    }]);
    expect(financials.totalAmount).toBeGreaterThan(0);
  });
});

describe('serializeLeadDays', () => {
  it('returns the editor day shape from persisted rows', () => {
    const lead = {
      itineraryDays: [{
        dayNumber: 1,
        title: 'Kandy',
        description: null,
        breakfastCount: 2,
        lunchCount: 1,
        dinnerCount: 1,
        mealPriceOverride: null,
        accommodation: { totalAmount: 100 },
        flights: [],
        places: [{ id: 'dp1', placeId: 'p1', customName: 'Temple', orderIndex: 0 }],
        activities: [{ id: 'da1', activityId: null, name: 'Tour', description: 'A guided tour.', defaultCost: '50.00', costOverride: null, orderIndex: 0 }],
        transports: [{ id: 'dt1', routeType: 'DAILY_ROUTING', transportMode: 'VAN', pricingModel: 'PER_VEHICLE', unitCost: '300.00', distanceKm: null, origin: null, destination: null }],
        images: [{ id: 'di1', url: 'https://res.cloudinary.com/x/a.jpg', altText: null, orderIndex: 0 }],
      }],
    };
    const days = serializeLeadDays(lead);
    expect(days[0]).toMatchObject({ dayNumber: 1, breakfastCount: 2 });
    expect(days[0].places[0]).toMatchObject({ placeId: 'p1', customName: 'Temple' });
    expect(days[0].activities[0].defaultCost).toBe(50);
    expect(days[0].activities[0].description).toBe('A guided tour.');
    expect(days[0].transports[0].unitCost).toBe(300);
    expect(days[0].images).toEqual([{ id: 'di1', url: 'https://res.cloudinary.com/x/a.jpg', altText: null, orderIndex: 0 }]);
  });

  it('returns an empty images array when a persisted day has none', () => {
    const days = serializeLeadDays({ itineraryDays: [{ dayNumber: 1, places: [], activities: [], transports: [] }] });
    expect(days[0].images).toEqual([]);
  });
});

describe('applyLeadSelectionItinerary', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockReset();
    mockLeadUpdate.mockReset();
    mockSelectionFindUnique.mockReset();
    mockSelectionUpdate.mockReset();
    mockPricingCreate.mockReset();
    mockPricingUpdate.mockReset();
    mockDayDeleteMany.mockReset();
    mockLineDeleteMany.mockReset();
    mockLineFindMany.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async function (arg) { return typeof arg === 'function' ? arg(this) : Promise.all(arg); });
    mockPricingCreate.mockResolvedValue({ id: 'pr-1', currency: 'USD' });
    mockPricingUpdate.mockResolvedValue({ id: 'pr-1' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1' });
    mockLeadUpdate.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'DRAFTING' });
    mockLineFindMany.mockResolvedValue([]);
  });

  it('blocks itinerary edits once the lead is quoted or later', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'QUOTED' }));
    await expect(
      applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: editorDays }),
    ).rejects.toThrow(AppError);
    expect(mockSelectionFindUnique).not.toHaveBeenCalled();
  });

  it('throws when the lead does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    await expect(applyLeadSelectionItinerary({ leadId: 'ghost', selectionId: 'sel-1', days: [] })).rejects.toThrow(/Lead not found/);
  });

  it('throws when the selection does not belong to this lead', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());
    mockSelectionFindUnique.mockResolvedValue(selectionFixture({ leadId: 'some-other-lead' }));
    await expect(
      applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: editorDays }),
    ).rejects.toThrow(/Package selection not found/);
  });

  it('creates pricing, replaces days, regenerates lines and drafts a NEW lead', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());
    mockSelectionFindUnique.mockResolvedValue(selectionFixture());
    mockLineFindMany.mockResolvedValue([{ id: 'auto-1', category: 'food', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: '60.00', actualUnitPrice: null, marginType: null, marginValue: null, source: 'AUTO' }]);

    const result = await applyLeadSelectionItinerary({
      leadId: 'lead-1',
      selectionId: 'sel-1',
      days: editorDays,
      pricingSettings: { marginType: 'PERCENTAGE', marginValue: 10 },
      actorId: 'user-1',
    });

    expect(mockPricingCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ leadPackageSelectionId: 'sel-1' }) }));
    expect(mockDayDeleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1' } });
    expect(mockLineDeleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1', source: 'AUTO' } });
    expect(mockSelectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sel-1' },
      data: expect.objectContaining({ sourcePackageId: null }),
    }));
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        lifecycleStatus: 'DRAFTING',
        primarySelectionId: 'sel-1',
        statusHistory: { create: expect.arrayContaining([expect.objectContaining({ status: 'DRAFTING' })]) },
      }),
    }));
    expect(mockPricingUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { leadPackageSelectionId: 'sel-1' } }));
    expect(result).toEqual({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
  });

  it('keeps a DRAFTING lead in DRAFTING without a lead-level update', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING' }));
    mockSelectionFindUnique.mockResolvedValue(selectionFixture({ pricing: { id: 'pr-1', currency: 'USD' } }));

    const result = await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: editorDays });
    expect(result.lifecycleStatus).toBe('DRAFTING');
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('moves a REVISION lead back to DRAFTING', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'REVISION' }));
    mockSelectionFindUnique.mockResolvedValue(selectionFixture({ pricing: { id: 'pr-1', currency: 'USD' } }));

    const result = await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: editorDays });
    expect(result.lifecycleStatus).toBe('DRAFTING');
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lifecycleStatus: 'DRAFTING' }),
    }));
  });

  it('falls back to a flat cost line from the package basePrice when there is no itinerary to derive costs from', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());
    mockSelectionFindUnique.mockResolvedValue(selectionFixture());
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'pkg-1', title: 'Weekend Getaway', basePrice: 500, currency: 'USD' } }),
    });

    await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: [], fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached across both fallback sites, not re-fetched
    expect(mockSelectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        costLines: { create: expect.arrayContaining([
          expect.objectContaining({ category: 'package', basis: 'FIXED', estimatedUnitPrice: 500, source: 'AUTO' }),
        ]) },
      }),
    }));
  });

  it('does not add a flat fallback line when itinerary days already produce real cost lines', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());
    mockSelectionFindUnique.mockResolvedValue(selectionFixture({ pricing: { id: 'pr-1', currency: 'USD' } }));
    const fetchImpl = vi.fn();

    await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: editorDays, fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    const call = mockSelectionUpdate.mock.calls[0][0];
    expect(call.data.costLines.create.some((l) => l.category === 'package')).toBe(false);
  });

  it('does not add a flat fallback line for an empty itinerary when the package has no basePrice', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());
    mockSelectionFindUnique.mockResolvedValue(selectionFixture());
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'pkg-1', title: 'Unpriced', basePrice: 0 } }),
    });

    await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-1', days: [], fetchImpl });

    const call = mockSelectionUpdate.mock.calls[0][0];
    expect(call.data.costLines.create).toEqual([]);
  });

  it('only touches the target selection — a second selection on the same lead is left alone', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING', primarySelectionId: 'sel-1' }));
    mockSelectionFindUnique.mockResolvedValue(selectionFixture({ id: 'sel-2', pricing: { id: 'pr-2', currency: 'USD' } }));

    await applyLeadSelectionItinerary({ leadId: 'lead-1', selectionId: 'sel-2', days: editorDays });

    expect(mockDayDeleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-2' } });
    expect(mockLineDeleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-2', source: 'AUTO' } });
    expect(mockDayDeleteMany).not.toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1' } });
    expect(mockLineDeleteMany).not.toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1', source: 'AUTO' } });
  });
});

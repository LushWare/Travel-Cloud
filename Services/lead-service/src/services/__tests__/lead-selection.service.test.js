import { describe, it, expect, vi } from 'vitest';

import {
  isSelectionMaterialized,
  toEditorDays,
  deriveSelectionView,
  materializeSelection,
  refreshSelection,
  recomputeSelectionPricing,
  repriceSelection,
  snapshotSelectionQuotation,
  loadQuoteTotals,
  withQuoteTotals,
} from '../lead-selection.service.js';
import AppError from '../../utils/appError.js';

const packageFixture = {
  id: 'pkg-1',
  title: 'Sri Lanka Explorer',
  currency: 'USD',
  defaultMarginType: 'PERCENTAGE',
  defaultMarginInput: 10,
  itineraryDays: [
    {
      dayNumber: 1,
      title: 'Kandy',
      breakfastCount: 2,
      lunchCount: 1,
      dinnerCount: 1,
      accommodation: { totalAmount: 100 },
      places: [{ placeId: 'p1', customName: 'Temple', orderIndex: 0 }],
      activities: [{ activityId: 'a1', name: 'Tour', defaultCost: 50 }],
      transports: [],
    },
  ],
};

function mockPrisma(overrides = {}) {
  return {
    leadItineraryDay: { count: vi.fn().mockResolvedValue(0), deleteMany: vi.fn() },
    leadPricing: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn(), deleteMany: vi.fn() },
    leadCostLine: { deleteMany: vi.fn() },
    leadPackageSelection: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn().mockImplementation(async (ops) => Promise.all(ops)),
    ...overrides,
  };
}

describe('isSelectionMaterialized', () => {
  it('is false when there are no itinerary days and no pricing row', async () => {
    const prismaClient = mockPrisma();
    await expect(isSelectionMaterialized('sel-1', prismaClient)).resolves.toBe(false);
  });

  it('is true when itinerary days exist', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(2) },
    });
    await expect(isSelectionMaterialized('sel-1', prismaClient)).resolves.toBe(true);
  });

  it('is true when a pricing row exists even with zero days', async () => {
    const prismaClient = mockPrisma({
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
    });
    await expect(isSelectionMaterialized('sel-1', prismaClient)).resolves.toBe(true);
  });
});

describe('toEditorDays', () => {
  it('unwraps nested create-shaped days into the flat editor shape', () => {
    const days = [{
      dayNumber: 1,
      title: 'Kandy',
      breakfastCount: 2,
      lunchCount: 1,
      dinnerCount: 1,
      accommodation: { totalAmount: 100 },
      places: { create: [{ placeId: 'p1', customName: 'Temple', orderIndex: 0 }] },
      activities: { create: [{ activityId: 'a1', name: 'Tour', defaultCost: 50, costOverride: null, orderIndex: 0 }] },
      transports: { create: [] },
    }];

    const editorDays = toEditorDays(days);

    expect(editorDays[0]).toMatchObject({ dayNumber: 1, breakfastCount: 2 });
    expect(editorDays[0].places[0]).toEqual({ id: null, placeId: 'p1', place: null, customName: 'Temple', orderIndex: 0 });
    expect(editorDays[0].activities[0]).toMatchObject({ id: null, name: 'Tour', defaultCost: 50 });
  });
});

describe('deriveSelectionView', () => {
  it('fetches the live package blueprint for a real-package selection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: packageFixture }) });
    const view = await deriveSelectionView({ selection: { isManual: false, packageId: 'pkg-1' }, fetchImpl });

    expect(view.packageName).toBe('Sri Lanka Explorer');
    expect(view.days).toHaveLength(1);
    expect(view.costLines.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/packages/pkg-1'), { headers: {} });
  });

  it('carries catalog place/activity names through the load round-trip (derive → editor)', async () => {
    // package-service nests resolved names under `place`/`activity` — the shape
    // that regressed locations/activities loading blank in the lead editor.
    const nestedBlueprint = {
      id: 'pkg-9', title: 'Nested', currency: 'USD',
      itineraryDays: [{
        dayNumber: 1, title: 'Day 1', breakfastCount: 1, lunchCount: 0, dinnerCount: 1,
        accommodation: { totalAmount: 120 },
        places: [
          { placeId: 'p1', place: { name: 'Sigiriya Rock' }, customName: null, orderIndex: 0 },
          { placeId: null, place: null, customName: 'Local Market', orderIndex: 1 },
        ],
        activities: [{ activityId: 'a1', activity: { name: 'Temple Tour', defaultCost: 40 }, costOverride: null, orderIndex: 0 }],
        transports: [],
      }],
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: nestedBlueprint }) });

    const view = await deriveSelectionView({ selection: { isManual: false, packageId: 'pkg-9' }, fetchImpl });
    const editorDays = toEditorDays(view.days);

    expect(editorDays[0].places.map((p) => p.customName)).toEqual(['Sigiriya Rock', 'Local Market']);
    expect(editorDays[0].activities.map((a) => a.name)).toEqual(['Temple Tour']);
    expect(editorDays[0].activities[0].defaultCost).toBe(40);
    // the activity's catalog cost must reach the auto cost lines, not default to 0
    expect(view.costLines.find((l) => l.category === 'activity')?.estimatedUnitPrice).toBe(40);
  });

  it('returns a single blank day and no cost lines for the manual slot', async () => {
    const fetchImpl = vi.fn();
    const view = await deriveSelectionView({ selection: { isManual: true, packageId: null }, fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(view.days).toHaveLength(1);
    expect(view.days[0].dayNumber).toBe(1);
    expect(view.costLines).toEqual([]);
    expect(view.pricing).toEqual({ currency: 'USD', marginType: null, marginValue: null });
  });
});

describe('materializeSelection', () => {
  it('persists the derived view and sets sourcePackageId when pristine', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, packageId: 'pkg-1' }),
        update: vi.fn().mockResolvedValue({ id: 'sel-1' }),
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: packageFixture }) });

    await materializeSelection({ selectionId: 'sel-1', fetchImpl, prismaClient });

    expect(prismaClient.leadPackageSelection.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sel-1' },
      data: expect.objectContaining({
        packageName: 'Sri Lanka Explorer',
        sourcePackageId: 'pkg-1',
        itineraryDays: { create: expect.any(Array) },
        costLines: { create: expect.any(Array) },
        pricing: { create: expect.objectContaining({ currency: 'USD' }) },
      }),
    }));
  });

  it('is a no-op when the selection is already materialized', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(3) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, packageId: 'pkg-1' }),
        update: vi.fn(),
      },
    });

    await materializeSelection({ selectionId: 'sel-1', prismaClient });

    expect(prismaClient.leadPackageSelection.update).not.toHaveBeenCalled();
  });

  it('throws when the selection does not exist', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });
    await expect(materializeSelection({ selectionId: 'ghost', prismaClient })).rejects.toThrow(AppError);
  });

  it('returns the materialized selection when a concurrent caller wins the race (regression: P2002)', async () => {
    // Two transfer-flight adds fired together both see a pristine selection and
    // both try to create day 1. The loser must not fail its own write: the
    // winner's derivation is identical, so re-read and return it.
    const winnerRow = { id: 'sel-1', isManual: true, packageId: null, itineraryDays: [{ dayNumber: 1 }] };
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValue(1) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue(winnerRow),
        update: vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })),
      },
    });

    await expect(materializeSelection({ selectionId: 'sel-1', prismaClient })).resolves.toEqual(winnerRow);
    expect(prismaClient.leadPackageSelection.update).toHaveBeenCalled();
  });

  it('rethrows a unique violation that did not leave the selection materialized', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: true, packageId: null }),
        update: vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })),
      },
    });

    await expect(materializeSelection({ selectionId: 'sel-1', prismaClient })).rejects.toThrow('Unique constraint failed');
  });
});

describe('refreshSelection', () => {
  it('deletes itinerary/costLines/pricing but leaves optional flights untouched', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, currentQuoteId: null }),
        update: vi.fn().mockResolvedValue({ id: 'sel-1' }),
      },
    });

    await refreshSelection({ selectionId: 'sel-1', prismaClient });

    expect(prismaClient.leadItineraryDay.deleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1' } });
    expect(prismaClient.leadCostLine.deleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1' } });
    expect(prismaClient.leadPricing.deleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1' } });
    expect(prismaClient.leadPackageSelection.update).toHaveBeenCalledWith({
      where: { id: 'sel-1' },
      data: { sourcePackageId: null, pendingAiChange: null },
    });
  });

  it('clears any pending AI change when refreshing — this is the "Discard" action for a voice-agent edit', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, currentQuoteId: null }),
        update: vi.fn().mockResolvedValue({ id: 'sel-1', pendingAiChange: null }),
      },
      leadItineraryDay: { deleteMany: vi.fn() },
      leadCostLine: { deleteMany: vi.fn() },
      leadPricing: { deleteMany: vi.fn() },
    });
    await refreshSelection({ selectionId: 'sel-1', prismaClient });
    expect(prismaClient.leadPackageSelection.update.mock.calls[0][0].data.pendingAiChange).toBeNull();
  });

  it('refuses to refresh the manual slot', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: { findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: true }), update: vi.fn() },
    });
    await expect(refreshSelection({ selectionId: 'sel-1', prismaClient })).rejects.toThrow(/no original package/i);
  });

  it('blocks refresh on a quoted selection unless forced', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, currentQuoteId: 'quote-1' }),
        update: vi.fn(),
      },
    });
    await expect(refreshSelection({ selectionId: 'sel-1', prismaClient })).rejects.toMatchObject({
      statusCode: 409,
      code: 'REFRESH_BLOCKED_QUOTED',
    });
    expect(prismaClient.leadItineraryDay.deleteMany).not.toHaveBeenCalled();
  });

  it('proceeds on a quoted selection when force is passed', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sel-1', isManual: false, currentQuoteId: 'quote-1' }),
        update: vi.fn().mockResolvedValue({ id: 'sel-1' }),
      },
    });
    await refreshSelection({ selectionId: 'sel-1', force: true, prismaClient });
    expect(prismaClient.leadItineraryDay.deleteMany).toHaveBeenCalled();
  });
});

describe('recomputeSelectionPricing', () => {
  it('recomputes totals from the selection cost lines and persists them', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          pricing: { currency: 'USD', marginType: null, marginValue: null, discountType: 'none', discountValue: 0, serviceChargeRate: 0 },
          costLines: [{ category: 'food', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: 60, source: 'AUTO' }],
          lead: { numberOfTravelers: 2 },
        }),
      },
      leadPricing: { update: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
    });

    await recomputeSelectionPricing('sel-1', null, prismaClient);

    expect(prismaClient.leadPricing.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { leadPackageSelectionId: 'sel-1' },
    }));
  });

  it('throws when the selection does not exist', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(recomputeSelectionPricing('ghost', null, prismaClient)).rejects.toThrow(AppError);
  });
});

describe('repriceSelection', () => {
  // A saved 1-day copy: lunch + dinner, one car at 65, one hotel night at 120.
  const savedSelection = (overrides = {}) => ({
    id: 'sel-1',
    lead: { numberOfTravelers: 2 },
    pricing: { currency: 'USD', marginType: null, marginValue: null, discountType: 'none', discountValue: 0, serviceChargeRate: 0 },
    itineraryDays: [{
      dayNumber: 1,
      breakfastCount: 0, lunchCount: 1, dinnerCount: 1,
      mealPriceOverride: null, breakfastPriceOverride: null, lunchPriceOverride: null, dinnerPriceOverride: null,
      accommodation: { name: 'Lodge', totalAmount: 120 },
      places: [], activities: [], images: [],
      transports: [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 65, distanceKm: null }],
    }],
    costLines: [],
    ...overrides,
  });

  const repriceMock = (selection) => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(selection)
      // recomputeSelectionPricing's own read
      .mockResolvedValue({ ...selection, costLines: [] });
    return mockPrisma({
      leadPackageSelection: { findUnique, update: vi.fn() },
      leadPricing: { update: vi.fn().mockResolvedValue({}) },
    });
  };

  it('rebuilds the meal line at the current Settings meal prices', async () => {
    const { getLinePricing } = await import('../../config/pricingDefaults.js');
    getLinePricing.mockResolvedValueOnce({ mealPrices: { breakfast: 25, lunch: 55, dinner: 85 } });
    const stale = [{ category: 'food', description: 'Meals', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: 30, source: 'AUTO' }];
    const prismaClient = repriceMock(savedSelection({ costLines: stale }));

    await expect(repriceSelection('sel-1', { prismaClient })).resolves.toBe(true);

    const created = prismaClient.leadPackageSelection.update.mock.calls[0][0].data.costLines.create;
    expect(created.find((l) => l.category === 'food').estimatedUnitPrice).toBe(140);
  });

  it('prices the saved car and hotel night for the party', async () => {
    const prismaClient = repriceMock(savedSelection());

    await repriceSelection('sel-1', { prismaClient });

    const created = prismaClient.leadPackageSelection.update.mock.calls[0][0].data.costLines.create;
    expect(created.filter((l) => l.category !== 'food').map((l) => [l.basis, l.quantity, l.estimatedUnitPrice]))
      .toEqual([['PER_VEHICLE', 1, 65], ['PER_ROOM', 1, 120]]);
  });

  it('only deletes AUTO lines, so a rep\'s manual lines stay', async () => {
    const prismaClient = repriceMock(savedSelection());

    await repriceSelection('sel-1', { prismaClient });

    expect(prismaClient.leadCostLine.deleteMany).toHaveBeenCalledWith({ where: { leadPackageSelectionId: 'sel-1', source: 'AUTO' } });
  });

  it('recomputes the totals after repricing', async () => {
    const prismaClient = repriceMock(savedSelection());

    await repriceSelection('sel-1', { prismaClient });

    expect(prismaClient.leadPricing.update).toHaveBeenCalledWith(expect.objectContaining({ where: { leadPackageSelectionId: 'sel-1' } }));
  });

  it('writes nothing when the saved lines already match', async () => {
    const current = [
      { category: 'transportation', description: 'Transport 1', basis: 'PER_VEHICLE', quantity: 1, estimatedUnitPrice: 65, source: 'AUTO' },
      { category: 'accommodation', description: 'Accommodation day 1', basis: 'PER_ROOM', quantity: 1, estimatedUnitPrice: 120, source: 'AUTO' },
    ];
    const prismaClient = repriceMock(savedSelection({ costLines: current }));

    await expect(repriceSelection('sel-1', { prismaClient })).resolves.toBe(false);
    expect(prismaClient.leadCostLine.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves a pristine selection (no saved itinerary) alone', async () => {
    const prismaClient = repriceMock(savedSelection({ itineraryDays: [], pricing: null }));

    await expect(repriceSelection('sel-1', { prismaClient })).resolves.toBe(false);
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });
});

describe('loadQuoteTotals', () => {
  const withSelections = (rows) => mockPrisma({
    leadPackageSelection: { findMany: vi.fn().mockResolvedValue(rows) },
  });
  const priced = (id, leadId, totalAmount, currency = 'USD') => ({ id, leadId, pricing: { totalAmount, currency } });

  it('reads the total of the lead primary package', async () => {
    const prismaClient = withSelections([priced('sel-1', 'lead-1', 900), priced('sel-2', 'lead-1', 1500)]);
    const totals = await loadQuoteTotals([{ id: 'lead-1', primarySelectionId: 'sel-2' }], prismaClient);
    expect(totals.get('lead-1')).toEqual({ amount: 1500, currency: 'USD', selectionId: 'sel-2' });
  });

  it('falls back to the first priced package when the lead has no primary', async () => {
    const prismaClient = withSelections([priced('sel-1', 'lead-1', 900), priced('sel-2', 'lead-1', 1500)]);
    const totals = await loadQuoteTotals([{ id: 'lead-1', primarySelectionId: null }], prismaClient);
    expect(totals.get('lead-1').selectionId).toBe('sel-1');
  });

  it('never shows another package when the primary is not priced yet', async () => {
    const prismaClient = withSelections([priced('sel-1', 'lead-1', 900), { id: 'sel-2', leadId: 'lead-1', pricing: null }]);
    const totals = await loadQuoteTotals([{ id: 'lead-1', primarySelectionId: 'sel-2' }], prismaClient);
    expect(totals.has('lead-1')).toBe(false);
  });

  it('skips packages with a zero total', async () => {
    const prismaClient = withSelections([priced('sel-1', 'lead-1', 0)]);
    const totals = await loadQuoteTotals([{ id: 'lead-1' }], prismaClient);
    expect(totals.has('lead-1')).toBe(false);
  });

  it('does not query when there are no leads', async () => {
    const prismaClient = withSelections([]);
    await loadQuoteTotals([], prismaClient);
    expect(prismaClient.leadPackageSelection.findMany).not.toHaveBeenCalled();
  });

  it('never writes to the lead budget', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: { findMany: vi.fn().mockResolvedValue([priced('sel-1', 'lead-1', 900)]) },
      lead: { update: vi.fn() },
    });
    await loadQuoteTotals([{ id: 'lead-1', primarySelectionId: 'sel-1' }], prismaClient);
    expect(prismaClient.lead.update).not.toHaveBeenCalled();
  });
});

describe('withQuoteTotals', () => {
  it('adds the quote total next to the customer budget', async () => {
    const prismaClient = mockPrisma({
      leadPackageSelection: { findMany: vi.fn().mockResolvedValue([{ id: 'sel-1', leadId: 'lead-1', pricing: { totalAmount: 3450, currency: 'USD' } }]) },
    });
    const [lead] = await withQuoteTotals([{ id: 'lead-1', primarySelectionId: 'sel-1', budget: '3000' }], prismaClient);
    expect(lead).toMatchObject({ budget: '3000', quoteTotal: { amount: 3450, currency: 'USD' } });
  });

  it('sets the quote total to null when nothing is priced', async () => {
    const prismaClient = mockPrisma({ leadPackageSelection: { findMany: vi.fn().mockResolvedValue([]) } });
    const [lead] = await withQuoteTotals([{ id: 'lead-1' }], prismaClient);
    expect(lead.quoteTotal).toBeNull();
  });
});

describe('snapshotSelectionQuotation', () => {
  it('materializes a pristine selection before snapshotting', async () => {
    let materialized = false;
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockImplementation(async () => (materialized ? 1 : 0)), deleteMany: vi.fn() },
      leadPricing: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      leadPackageSelection: {
        findUnique: vi.fn().mockImplementation(async () => {
          if (!materialized) return { id: 'sel-1', isManual: false, packageId: 'pkg-1' };
          return {
            id: 'sel-1',
            isManual: false,
            packageId: 'pkg-1',
            pricing: { currency: 'USD', marginType: null, marginValue: null, discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
            costLines: [],
            lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 2 },
          };
        }),
        update: vi.fn().mockImplementation(async () => { materialized = true; return { id: 'sel-1' }; }),
      },
    });
    // Route by URL: package-service fetches (materialize + inclusions enrichment)
    // return the blueprint; the billing POST returns the created quote.
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: true, json: async () => ({ success: true, data: packageFixture }) },
    );

    const result = await snapshotSelectionQuotation('sel-1', { createdById: 'user-9', fetchImpl, prismaClient });

    expect(result).toEqual({ id: 'quote-1' });
    expect(prismaClient.leadPackageSelection.update).toHaveBeenCalled();
    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    expect(billingCall).toBeDefined();
    expect(JSON.parse(billingCall[1].body)).toMatchObject({ leadId: 'lead-1', packageId: 'pkg-1', createdById: 'user-9' });
  });

  it('enriches the billing payload with the package inclusions and exclusions', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1 },
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: true, json: async () => ({ success: true, data: { ...packageFixture, inclusions: ['Hotel', 'Transfers'], exclusions: ['Airfare'] } }) },
    );

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    expect(JSON.parse(billingCall[1].body)).toMatchObject({
      includedServices: ['Hotel', 'Transfers'],
      excludedServices: ['Airfare'],
    });
  });

  it('still snapshots when the package enrichment fetch fails', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1 },
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: false, status: 404 }, // package fetch fails
    );

    const result = await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    expect(result).toEqual({ id: 'quote-1' });
    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    expect(JSON.parse(billingCall[1].body)).toMatchObject({ includedServices: [], excludedServices: [] });
  });

  it('builds itineraryDays from the lead\'s own itinerary copy, carrying activities and only the first image per day', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      // The day's activities have no saved AUTO lines yet, so quoting reprices first.
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }), update: vi.fn().mockResolvedValue({}) },
      leadPackageSelection: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1 },
          // The lead's OWN itinerary copy — deliberately different from
          // packageFixture's blueprint (title/locations) to prove the
          // snapshot is built from this, not from the re-fetched package.
          itineraryDays: [{
            dayNumber: 1,
            title: 'Arrival in Colombo (lead-customized)',
            breakfastCount: 1,
            lunchCount: 0,
            dinnerCount: 1,
            places: [{ customName: 'Colombo' }, { customName: 'Galle Face' }],
            activities: [
              { name: 'City Tour', description: 'A guided walk through the old fort.', defaultCost: 30, costOverride: 45 },
              { name: 'Free Time', description: null, defaultCost: null, costOverride: null },
            ],
            images: [
              { url: 'https://res.cloudinary.com/x/day1-a.jpg', orderIndex: 0 },
              { url: 'https://res.cloudinary.com/x/day1-b.jpg', orderIndex: 1 },
            ],
          }],
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: true, json: async () => ({ success: true, data: packageFixture }) },
    );

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    const body = JSON.parse(billingCall[1].body);
    expect(body.itineraryDays).toEqual([{
      day: 1,
      title: 'Arrival in Colombo (lead-customized)',
      locations: ['Colombo', 'Galle Face'],
      meals: ['Breakfast', 'Dinner'],
      activities: [
        { name: 'City Tour', description: 'A guided walk through the old fort.', cost: 45 },
        { name: 'Free Time', description: null, cost: null },
      ],
      // Only the first image (orderIndex 0) is carried into the snapshot.
      images: ['https://res.cloudinary.com/x/day1-a.jpg'],
    }]);
  });

  it('falls back the cover image to the lead\'s own day-1 photo when the package has no cover image', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1 },
          itineraryDays: [{
            dayNumber: 1,
            title: 'Day 1',
            breakfastCount: 0, lunchCount: 0, dinnerCount: 0,
            places: [],
            activities: [],
            images: [{ url: 'https://res.cloudinary.com/x/lead-day1.jpg', orderIndex: 0 }],
          }],
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        // Package has no coverImage set.
        : { ok: true, json: async () => ({ success: true, data: { ...packageFixture, coverImage: null } }) },
    );

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    const body = JSON.parse(billingCall[1].body);
    expect(body.coverImage).toBe('https://res.cloudinary.com/x/lead-day1.jpg');
  });

  it('uses the selected package\'s destination over the lead\'s own inquiry-stage destination', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          // A lead still comparing options at inquiry time is seeded with a
          // placeholder destination like this — once a specific package is
          // selected and quoted, the package's own destination must win so
          // the PDF doesn't show "Multiple options" as the trip location.
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1, destination: 'Multiple options' },
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: true, json: async () => ({ success: true, data: { ...packageFixture, destination: 'Sigiriya, Sri Lanka' } }) },
    );

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    const body = JSON.parse(billingCall[1].body);
    expect(body.destination).toBe('Sigiriya, Sri Lanka');
  });

  it('uses the selection\'s destinationOverride over the package\'s own destination', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          destinationOverride: 'Bali & Lombok (multi-city extension)',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1, destination: 'Multiple options' },
        }),
      },
    });
    const fetchImpl = vi.fn().mockImplementation(async (url) =>
      url.includes('/billing/quotations/from-lead')
        ? { ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) }
        : { ok: true, json: async () => ({ success: true, data: { ...packageFixture, destination: 'Bali' } }) },
    );

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    const body = JSON.parse(billingCall[1].body);
    expect(body.destination).toBe('Bali & Lombok (multi-city extension)');
  });

  it('falls back to the lead\'s destination when there is no selected package', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: true,
          packageId: null,
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1, destination: 'Maldives' },
        }),
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: 'quote-1' } }) });

    await snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient });

    const billingCall = fetchImpl.mock.calls.find((c) => c[0].includes('/billing/quotations/from-lead'));
    const body = JSON.parse(billingCall[1].body);
    expect(body.destination).toBe('Maldives');
  });

  it('throws when billing-service rejects the snapshot', async () => {
    const prismaClient = mockPrisma({
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'sel-1',
          isManual: false,
          packageId: 'pkg-1',
          pricing: { currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0, paidAmount: 0 },
          costLines: [],
          lead: { id: 'lead-1', name: 'Jane', email: 'jane@test.com', phone: null, city: null, numberOfTravelers: 1 },
        }),
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502 });

    await expect(snapshotSelectionQuotation('sel-1', { fetchImpl, prismaClient })).rejects.toThrow(/Failed to snapshot/);
  });
});

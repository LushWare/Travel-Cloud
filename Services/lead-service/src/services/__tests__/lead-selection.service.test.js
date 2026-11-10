import { describe, it, expect, vi } from 'vitest';

import {
  isSelectionMaterialized,
  toEditorDays,
  deriveSelectionView,
  materializeSelection,
  refreshSelection,
  recomputeSelectionPricing,
  snapshotSelectionQuotation,
  syncLeadBudgetFromSelection,
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
    $transaction: vi.fn().mockImplementation(async function (arg) { return typeof arg === 'function' ? arg(this) : Promise.all(arg); }),
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
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/packages/pkg-1'));
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

describe('syncLeadBudgetFromSelection', () => {
  const withPricing = (primarySelectionId, pricing) => mockPrisma({
    lead: { findUnique: vi.fn().mockResolvedValue({ primarySelectionId }), update: vi.fn() },
    leadPricing: { findUnique: vi.fn().mockResolvedValue(pricing) },
  });

  it('writes a formatted budget from the primary selection total', async () => {
    const prismaClient = withPricing('sel-1', { totalAmount: 4814, currency: 'USD' });
    await syncLeadBudgetFromSelection('lead-1', 'sel-1', prismaClient);
    expect(prismaClient.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { budget: 'USD 4,814' },
    });
  });

  it('adopts the selection when the lead has no primary yet', async () => {
    const prismaClient = withPricing(null, { totalAmount: 1200, currency: 'INR' });
    await syncLeadBudgetFromSelection('lead-1', 'sel-9', prismaClient);
    expect(prismaClient.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { budget: 'INR 1,200' },
    });
  });

  it('does nothing when the selection is not the lead primary', async () => {
    const prismaClient = withPricing('other-sel', { totalAmount: 999, currency: 'USD' });
    await syncLeadBudgetFromSelection('lead-1', 'sel-1', prismaClient);
    expect(prismaClient.lead.update).not.toHaveBeenCalled();
  });

  it('does nothing when the selection has no pricing/total', async () => {
    const prismaClient = withPricing('sel-1', null);
    await syncLeadBudgetFromSelection('lead-1', 'sel-1', prismaClient);
    expect(prismaClient.lead.update).not.toHaveBeenCalled();
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
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: {
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

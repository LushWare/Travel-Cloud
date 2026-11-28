import { describe, it, expect, vi } from 'vitest';

import { buildDraftData, fetchPackage } from '../lead-draft.service.js';
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
      description: 'Temple day',
      breakfastCount: 2,
      lunchCount: 1,
      dinnerCount: 1,
      mealPriceOverride: null,
      accommodation: { totalAmount: 100, name: 'Kandy Hotel' },
      flights: [],
      places: [{ placeId: 'p1', customName: 'Temple of the Tooth', orderIndex: 0 }],
      activities: [{ activityId: 'a1', name: 'Temple Tour', defaultCost: 50, costOverride: null }],
      transports: [{ routeType: 'DAILY_ROUTING', transportMode: 'VAN', pricingModel: 'PER_VEHICLE', unitCost: 300, distanceKm: null }],
    },
  ],
};

describe('buildDraftData', () => {
  it('maps the package into itinerary days, AUTO cost lines and pricing defaults', () => {
    const data = buildDraftData(packageFixture, { pricing: { mealPrices: { breakfast: 15, lunch: 15, dinner: 15 } } });

    expect(data.days).toHaveLength(1);
    expect(data.days[0]).toMatchObject({
      dayNumber: 1,
      breakfastCount: 2,
      lunchCount: 1,
      dinnerCount: 1,
      accommodation: { totalAmount: 100, name: 'Kandy Hotel' },
    });
    expect(data.days[0].places.create[0]).toEqual({
      placeId: 'p1',
      customName: 'Temple of the Tooth',
      orderIndex: 0,
    });
    expect(data.days[0].transports.create[0]).toMatchObject({
      pricingModel: 'PER_VEHICLE',
      unitCost: 300,
    });

    expect(data.costLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'food', basis: 'PER_PERSON', estimatedUnitPrice: 60, source: 'AUTO' }),
      expect.objectContaining({ category: 'activity', basis: 'PER_PERSON', estimatedUnitPrice: 50, source: 'AUTO' }),
      expect.objectContaining({ category: 'transportation', basis: 'PER_VEHICLE', estimatedUnitPrice: 300, quantity: 1, source: 'AUTO' }),
      expect.objectContaining({ category: 'accommodation', basis: 'PER_ROOM', quantity: 1, estimatedUnitPrice: 100, source: 'AUTO' }),
    ]));

    expect(data.pricing).toEqual({
      currency: 'USD',
      marginType: 'PERCENTAGE',
      marginValue: 10,
    });
  });

  it('snapshots catalog place/activity names and cost from the nested blueprint shape', () => {
    // package-service nests the resolved name under `place`/`activity`, not top-level.
    const data = buildDraftData({
      id: 'pkg-n', title: 'Nested', currency: 'USD',
      itineraryDays: [{
        dayNumber: 1,
        places: [{ placeId: 'p9', place: { name: 'Sigiriya Rock' }, customName: null, orderIndex: 0 }],
        activities: [{ activityId: 'a9', activity: { name: 'Temple Tour', defaultCost: 40 }, costOverride: null, orderIndex: 0 }],
      }],
    });
    expect(data.days[0].places.create[0]).toMatchObject({ placeId: 'p9', customName: 'Sigiriya Rock' });
    expect(data.days[0].activities.create[0]).toMatchObject({ activityId: 'a9', name: 'Temple Tour', defaultCost: 40 });
    expect(data.costLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'activity', estimatedUnitPrice: 40 }),
    ]));
  });

  it('falls back to USD currency and no margin when the package omits them', () => {
    const data = buildDraftData({ id: 'x', title: 'Basic' });
    expect(data.pricing).toEqual({
      currency: 'USD',
      marginType: null,
      marginValue: null,
    });
  });

  it('builds cost lines with per-person basis from meal counts', () => {
    const data = buildDraftData(packageFixture, { pricing: { mealPrices: { breakfast: 15, lunch: 15, dinner: 15 } } });
    const food = data.costLines.find((l) => l.category === 'food');
    expect(food).toEqual(expect.objectContaining({
      basis: 'PER_PERSON',
      estimatedUnitPrice: 60,
      description: 'Meals',
    }));
  });

  it('falls back to a flat cost line from basePrice when the package has no itinerary days', () => {
    const data = buildDraftData({
      id: 'pkg-flat', title: 'Weekend Getaway', currency: 'USD', basePrice: 850,
      defaultMarginType: 'PERCENTAGE', defaultMarginInput: 15,
      itineraryDays: [],
    });

    expect(data.days).toHaveLength(0);
    expect(data.costLines).toEqual([
      expect.objectContaining({
        category: 'package',
        // basePrice is per person, so the line scales with the party.
        basis: 'PER_PERSON',
        estimatedUnitPrice: 850,
        description: 'Weekend Getaway',
        source: 'AUTO',
      }),
    ]);
  });

  it('does not add a flat cost line when basePrice is 0 or unset, even with no itinerary', () => {
    const data = buildDraftData({ id: 'pkg-unpriced', title: 'Unpriced', basePrice: 0, itineraryDays: [] });
    expect(data.costLines).toEqual([]);
  });

  it('does not double up costs by adding a flat line when itinerary-derived lines already exist', () => {
    const data = buildDraftData({ ...packageFixture, basePrice: 9999 });
    expect(data.costLines.some((l) => l.category === 'package')).toBe(false);
  });
});

describe('fetchPackage', () => {
  it('returns the package payload from the service response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'pkg-1', title: 'Sri Lanka Explorer' } }),
    });
    await expect(fetchPackage('pkg-1', fetchImpl)).resolves.toMatchObject({ id: 'pkg-1' });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/api/v1/packages/pkg-1'), { headers: {} });
  });

  it('throws a 404-style error when the package is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchPackage('nope', fetchImpl)).rejects.toThrow(AppError);
  });
});

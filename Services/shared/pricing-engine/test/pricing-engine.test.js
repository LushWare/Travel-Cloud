import { describe, it, expect } from 'vitest';
import {
  calculateBasePrice,
  calculateMealCosts,
  calculateAccommodationCosts,
  calculateTransportCosts,
  calculateActivityCosts,
  computeMargin,
  DEFAULTS,
  packagePriceFromDays,
} from '../src/index.js';

describe('per-meal prices', () => {
  const mealPrices = { breakfast: 8, lunch: 15, dinner: 20 };

  it('charges each meal at its own default price', () => {
    const result = calculateMealCosts([{ breakfastCount: 1, lunchCount: 1, dinnerCount: 1 }], { mealPrices });
    expect(result.total).toBe(43);
  });

  it('uses a day price for one meal and the default for the others', () => {
    const result = calculateMealCosts([{ breakfastCount: 1, lunchCount: 1, dinnerCount: 1, dinnerPriceOverride: 40 }], { mealPrices });
    expect(result.dinnerCost).toBe(40);
  });

  it('keeps an old single day price for every meal without its own price', () => {
    const result = calculateMealCosts([{ breakfastCount: 1, lunchCount: 1, dinnerCount: 1, mealPriceOverride: 12 }], { mealPrices });
    expect(result.total).toBe(36);
  });

  it('prefers a meal own price over the old single day price', () => {
    const result = calculateMealCosts([{ breakfastCount: 1, mealPriceOverride: 12, breakfastPriceOverride: 5 }], { mealPrices });
    expect(result.breakfastCost).toBe(5);
  });

  it('treats a zero day price as free rather than unset', () => {
    const result = calculateMealCosts([{ lunchCount: 1, lunchPriceOverride: 0 }], { mealPrices });
    expect(result.lunchCost).toBe(0);
  });

  it('charges nothing for a meal with no Settings price rather than inventing one', () => {
    const result = calculateMealCosts([{ dinnerCount: 1 }]);
    expect(result.total).toBe(0);
  });

  it('shows each day meal line at the per-meal prices in a package price', () => {
    const price = packagePriceFromDays([{ dayNumber: 1, breakfastCount: 1, dinnerCount: 1 }], { mealPrices });
    expect(price.rows.meals[0].costPerPerson).toBe(28);
  });
});

describe('calculateMealCosts', () => {
  it('returns zeros for empty days', () => {
    const result = calculateMealCosts([]);
    expect(result).toEqual({ total: 0, breakfastCost: 0, lunchCost: 0, dinnerCost: 0 });
  });

  it('computes costs from meal counts at the given meal prices', () => {
    const days = [
      { breakfastCount: 2, lunchCount: 1, dinnerCount: 1 },
      { breakfastCount: 1, lunchCount: 0, dinnerCount: 2 },
    ];
    const result = calculateMealCosts(days, { mealPrices: { breakfast: 10, lunch: 20, dinner: 30 } });
    expect(result).toEqual({ total: 140, breakfastCost: 30, lunchCost: 20, dinnerCost: 90 });
  });

  it('uses custom meal cost from config', () => {
    const days = [{ breakfastCount: 2, lunchCount: 1 }];
    const result = calculateMealCosts(days, { mealCostPerPerson: 25 });
    expect(result.breakfastCost).toBe(50);
    expect(result.lunchCost).toBe(25);
    expect(result.total).toBe(75);
  });

  it('uses mealPriceOverride on specific days', () => {
    const days = [
      { breakfastCount: 1, lunchCount: 0, dinnerCount: 0, mealPriceOverride: 40 },
      { breakfastCount: 1, lunchCount: 0, dinnerCount: 0 },
    ];
    const result = calculateMealCosts(days, { mealPrices: { breakfast: 12, lunch: 12, dinner: 12 } });
    expect(result.breakfastCost).toBe(40 + 12);
  });

  it('handles missing meal counts as zero', () => {
    const days = [{}];
    const result = calculateMealCosts(days);
    expect(result.total).toBe(0);
  });

  it('scales meal costs by groupSize', () => {
    const days = [{ breakfastCount: 2, lunchCount: 1, dinnerCount: 0 }];
    const result = calculateMealCosts(days, { groupSize: 4, mealCostPerPerson: 15 });
    expect(result.breakfastCost).toBe(2 * 15 * 4);
    expect(result.lunchCost).toBe(1 * 15 * 4);
    expect(result.total).toBe(3 * 15 * 4);
  });

  it('defaults to groupSize 1 so single-person behavior is unchanged', () => {
    const days = [{ breakfastCount: 2, lunchCount: 1 }];
    const result = calculateMealCosts(days, { mealCostPerPerson: 15 });
    expect(result.total).toBe(3 * 15);
  });
});

describe('calculateAccommodationCosts', () => {
  it('returns zeros for empty input', () => {
    expect(calculateAccommodationCosts([])).toEqual({ total: 0, rows: [] });
  });

  it('sums per-day accommodation amounts', () => {
    const result = calculateAccommodationCosts([
      { totalAmount: 200 },
      { totalAmount: 150 },
    ]);
    expect(result.total).toBe(350);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].amount).toBe(150);
  });

  it('accepts plain numbers as per-day amounts', () => {
    expect(calculateAccommodationCosts([100, 250.5]).total).toBe(350.5);
  });
});

describe('calculateTransportCosts', () => {
  it('returns zeros for empty transports', () => {
    const result = calculateTransportCosts([]);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('computes PER_KM cost from unitCost × distanceKm', () => {
    const transports = [
      { pricingModel: 'PER_KM', unitCost: 2.5, distanceKm: 100 },
    ];
    const result = calculateTransportCosts(transports);
    expect(result.rows[0].cost).toBe(250);
    expect(result.total).toBe(250);
  });

  it('computes PER_PERSON cost from unitCost × groupSize', () => {
    const transports = [
      { pricingModel: 'PER_PERSON', unitCost: 50 },
    ];
    const result = calculateTransportCosts(transports, { groupSize: 4 });
    expect(result.rows[0].cost).toBe(200);
    expect(result.total).toBe(200);
  });

  it('uses default group size for PER_PERSON when not provided', () => {
    const transports = [{ pricingModel: 'PER_PERSON', unitCost: 50 }];
    const result = calculateTransportCosts(transports);
    expect(result.rows[0].cost).toBe(50 * DEFAULTS.defaultGroupSize);
  });

  it('computes PER_VEHICLE cost as flat unitCost', () => {
    const transports = [
      { pricingModel: 'PER_VEHICLE', unitCost: 300 },
    ];
    const result = calculateTransportCosts(transports);
    expect(result.rows[0].cost).toBe(300);
    expect(result.total).toBe(300);
  });

  it('handles null distanceKm for PER_KM as zero', () => {
    const transports = [
      { pricingModel: 'PER_KM', unitCost: 2, distanceKm: null },
    ];
    const result = calculateTransportCosts(transports);
    expect(result.rows[0].cost).toBe(0);
  });

  it('aggregates multiple transport rows', () => {
    const transports = [
      { pricingModel: 'PER_VEHICLE', unitCost: 300 },
      { pricingModel: 'PER_PERSON', unitCost: 50 },
    ];
    const result = calculateTransportCosts(transports, { groupSize: 2 });
    expect(result.total).toBe(400);
  });
});

describe('calculateActivityCosts', () => {
  it('returns zeros for empty activities', () => {
    const result = calculateActivityCosts([]);
    expect(result.total).toBe(0);
  });

  it('multiplies defaultCost by groupSize', () => {
    const activities = [{ defaultCost: 75, costOverride: null }];
    const result = calculateActivityCosts(activities, { groupSize: 3 });
    expect(result.rows[0].cost).toBe(225);
    expect(result.rows[0].isOverride).toBe(false);
    expect(result.total).toBe(225);
  });

  it('uses costOverride when present', () => {
    const activities = [{ defaultCost: 75, costOverride: 60 }];
    const result = calculateActivityCosts(activities, { groupSize: 2 });
    expect(result.rows[0].cost).toBe(120);
    expect(result.rows[0].isOverride).toBe(true);
  });

  it('handles undefined defaultCost as zero', () => {
    const activities = [{}];
    const result = calculateActivityCosts(activities);
    expect(result.rows[0].cost).toBe(0);
  });

  it('uses default group size', () => {
    const activities = [{ defaultCost: 50 }];
    const result = calculateActivityCosts(activities);
    expect(result.rows[0].cost).toBe(50 * DEFAULTS.defaultGroupSize);
  });
});

describe('computeMargin', () => {
  it('computes PERCENTAGE margin', () => {
    const result = computeMargin(1000, 'PERCENTAGE', 20);
    expect(result.basePrice).toBe(1000);
    expect(result.marginAmount).toBe(200);
    expect(result.sellPrice).toBe(1200);
  });

  it('computes FIXED margin', () => {
    const result = computeMargin(1000, 'FIXED', 150);
    expect(result.marginAmount).toBe(150);
    expect(result.sellPrice).toBe(1150);
  });

  it('rounds to 2 decimal places', () => {
    const result = computeMargin(333.333, 'PERCENTAGE', 15);
    expect(result.marginAmount).toBe(50);
    expect(result.sellPrice).toBe(383.33);
  });

  it('handles zero margin', () => {
    const result = computeMargin(500, 'PERCENTAGE', 0);
    expect(result.marginAmount).toBe(0);
    expect(result.sellPrice).toBe(500);
  });
});

describe('calculateBasePrice', () => {
  it('returns zero base price for empty inputs', () => {
    const result = calculateBasePrice();
    expect(result.basePrice).toBe(0);
    expect(result.breakdown.margin).toBeUndefined();
  });

  it('aggregates meals + activities + transports', () => {
    const result = calculateBasePrice({
      days: [
        { breakfastCount: 2, lunchCount: 1, dinnerCount: 1 },
      ],
      activities: [{ defaultCost: 100 }],
      transports: [{ pricingModel: 'PER_VEHICLE', unitCost: 300 }],
      groupSize: 2,
      mealCostPerPerson: 15,
    });
    const expected = (4 * 15 * 2) + (100 * 2) + 300; // meals scale with groupSize: 120 + 200 + 300 = 620
    expect(result.basePrice).toBe(expected);
  });

  it('computes margin when marginType and marginValue provided', () => {
    const result = calculateBasePrice({
      days: [{ breakfastCount: 1 }],
      groupSize: 1,
      mealCostPerPerson: 10,
      marginType: 'PERCENTAGE',
      marginValue: 50,
    });
    expect(result.basePrice).toBe(10);
    expect(result.breakdown.margin).toBeDefined();
    expect(result.breakdown.margin.sellPrice).toBe(15);
  });

  it('does not compute margin when omitted', () => {
    const result = calculateBasePrice({
      days: [{ breakfastCount: 1 }],
      groupSize: 1,
    });
    expect(result.breakdown.margin).toBeUndefined();
  });

  it('rounds basePrice to 2 decimals', () => {
    const result = calculateBasePrice({
      days: [{ breakfastCount: 1, lunchCount: 1 }],
      activities: [{ defaultCost: 33.333 }],
      groupSize: 1,
      mealCostPerPerson: 15.555,
    });
    expect(result.basePrice).toBe(Math.round((15.555 + 15.555 + 33.333) * 100) / 100);
  });

  it('includes accommodation in basePrice and breakdown when provided', () => {
    const result = calculateBasePrice({
      days: [{ breakfastCount: 1 }],
      accommodation: [{ totalAmount: 200 }, { totalAmount: 150 }],
      groupSize: 1,
      mealCostPerPerson: 10,
    });
    expect(result.breakdown.accommodation.total).toBe(350);
    expect(result.basePrice).toBe(360);
  });

  it('defaults accommodation to zero when not provided', () => {
    const result = calculateBasePrice({ days: [] });
    expect(result.breakdown.accommodation).toEqual({ total: 0, rows: [] });
  });
});

describe('packagePriceFromDays hotel rows', () => {
  it('lists a named hotel without a price so it is not hidden', () => {
    const price = packagePriceFromDays([{ dayNumber: 6, accommodation: { name: 'Uma Paro' } }]);
    expect(price.rows.hotels).toEqual([{ dayNumber: 6, name: 'Uma Paro', roomPrice: 0, roomType: null, boardType: null }]);
  });

  it('carries the saved room type and meal plan', () => {
    const price = packagePriceFromDays([{ dayNumber: 1, accommodation: { name: 'Le Meridien', totalAmount: 220, roomType: 'Classic Room', boardType: 'Half Board' } }]);
    expect(price.rows.hotels[0]).toMatchObject({ roomType: 'Classic Room', boardType: 'Half Board' });
  });
});

describe('singleSupplementFromDays', () => {
  const days = [
    { accommodation: { totalAmount: 200 }, transports: [{ pricingModel: 'PER_VEHICLE', unitCost: 60 }] },
    { accommodation: {}, transports: [{ pricingModel: 'PER_KM', unitCost: 2, distanceKm: 50 }, { pricingModel: 'PER_PERSON', unitCost: 30 }] },
  ];

  it('adds the other half of each room and vehicle', async () => {
    const { singleSupplementFromDays } = await import('../src/index.js');
    expect(singleSupplementFromDays(days)).toEqual({ rooms: 100, vehicles: 80, margin: 0, total: 180 });
  });

  it('adds a percentage margin on the extra', async () => {
    const { singleSupplementFromDays } = await import('../src/index.js');
    expect(singleSupplementFromDays(days, { marginType: 'PERCENTAGE', marginValue: 10 }).total).toBe(198);
  });

  it('adds nothing for a fixed margin', async () => {
    const { singleSupplementFromDays } = await import('../src/index.js');
    expect(singleSupplementFromDays(days, { marginType: 'FIXED', marginValue: 400 }).total).toBe(180);
  });
});

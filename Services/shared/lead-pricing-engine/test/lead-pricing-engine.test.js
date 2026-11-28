import { describe, it, expect } from 'vitest';
import {
  computeLine,
  computeQuote,
  buildItineraryCostLines,
} from '../src/index.js';

describe('computeLine', () => {
  it('resolves PER_PERSON quantity to travelers', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100, description: 'Activity' },
      { travelers: 4 },
    );
    expect(line.quantity).toBe(4);
    expect(line.estimatedTotal).toBe(400);
    expect(line.sellTotal).toBe(400);
  });

  it('never scales trip-level bases by travelers', () => {
    const vehicle = computeLine(
      { basis: 'PER_VEHICLE', estimatedUnit: 300, quantity: 1, description: 'Van' },
      { travelers: 4 },
    );
    expect(vehicle.quantity).toBe(1);
    expect(vehicle.sellTotal).toBe(300);

    const fixed = computeLine(
      { basis: 'FIXED', estimatedUnit: 50, quantity: 1, description: 'Visa' },
      { travelers: 4 },
    );
    expect(fixed.quantity).toBe(1);
    expect(fixed.sellTotal).toBe(50);
  });

  it('applies PERCENTAGE margin to the quoted unit price', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100, marginType: 'PERCENTAGE', marginValue: 10 },
      { travelers: 4 },
    );
    expect(line.quotedUnitPrice).toBe(110);
    expect(line.sellTotal).toBe(440);
  });

  it('applies FIXED margin to the quoted unit price', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100, marginType: 'FIXED', marginValue: 25 },
      { travelers: 2 },
    );
    expect(line.quotedUnitPrice).toBe(125);
    expect(line.sellTotal).toBe(250);
  });

  it('keeps quoted unit equal to estimated unit when no margin', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 80 },
      { travelers: 3 },
    );
    expect(line.quotedUnitPrice).toBe(80);
  });

  it('computes actualTotal from actualUnit and quantity, null when absent', () => {
    const withActual = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100, actualUnit: 90 },
      { travelers: 4 },
    );
    expect(withActual.actualTotal).toBe(360);

    const withoutActual = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100 },
      { travelers: 4 },
    );
    expect(withoutActual.actualTotal).toBeNull();
  });

  it('preserves source metadata on the output line', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 100, source: 'MANUAL', description: 'Extras' },
      { travelers: 1 },
    );
    expect(line.source).toBe('MANUAL');
  });

  it('rounds line totals to cents', () => {
    const line = computeLine(
      { basis: 'PER_PERSON', estimatedUnit: 33.333, marginType: 'PERCENTAGE', marginValue: 15 },
      { travelers: 3 },
    );
    expect(line.estimatedTotal).toBe(99.99);
    expect(line.quotedUnitPrice).toBe(38.33);
    expect(line.sellTotal).toBe(114.99);
  });
});

describe('computeQuote', () => {
  const lines = [
    { basis: 'PER_PERSON', estimatedUnit: 100, actualUnit: 90, category: 'activity', description: 'Activity', source: 'AUTO' },
    { basis: 'PER_VEHICLE', estimatedUnit: 300, quantity: 1, actualUnit: 320, category: 'transportation', description: 'Van', source: 'AUTO' },
    { basis: 'PER_PERSON', estimatedUnit: 50, category: 'transportation', description: 'Flight', source: 'MANUAL' },
  ];

  it('computes the full breakdown from a worked example', () => {
    const result = computeQuote({
      lines,
      travelers: 4,
      currency: 'USD',
      marginType: 'PERCENTAGE',
      marginValue: 10,
      taxRate: 18,
      discountType: 'percentage',
      discountValue: 10,
      serviceChargeRate: 5,
    });

    expect(result.estimatedTotal).toBe(900);
    expect(result.actualTotal).toBe(680);
    expect(result.sellSubtotal).toBe(990);
    expect(result.discountAmount).toBe(99);
    expect(result.taxableSubtotal).toBe(891);
    expect(result.taxAmount).toBe(160.38);
    expect(result.serviceChargeAmount).toBe(49.5);
    expect(result.totalAmount).toBe(1100.88);
    expect(result.profit).toBe(310);
    expect(result.currency).toBe('USD');
  });

  it('applies discount before tax (taxable = sellSubtotal - discount)', () => {
    const result = computeQuote({
      lines: [{ basis: 'PER_VEHICLE', estimatedUnit: 1000, quantity: 1, description: 'Package' }],
      travelers: 1,
      taxRate: 18,
      discountType: 'fixed',
      discountValue: 100,
    });
    expect(result.sellSubtotal).toBe(1000);
    expect(result.discountAmount).toBe(100);
    expect(result.taxableSubtotal).toBe(900);
    expect(result.taxAmount).toBe(162);
    expect(result.totalAmount).toBe(1062);
  });

  it('defaults margin to the lead-level value per line', () => {
    const result = computeQuote({
      lines: [
        { basis: 'PER_PERSON', estimatedUnit: 100, description: 'A' },
        { basis: 'PER_PERSON', estimatedUnit: 100, marginType: 'FIXED', marginValue: 20, description: 'B' },
      ],
      travelers: 1,
      marginType: 'PERCENTAGE',
      marginValue: 50,
    });
    expect(result.lines[0].quotedUnitPrice).toBe(150);
    expect(result.lines[1].quotedUnitPrice).toBe(120);
    expect(result.sellSubtotal).toBe(270);
  });

  it('adds a lead fixed margin once per traveller, not once per line', () => {
    const result = computeQuote({
      lines: [
        { basis: 'PER_PERSON', estimatedUnit: 330, description: 'Meals' },
        { basis: 'PER_VEHICLE', estimatedUnit: 65, quantity: 1, description: 'Car' },
        { basis: 'PER_ROOM', estimatedUnit: 220, quantity: 1, description: 'Room' },
      ],
      travelers: 2,
      marginType: 'FIXED',
      marginValue: 480,
    });
    // cost 660 + 65 + 220 = 945; margin 480 x 2 = 960
    expect(result.estimatedTotal).toBe(945);
    expect(result.sellSubtotal).toBe(1905);
  });

  it('keeps quotation items adding up to the subtotal with a fixed margin', () => {
    const result = computeQuote({
      lines: [
        { basis: 'PER_PERSON', estimatedUnit: 330, description: 'Meals' },
        { basis: 'PER_ROOM', estimatedUnit: 220, quantity: 1, description: 'Room' },
      ],
      travelers: 2,
      marginType: 'FIXED',
      marginValue: 100,
    });
    const items = result.lines.reduce((sum, l) => sum + l.quotedUnitPrice * l.quantity, 0);
    expect(items).toBeCloseTo(result.sellSubtotal, 2);
  });

  it('leaves a line with its own margin alone when the lead margin is fixed', () => {
    const result = computeQuote({
      lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, marginType: 'FIXED', marginValue: 10, description: 'Visa' }],
      travelers: 2,
      marginType: 'FIXED',
      marginValue: 480,
    });
    expect(result.sellSubtotal).toBe(110);
  });

  it('uses zero tax when taxRate is omitted', () => {
    const result = computeQuote({
      lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }],
      travelers: 1,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.totalAmount).toBe(100);
  });

  it('never lets taxableSubtotal go negative', () => {
    const result = computeQuote({
      lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }],
      travelers: 1,
      taxRate: 18,
      discountType: 'fixed',
      discountValue: 500,
    });
    expect(result.taxableSubtotal).toBe(0);
    expect(result.totalAmount).toBe(0);
  });

  it('returns null profit until actuals exist', () => {
    const result = computeQuote({
      lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }],
      travelers: 1,
    });
    expect(result.profit).toBeNull();
  });
});

describe('buildItineraryCostLines', () => {
  it('charges for as many cars as the Settings seats need', () => {
    const lines = buildItineraryCostLines({
      transports: [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 }],
      travelers: 5,
      vehicleSeats: { CAR: 4 },
    });
    expect(lines[0]).toMatchObject({ quantity: 2, description: 'Transport 1 (2 vehicles)' });
  });

  it('fits a group in one car when Settings gives it enough seats', () => {
    const lines = buildItineraryCostLines({
      transports: [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 }],
      travelers: 4,
      vehicleSeats: { CAR: 4 },
    });
    expect(lines[0].quantity).toBe(1);
  });

  it('counts rooms with the Settings people per room', () => {
    const lines = buildItineraryCostLines({ days: [{ accommodation: { totalAmount: 100 } }], travelers: 6, peoplePerRoom: 3 });
    expect(lines[0].quantity).toBe(2);
  });

  it('prices the meals line at the separate breakfast, lunch and dinner prices', () => {
    const lines = buildItineraryCostLines({
      days: [
        { breakfastCount: 1, lunchCount: 1, dinnerCount: 1 },
        { breakfastCount: 1, dinnerCount: 1, dinnerPriceOverride: 40 },
      ],
      mealPrices: { breakfast: 8, lunch: 15, dinner: 20 },
    });

    expect(lines.find((l) => l.category === 'food').estimatedUnit).toBe(91);
  });

  it('maps days, activities, transports and accommodation into AUTO cost lines', () => {
    const lines = buildItineraryCostLines({
      days: [
        {
          breakfastCount: 2,
          lunchCount: 1,
          dinnerCount: 1,
          accommodation: { totalAmount: 100 },
        },
      ],
      activities: [{ defaultCost: 50, costOverride: null }],
      transports: [{ pricingModel: 'PER_VEHICLE', unitCost: 300 }],
      mealPrices: { breakfast: 15, lunch: 15, dinner: 15 },
    });

    const food = lines.find((l) => l.category === 'food');
    const activity = lines.find((l) => l.category === 'activity');
    const transport = lines.find((l) => l.category === 'transportation' && l.description.includes('Transport'));
    const accommodation = lines.find((l) => l.category === 'accommodation');

    expect(food).toMatchObject({ basis: 'PER_PERSON', estimatedUnit: 60, source: 'AUTO' });
    expect(activity).toMatchObject({ basis: 'PER_PERSON', estimatedUnit: 50, source: 'AUTO' });
    expect(transport).toMatchObject({ basis: 'PER_VEHICLE', estimatedUnit: 300, quantity: 1, source: 'AUTO' });
    // One traveller → one room; the room price is never multiplied per person.
    expect(accommodation).toMatchObject({ basis: 'PER_ROOM', estimatedUnit: 100, quantity: 1, source: 'AUTO' });
    expect(lines.every((l) => l.source === 'AUTO')).toBe(true);
  });

  it('honours costOverride for activities and distanceKm for PER_KM transport', () => {
    const lines = buildItineraryCostLines({
      days: [],
      activities: [{ defaultCost: 75, costOverride: 60 }],
      transports: [{ pricingModel: 'PER_KM', unitCost: 2.5, distanceKm: 100 }],
    });
    const activity = lines.find((l) => l.category === 'activity');
    const transport = lines.find((l) => l.category === 'transportation');
    expect(activity.estimatedUnit).toBe(60);
    expect(transport).toMatchObject({ basis: 'PER_KM', estimatedUnit: 2.5, quantity: 100 });
  });

  it('honours a per-day mealPriceOverride instead of the default meal rate', () => {
    const lines = buildItineraryCostLines({
      days: [{ breakfastCount: 1, lunchCount: 1, dinnerCount: 1, mealPriceOverride: 100 }],
    });
    const food = lines.find((l) => l.category === 'food');
    expect(food.estimatedUnit).toBe(300); // 3 meals × $100, not 3 × the $15 default
  });

  it('applies each day meal rate independently, falling back to the default', () => {
    const lines = buildItineraryCostLines({
      days: [
        { breakfastCount: 1, lunchCount: 0, dinnerCount: 1, mealPriceOverride: 50 }, // 2 × 50 = 100
        { breakfastCount: 1, lunchCount: 1, dinnerCount: 1, mealPriceOverride: null }, // 3 × 15 = 45
      ],
      mealPrices: { breakfast: 15, lunch: 15, dinner: 15 },
    });
    const food = lines.find((l) => l.category === 'food');
    expect(food.estimatedUnit).toBe(145);
  });
});

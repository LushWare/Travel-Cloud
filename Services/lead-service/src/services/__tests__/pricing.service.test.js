import { describe, it, expect } from 'vitest';
import { computePricing, toLineDescriptor, effectiveTaxRate, parseOwnTaxRate } from '../pricing.service.js';
import { buildAutoCostLines } from '../lead-itinerary.service.js';

const baseLines = [
  { basis: 'PER_PERSON', estimatedUnit: 100, actualUnit: 90, category: 'activity', description: 'Activity', source: 'AUTO' },
  { basis: 'PER_VEHICLE', estimatedUnit: 300, quantity: 1, actualUnit: 320, category: 'transportation', description: 'Van', source: 'AUTO' },
  { basis: 'PER_PERSON', estimatedUnit: 50, category: 'transportation', description: 'Flight', source: 'MANUAL' },
];

describe('computePricing', () => {
  it('computes the full sell-side breakdown with deposit and balance', () => {
    const result = computePricing({
      lines: baseLines,
      travelers: 4,
      currency: 'USD',
      marginType: 'PERCENTAGE',
      marginValue: 10,
      depositType: 'PERCENTAGE',
      depositValue: 30,
      discountType: 'percentage',
      discountValue: 10,
      serviceChargeRate: 5,
      taxRate: 18,
      verifiedPaymentTotal: 330.26,
    });

    expect(result.estimatedTotal).toBe(900);
    expect(result.actualTotal).toBe(680);
    expect(result.sellSubtotal).toBe(990);
    expect(result.taxAmount).toBe(160.38);
    expect(result.totalAmount).toBe(1100.88);
    expect(result.depositAmount).toBe(330.26);
    expect(result.paidAmount).toBe(330.26);
    expect(result.balanceDue).toBe(770.62);
    expect(result.profit).toBe(310);
  });

  it('computes a FIXED deposit amount from the total', () => {
    const result = computePricing({
      lines: [{ basis: 'FIXED', estimatedUnit: 1000, quantity: 1, description: 'Package' }],
      travelers: 1,
      taxRate: 0,
      depositType: 'FIXED',
      depositValue: 250,
      verifiedPaymentTotal: 250,
    });
    expect(result.depositAmount).toBe(250);
    expect(result.balanceDue).toBe(750);
  });

  it('returns zero balance when fully paid', () => {
    const result = computePricing({
      lines: [{ basis: 'FIXED', estimatedUnit: 1000, quantity: 1, description: 'Package' }],
      travelers: 1,
      taxRate: 0,
      verifiedPaymentTotal: 1000,
    });
    expect(result.paidAmount).toBe(1000);
    expect(result.balanceDue).toBe(0);
  });

  it('never produces a negative balance for overpayment', () => {
    const result = computePricing({
      lines: [{ basis: 'FIXED', estimatedUnit: 500, quantity: 1, description: 'Package' }],
      travelers: 1,
      verifiedPaymentTotal: 700,
    });
    expect(result.balanceDue).toBe(0);
  });

  it('charges no tax and uses USD when neither is given', () => {
    const result = computePricing({
      lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }],
      travelers: 1,
    });
    expect(result.currency).toBe('USD');
    expect(result.taxAmount).toBe(0);
    expect(result.totalAmount).toBe(100);
  });

  it('handles empty input without crashing', () => {
    const result = computePricing({});
    expect(result.sellSubtotal).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.depositAmount).toBe(0);
    expect(result.balanceDue).toBe(0);
    expect(result.profit).toBeNull();
  });
});

describe('toLineDescriptor', () => {
  it('converts Prisma Decimal strings into engine numbers', () => {
    const row = {
      category: 'food',
      description: 'Meals',
      basis: 'PER_PERSON',
      quantity: 4,
      estimatedUnitPrice: '60.00',
      actualUnitPrice: null,
      marginType: null,
      marginValue: null,
      source: 'AUTO',
    };
    expect(toLineDescriptor(row)).toEqual({
      category: 'food',
      description: 'Meals',
      basis: 'PER_PERSON',
      quantity: 4,
      estimatedUnit: 60,
      actualUnit: null,
      marginType: null,
      marginValue: null,
      source: 'AUTO',
    });
  });

  it('preserves margin override values', () => {
    const row = {
      category: 'activity',
      description: 'Tour',
      basis: 'PER_PERSON',
      quantity: 2,
      estimatedUnitPrice: '50.00',
      actualUnitPrice: '45.50',
      marginType: 'FIXED',
      marginValue: '10.00',
      source: 'MANUAL',
    };
    const desc = toLineDescriptor(row);
    expect(desc.actualUnit).toBe(45.5);
    expect(desc.marginType).toBe('FIXED');
    expect(desc.marginValue).toBe(10);
  });

  it('maps AUTO cost lines to engine units without zeroing costs', () => {
    const days = [
      {
        breakfastCount: 2,
        lunchCount: 1,
        dinnerCount: 1,
        accommodation: { totalAmount: 100 },
        activities: [{ defaultCost: 50, costOverride: null }],
        transports: [{ pricingModel: 'PER_VEHICLE', unitCost: 300 }],
      },
    ];
    const lines = buildAutoCostLines(days, 1, { mealPrices: { breakfast: 15, lunch: 15, dinner: 15 } }).map(toLineDescriptor);
    const food = lines.find((l) => l.category === 'food');
    const transport = lines.find((l) => l.category === 'transportation');
    const accommodation = lines.find((l) => l.category === 'accommodation');
    expect(food.estimatedUnit).toBe(60);
    expect(transport.estimatedUnit).toBe(300);
    expect(accommodation.estimatedUnit).toBe(100);
  });
});

describe('effectiveTaxRate', () => {
  it('uses the package\'s own rate when a rep set one', () => {
    expect(effectiveTaxRate(5, 18)).toBe(5);
  });

  it('keeps an own rate of 0 for a tax-exempt customer', () => {
    expect(effectiveTaxRate(0, 18)).toBe(0);
  });

  it('follows Settings when the package has no rate of its own', () => {
    expect(effectiveTaxRate(null, 12.5)).toBe(12.5);
  });

  it('reads a Prisma Decimal string as a number', () => {
    expect(effectiveTaxRate('7.50', 18)).toBe(7.5);
  });

  it('charges no tax when neither the package nor Settings has a rate', () => {
    expect(effectiveTaxRate(null, null)).toBe(0);
  });
});

describe('parseOwnTaxRate', () => {
  it('accepts a percentage', () => {
    expect(parseOwnTaxRate('8')).toBe(8);
  });

  it('treats an empty field as follow Settings', () => {
    expect(parseOwnTaxRate('')).toBeNull();
  });

  it('leaves a rate that was not sent as undefined', () => {
    expect(parseOwnTaxRate(undefined)).toBeUndefined();
  });

  it('rejects a rate above 100% with a 400', () => {
    expect(() => parseOwnTaxRate(120)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a negative rate', () => {
    expect(() => parseOwnTaxRate(-1)).toThrow('Tax rate must be a percentage from 0 to 100');
  });
});

describe('computePricing applied tax rate', () => {
  it('reports the rate it charged', () => {
    const result = computePricing({ lines: baseLines, travelers: 1, taxRate: 9 });
    expect(result.appliedTaxRate).toBe(9);
  });
});

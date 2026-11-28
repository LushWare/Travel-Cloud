import { describe, it, expect, beforeEach } from 'vitest';
import { previewPricing } from '../pricing.controller.js';
import { getLinePricing } from '../../config/pricingDefaults.js';

beforeEach(() => {
  getLinePricing.mockResolvedValue({ mealPrices: { breakfast: 15, lunch: 15, dinner: 15 } });
});

const dayWithMeals = { dayNumber: 1, breakfastCount: 1, lunchCount: 0, dinnerCount: 1, accommodation: {} };

function buildReqRes({ body = {} } = {}) {
  const req = { body };
  const res = { json: (v) => { res.body = v; }, status: () => res };
  const next = (err) => { next.err = err; };
  return { req, res, next };
}

describe('previewPricing — standalone, no lead/selection yet', () => {
  it('charges the Settings tax rate, not a built-in one', async () => {
    getLinePricing.mockResolvedValue({ mealPrices: { breakfast: 15, lunch: 15, dinner: 15 }, taxRate: 10 });
    const { req, res, next } = buildReqRes({ body: { lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }], travelers: 1 } });
    await previewPricing(req, res, next);
    expect(res.body.data.financials).toMatchObject({ taxAmount: 10, totalAmount: 110 });
  });

  it('charges no tax when Settings has no tax rate', async () => {
    getLinePricing.mockResolvedValue({ taxRate: 0 });
    const { req, res, next } = buildReqRes({ body: { lines: [{ basis: 'FIXED', estimatedUnit: 100, quantity: 1, description: 'X' }], travelers: 1 } });
    await previewPricing(req, res, next);
    expect(res.body.data.financials.taxAmount).toBe(0);
  });

  it('computes purely from days with no database lookup', async () => {
    const { req, res, next } = buildReqRes({ body: { days: [dayWithMeals], travelers: 2 } });
    await previewPricing(req, res, next);

    expect(next.err).toBeUndefined();
    expect(res.body.data.financials.estimatedTotal).toBeGreaterThan(0);
  });

  it('rejects a body with neither lines nor days', async () => {
    const { req, res, next } = buildReqRes({ body: { travelers: 2 } });
    await previewPricing(req, res, next);
    expect(next.err?.message).toMatch(/lines or days/i);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep the real service exports but stub the pricing computation so the test
// focuses on request flattening and the response contract.
vi.mock('../../services/package.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    recomputeBasePrice: vi.fn(() => ({
      basePrice: 500,
      breakdown: {
        meals: { total: 60 },
        activities: { total: 240 },
        transports: { total: 200 },
      },
    })),
  };
});

vi.mock('../../../../shared/pricing-engine/src/index.js', () => ({
  computeMargin: vi.fn((basePrice, type, value) => {
    const marginAmount =
      type === 'PERCENTAGE'
        ? Math.round((basePrice * value) / 100 * 100) / 100
        : value;
    return {
      basePrice,
      marginAmount,
      sellPrice: Math.round((basePrice + marginAmount) * 100) / 100,
    };
  }),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    package: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import prisma from '../../db/client.js';
import { calculatePrice, getAIStatus, getPackages } from '../package.controller.js';
import { recomputeBasePrice } from '../../services/package.service.js';

const makeRes = () => ({ json: vi.fn() });

describe('getPackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.package.findMany.mockResolvedValue([]);
    prisma.package.count.mockResolvedValue(0);
  });

  it('preserves the draft filter for super-admin requests', async () => {
    const req = { query: { page: '1', limit: '12', isActive: 'false' }, user: { role: 'superAdmin' } };
    const res = makeRes();

    await getPackages(req, res);

    expect(prisma.package.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: false },
    }));
    expect(prisma.package.count).toHaveBeenCalledWith({ where: { isActive: false } });
  });

  it('orders active packages before drafts when requested for All Packages', async () => {
    const req = { query: { page: '1', limit: '12', draftsLast: 'true' }, user: { role: 'superAdmin' } };
    const res = makeRes();

    await getPackages(req, res);

    expect(prisma.package.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    }));
    expect(prisma.package.count).toHaveBeenCalledWith({ where: {} });
  });
});

describe('getAIStatus', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports configured/valid for a real-world key that does not start with "AI"', async () => {
    // Regression: a naive key.startsWith('AI') format check previously
    // misreported real, working keys (observed in practice) as invalid.
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: 'AQ.fake-test-key-does-not-start-with-AI-0000000000' };
    const res = makeRes();

    await getAIStatus({}, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, configured: true, keyFormat: 'valid' });
  });

  it('reports not configured when no key is set', async () => {
    process.env = { ...ORIGINAL_ENV, GEMINI_API_KEY: '' };
    const res = makeRes();

    await getAIStatus({}, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, configured: false, keyFormat: 'missing' });
  });
});

describe('calculatePrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flattens itinerary days and returns the full pricing response contract', async () => {
    const req = {
      body: {
        itineraryDays: [
          {
            dayNumber: 1,
            breakfastCount: 2,
            lunchCount: 1,
            dinnerCount: 0,
            activities: [{ name: 'City Tour', defaultCost: 50 }],
            transports: [{ pricingModel: 'PER_VEHICLE', unitCost: 200 }],
            accommodation: { totalAmount: 100, currency: 'USD' },
          },
        ],
        defaultMarginType: 'PERCENTAGE',
        defaultMarginInput: 20,
      },
    };
    const res = makeRes();

    await calculatePrice(req, res);

    expect(recomputeBasePrice).toHaveBeenCalledWith(
      req.body.itineraryDays,
      [{ name: 'City Tour', defaultCost: 50 }],
      [{ pricingModel: 'PER_VEHICLE', unitCost: 200 }],
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        packageCost: 600, // 500 engine + 100 accommodation
        sellPrice: 720,
        margin: { type: 'PERCENTAGE', amount: 120 },
        breakdown: {
          meals: { total: 60 },
          activities: { total: 240 },
          transports: { total: 200 },
          accommodation: { total: 100 },
        },
      },
    });
  });

  it('defaults margin and tolerates an empty body', async () => {
    const req = { body: {} };
    const res = makeRes();

    await calculatePrice(req, res);

    expect(recomputeBasePrice).toHaveBeenCalledWith([], [], []);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        packageCost: 500,
        sellPrice: 500,
        margin: { type: 'PERCENTAGE', amount: 0 },
        breakdown: {
          meals: { total: 60 },
          activities: { total: 240 },
          transports: { total: 200 },
          accommodation: { total: 0 },
        },
      },
    });
  });
});

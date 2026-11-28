import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// calculatePrice runs the real shared pricing engine, so its tests assert the
// actual per-person numbers a rep sees in the package editor.
vi.mock('../../db/client.js', () => ({
  default: {
    package: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn((args) => args),
    },
    $transaction: vi.fn().mockResolvedValue([]),
    // No catalogued activities unless a test says otherwise.
    activityCatalog: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../../config/orgSettings.js', () => ({ getPricingDefaults: vi.fn().mockResolvedValue({}) }));

import prisma from '../../db/client.js';
import { getPricingDefaults } from '../../config/orgSettings.js';
import { calculatePrice, getAIStatus, getPackageOptions, getPackages, repriceAllPackages } from '../package.controller.js';

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

describe('getPackageOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only active package picker fields', async () => {
    const data = [{ id: 'pkg-1', title: 'Sri Lanka Explorer', isActive: true }];
    prisma.package.findMany.mockResolvedValue(data);
    const res = makeRes();

    await getPackageOptions({}, res);

    expect(prisma.package.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, title: true, isActive: true },
      orderBy: { title: 'asc' },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
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
    getPricingDefaults.mockResolvedValue({ mealPrices: { breakfast: 15, lunch: 15, dinner: 15 } });
  });

  // One day: 3 meals ($15 each) and a $50 tour per person, a $200 private car
  // and a $100 room shared by the two travellers.
  const oneDayBody = () => ({
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
  });

  async function price(body) {
    const res = makeRes();
    await calculatePrice({ body }, res);
    return res.json.mock.calls[0][0].data;
  }

  it('prices meals at the Settings breakfast, lunch and dinner prices', async () => {
    getPricingDefaults.mockResolvedValueOnce({ mealPrices: { breakfast: 8, lunch: 15, dinner: 20 } });
    // 2 people x (2 breakfasts x 8 + 1 lunch x 15)
    expect((await price(oneDayBody())).party.breakdown.meals).toBe(62);
  });

  it('returns the cost per person for two people sharing', async () => {
    // (meals 90 + tour 100 + car 200 + room 100) / 2
    expect((await price(oneDayBody())).packageCost).toBe(245);
  });

  it('includes the hotel room in the package cost', async () => {
    expect((await price(oneDayBody())).party.breakdown.accommodation).toBe(100);
  });

  it('applies the margin to the per-person cost', async () => {
    const data = await price(oneDayBody());
    expect(data.sellPrice).toBe(294);
    expect(data.margin).toEqual({ type: 'PERCENTAGE', amount: 49 });
  });

  it('labels the price as per person, twin sharing', async () => {
    const data = await price(oneDayBody());
    expect(data.basis).toBe('PER_PERSON_TWIN_SHARING');
    expect(data.occupancy).toBe(2);
  });

  it('returns the single-traveller price', async () => {
    // 45 + 50 + 200 + 100 = 395, +20% = 474
    expect((await price(oneDayBody())).single).toEqual({ perPerson: 395, sellPerPerson: 474, total: 395 });
  });

  it('prices a catalog activity by its cost override', async () => {
    const body = oneDayBody();
    body.itineraryDays[0].activities = [{ name: 'City Tour', defaultCost: 50, costOverride: 80 }];
    // (90 + 160 + 200 + 100) / 2
    expect((await price(body)).packageCost).toBe(275);
  });

  it('does not charge meals the hotel meal plan already includes', async () => {
    const body = oneDayBody();
    body.itineraryDays = [
      { dayNumber: 1, dinnerCount: 1, accommodation: { totalAmount: 100, boardType: 'Half Board' } },
      { dayNumber: 2, breakfastCount: 1 },
    ];
    // Only the room is charged: 100 / 2 people.
    expect((await price(body)).packageCost).toBe(50);
  });

  it('prices an activity at its catalog cost, as saving does', async () => {
    prisma.activityCatalog.findMany.mockResolvedValueOnce([{ id: 'act-1', name: 'City Tour', defaultCost: '60.00' }]);
    const body = oneDayBody();
    body.itineraryDays[0].activities = [{ activityId: 'act-1', name: 'City Tour', defaultCost: 50 }];
    // (meals 90 + tour 2 × 60 + car 200 + room 100) / 2
    expect((await price(body)).packageCost).toBe(255);
  });

  it('returns breakdown lines that add up to the per-person cost', async () => {
    const data = await price(oneDayBody());
    const { meals, activities, transports, hotels } = data.rows;
    const perPerson =
      meals.reduce((s, m) => s + m.costPerPerson, 0)
      + activities.reduce((s, a) => s + a.costPerPerson, 0)
      + transports.reduce((s, t) => s + (t.pricingModel === 'PER_PERSON' ? t.unitCost : t.unitCost / 2), 0)
      + hotels.reduce((s, h) => s + h.roomPrice / 2, 0);
    expect(perPerson).toBe(data.packageCost);
  });

  it('defaults margin and tolerates an empty body', async () => {
    const data = await price({});
    expect(data.packageCost).toBe(0);
    expect(data.sellPrice).toBe(0);
    expect(data.margin).toEqual({ type: 'PERCENTAGE', amount: 0 });
  });
});

describe('repriceAllPackages', () => {
  const storedPackage = {
    id: 'pkg-1', title: 'Beach Escape', isActive: true, basePrice: 15, sellPrice: 18,
    defaultMarginType: 'PERCENTAGE', defaultMarginInput: 20,
    itineraryDays: [{ dayNumber: 1, breakfastCount: 1, lunchCount: 0, dinnerCount: 1, activities: [], transports: [], flights: [], accommodation: {} }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.package.findMany.mockResolvedValue([storedPackage]);
    getPricingDefaults.mockResolvedValue({ mealPrices: { breakfast: 8, lunch: 15, dinner: 20 } });
  });

  async function reprice(body) {
    const res = makeRes();
    await repriceAllPackages({ body }, res);
    return res.json.mock.calls[0][0].data;
  }

  it('previews the new website price from the Settings meal prices', async () => {
    // (8 + 20) x 2 people / 2 = 28 cost, + 20% margin
    expect((await reprice({ commit: false })).packages[0]).toMatchObject({ oldPrice: 18, newPrice: 33.6 });
  });

  it('writes nothing on a preview', async () => {
    await reprice({ commit: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('saves the new cost when committed', async () => {
    await reprice({ commit: true });
    expect(prisma.package.update).toHaveBeenCalledWith({ where: { id: 'pkg-1' }, data: { basePrice: 28 } });
  });

  it('leaves out a package whose cost is already current', async () => {
    prisma.package.findMany.mockResolvedValue([{ ...storedPackage, basePrice: 28 }]);
    expect((await reprice({ commit: false })).changed).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── Mock prisma (no real DB) ────────────────────────────────────────
const { mockPrisma } = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  });
  return {
    mockPrisma: {
      lead: model(),
      leadPackageSelection: model(),
      leadPricing: model(),
      leadCostLine: model(),
      leadItineraryDay: model(),
      $transaction: vi.fn(async function (arg) { return typeof arg === 'function' ? arg(this) : Promise.all(arg); }),
      $connect: vi.fn(),
    },
  };
});

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma }));

// Dynamic import after mocks are registered.
const { default: app } = await import('../../src/app.js');

const LEAD = 'lead-1';
const SEL = 'sel-1';

function authHeaders(overrides = {}) {
  return {
    'x-user-id': overrides.id || 'agent-1',
    'x-user-role': overrides.role || 'admin',
    'x-user-email': overrides.email || 'agent@test.com',
    'x-user-name': overrides.name || 'Test Agent',
    'x-user-permissions': JSON.stringify(overrides.permissions || []),
    'x-user-is-super-admin': String(overrides.isSuperAdmin ?? false),
  };
}

/** A package-service blueprint response with names nested under place/activity. */
const nestedBlueprint = {
  id: 'pkg-1', title: 'Sri Lanka', currency: 'USD',
  itineraryDays: [{
    dayNumber: 1, title: 'Day 1', breakfastCount: 1, lunchCount: 0, dinnerCount: 1,
    accommodation: { totalAmount: 120 },
    places: [{ placeId: 'p1', place: { name: 'Sigiriya Rock' }, customName: null, orderIndex: 0 }],
    activities: [{ activityId: 'a1', activity: { name: 'Temple Tour', defaultCost: 40 }, costOverride: null, orderIndex: 0 }],
    transports: [],
  }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async function (arg) { return typeof arg === 'function' ? arg(this) : Promise.all(arg); });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /leads/:id/packages/:selectionId — itinerary load', () => {
  it('returns locations and activities with their names for a materialized selection', async () => {
    mockPrisma.leadPackageSelection.findUnique.mockResolvedValue({
      id: SEL, leadId: LEAD, isManual: false, packageId: 'pkg-1',
      pricing: { totalAmount: 500, currency: 'USD' },
      costLines: [], optionalFlights: [],
      itineraryDays: [{
        dayNumber: 1, title: 'Day 1', breakfastCount: 1, lunchCount: 0, dinnerCount: 1,
        mealPriceOverride: null, accommodation: {}, flights: [],
        places: [{ id: 'dp1', placeId: 'p1', customName: 'Sigiriya Rock', orderIndex: 0 }],
        activities: [{ id: 'da1', activityId: 'a1', name: 'Temple Tour', defaultCost: '40', costOverride: null, orderIndex: 0 }],
        transports: [],
      }],
    });

    const res = await request(app)
      .get(`/api/v1/leads/${LEAD}/packages/${SEL}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    const day = res.body.data.itineraryDays[0];
    expect(day.places[0].customName).toBe('Sigiriya Rock');
    expect(day.activities[0].name).toBe('Temple Tour');
  });

  it('resolves catalog names from the package blueprint for a pristine selection', async () => {
    // Pristine: no persisted days/pricing → derived live from package-service.
    mockPrisma.leadPackageSelection.findUnique.mockResolvedValue({
      id: SEL, leadId: LEAD, isManual: false, packageId: 'pkg-1',
      pricing: null, costLines: [], optionalFlights: [], itineraryDays: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: nestedBlueprint }) }));

    const res = await request(app)
      .get(`/api/v1/leads/${LEAD}/packages/${SEL}`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.data.isMaterialized).toBe(false);
    const day = res.body.data.itineraryDays[0];
    expect(day.places.map((p) => p.customName)).toEqual(['Sigiriya Rock']);
    expect(day.activities.map((a) => a.name)).toEqual(['Temple Tour']);
  });
});

describe('PUT /leads/:id/packages/:selectionId/itinerary — save recomputes quote + syncs budget', () => {
  it('persists a nonzero total reflecting the meal override and writes the lead budget', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({
      id: LEAD, lifecycleStatus: 'DRAFTING', numberOfTravelers: 2, primarySelectionId: SEL,
    });
    mockPrisma.leadPackageSelection.findUnique.mockResolvedValue({
      id: SEL, leadId: LEAD, isManual: false, packageId: 'pkg-1',
      pricing: { currency: 'USD', marginType: null, marginValue: null, discountType: 'none', discountValue: 0, serviceChargeRate: 0 },
      costLines: [], optionalFlights: [], itineraryDays: [],
    });
    mockPrisma.leadPackageSelection.update.mockResolvedValue({ id: SEL });
    // The recompute reads freshly-persisted lines: a meal line at $100/meal × 3.
    mockPrisma.leadCostLine.findMany.mockResolvedValue([
      { category: 'food', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: 300, actualUnitPrice: null, marginType: null, marginValue: null, source: 'AUTO' },
    ]);
    mockPrisma.leadPricing.update.mockResolvedValue({ id: 'pr-1' });
    // syncLeadBudgetFromSelection reads these back.
    mockPrisma.leadPricing.findUnique.mockResolvedValue({ totalAmount: 708, currency: 'USD' });
    mockPrisma.lead.update.mockResolvedValue({ id: LEAD });

    const res = await request(app)
      .put(`/api/v1/leads/${LEAD}/packages/${SEL}/itinerary`)
      .set(authHeaders())
      .send({
        days: [{ dayNumber: 1, breakfastCount: 1, lunchCount: 1, dinnerCount: 1, mealPriceOverride: 100 }],
        pricing: { marginType: null, marginValue: 0 },
      });

    expect(res.status).toBe(200);

    // Bug 3: recompute persisted a nonzero total (food 300 × 2 pax + 18% tax = 708).
    const pricingUpdate = mockPrisma.leadPricing.update.mock.calls[0][0];
    expect(pricingUpdate.data.totalAmount).toBe(708);

    // Bug 2: budget synced from the primary selection total.
    const leadUpdate = mockPrisma.lead.update.mock.calls.find((c) => c[0]?.data?.budget != null);
    expect(leadUpdate).toBeTruthy();
    expect(leadUpdate[0].data.budget).toBe('USD 708');
  });
});

describe('POST /leads/:id/packages/:selectionId/quote — presented selection in response', () => {
  it('returns the presented shape (itineraryDays/isMaterialized), not the bare Prisma row', async () => {
    const leadRow = {
      id: LEAD, lifecycleStatus: 'QUOTED', primarySelectionId: SEL,
      name: 'Jane Doe', email: 'jane@test.com', phone: '555-0100', city: 'Colombo',
      destination: 'Sri Lanka', travelDate: null, endDate: null, numberOfTravelers: 2,
    };
    const selectionRow = {
      id: SEL, leadId: LEAD, packageId: null, packageName: 'Manual Trip', isManual: true, currentQuoteId: null,
      pricing: {
        currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0,
        marginType: null, marginValue: 0, depositType: null, depositValue: 0, paidAmount: 0,
      },
      costLines: [], itineraryDays: [], optionalFlights: [], lead: leadRow,
    };

    mockPrisma.lead.findUnique.mockResolvedValue(leadRow);
    mockPrisma.lead.update.mockResolvedValue({ id: LEAD });
    mockPrisma.leadPackageSelection.findUnique.mockResolvedValue(selectionRow);
    mockPrisma.leadPackageSelection.update.mockResolvedValue({ id: SEL });
    mockPrisma.leadItineraryDay.count.mockResolvedValue(1); // materialized — skip materializeSelection
    mockPrisma.leadPricing.findUnique.mockResolvedValue({ id: 'pr-1' }); // no totalAmount -> budget sync no-ops
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 'quote-1', leadId: LEAD } }) }));

    const res = await request(app)
      .post(`/api/v1/leads/${LEAD}/packages/${SEL}/quote`)
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(res.body.data.selection.isMaterialized).toBe(true);
    expect(Array.isArray(res.body.data.selection.itineraryDays)).toBe(true);
    expect(res.body.data.selection.costLines).toBeDefined();
    expect(res.body.data.quotation.id).toBe('quote-1');
  });
});

describe('auth', () => {
  it('rejects a request without gateway user headers', async () => {
    const res = await request(app).get(`/api/v1/leads/${LEAD}/packages/${SEL}`);
    expect(res.status).toBe(401);
  });
});

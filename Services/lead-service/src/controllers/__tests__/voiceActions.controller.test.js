import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLeadFindUnique, mockLeadUpdate,
  mockSelectionFindUnique, mockSelectionFindMany, mockSelectionFindFirst,
  mockSelectionCreate, mockSelectionUpdate,
  mockCostLineFindMany, mockPricingFindUnique,
  mockApplyItinerary, mockFetchPackage,
} = vi.hoisted(() => ({
  mockLeadFindUnique: vi.fn(),
  mockLeadUpdate: vi.fn(),
  mockSelectionFindUnique: vi.fn(),
  mockSelectionFindMany: vi.fn(),
  mockSelectionFindFirst: vi.fn(),
  mockSelectionCreate: vi.fn(),
  mockSelectionUpdate: vi.fn(),
  mockCostLineFindMany: vi.fn(),
  mockPricingFindUnique: vi.fn(),
  mockApplyItinerary: vi.fn(),
  mockFetchPackage: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: { findUnique: mockLeadFindUnique, update: mockLeadUpdate },
    leadPackageSelection: {
      findUnique: mockSelectionFindUnique,
      findMany: mockSelectionFindMany,
      findFirst: mockSelectionFindFirst,
      create: mockSelectionCreate,
      update: mockSelectionUpdate,
    },
    leadCostLine: { findMany: mockCostLineFindMany },
    leadPricing: { findUnique: mockPricingFindUnique },
  },
}));

vi.mock('../../services/lead-itinerary.service.js', async () => {
  const actual = await vi.importActual('../../services/lead-itinerary.service.js');
  return { ...actual, applyLeadSelectionItinerary: mockApplyItinerary };
});

vi.mock('../../services/lead-draft.service.js', () => ({
  fetchPackage: mockFetchPackage,
}));

const {
  getTripBrief, getPaymentBrief, attachPackageForVoice, adjustItineraryForVoice, previewPricingForVoice,
  approveAiChange,
} = await import('../voiceActions.controller.js');

const res = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() });
const next = vi.fn();

// asyncHandler routes a thrown AppError to next(err) rather than rejecting
// the returned promise — assert against what next() received.
async function expectNextError(handler, req, match) {
  const n = vi.fn();
  await handler(req, res(), n);
  expect(n).toHaveBeenCalledTimes(1);
  const err = n.mock.calls[0][0];
  expect(err).toBeInstanceOf(Error);
  if (match instanceof RegExp) expect(err.message).toMatch(match);
  else expect(err.message).toContain(match);
  return err;
}

const lead = (over = {}) => ({
  id: 'lead-1', lifecycleStatus: 'DRAFTING', destination: 'Maldives', travelDate: null, endDate: null,
  numberOfTravelers: 2, primarySelectionId: 'sel-1', ...over,
});

const selection = (over = {}) => ({
  id: 'sel-1', leadId: 'lead-1', packageId: 'pkg-1', packageName: 'Maldives 5N',
  isManual: false, currentQuoteId: null, itineraryDays: [], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // resolveActiveSelection() falls back to findMany whenever the primary
  // selection lookup misses — give every test a safe default so only tests
  // that actually exercise that fallback need to override it.
  mockSelectionFindMany.mockResolvedValue([]);
  // clearAllMocks() clears call history but NOT implementations, so a test
  // that makes this reject would otherwise leak into every test after it.
  mockSelectionUpdate.mockResolvedValue({ id: 'sel-1' });
  mockLeadUpdate.mockResolvedValue({ id: 'lead-1' });
});

describe('getTripBrief', () => {
  it('never includes a money field', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection());
    const r = res();
    await getTripBrief({ params: { id: 'lead-1' } }, r, next);
    const data = r.json.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toMatch(/amount|total|price|cost/i);
  });

  it('reports the coarse status class, not the raw lifecycle status', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'QUOTED' }));
    mockSelectionFindUnique.mockResolvedValue(null);
    const r = res();
    await getTripBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.statusClass).toBe('quote_sent');
    expect(r.json.mock.calls[0][0].data.statusClass).not.toBe('QUOTED');
  });

  it('reports hasBeenQuoted from the selection quote pointer', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue({ ...selection({ currentQuoteId: 'q-1' }), itineraryDays: [{}, {}] });
    const r = res();
    await getTripBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.itinerary.hasBeenQuoted).toBe(true);
    expect(r.json.mock.calls[0][0].data.itinerary.nights).toBe(2);
  });

  it('includes the quotation id so voice-service can ask billing-service to resend it', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue({ ...selection({ currentQuoteId: 'quote-42' }), itineraryDays: [] });
    const r = res();
    await getTripBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.itinerary.quotationId).toBe('quote-42');
  });

  it('reports a null quotationId when no quote has been sent', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue({ ...selection({ currentQuoteId: null }), itineraryDays: [] });
    const r = res();
    await getTripBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.itinerary.quotationId).toBeNull();
  });

  it('returns 404 for a lead that does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const err = await expectNextError(getTripBrief, { params: { id: 'missing' } }, 'Lead not found');
    expect(err.statusCode).toBe(404);
  });
});

describe('getPaymentBrief', () => {
  it('withholds every figure when no quotation has been sent', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection({ currentQuoteId: null }));
    const r = res();
    await getPaymentBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data).toEqual({ hasQuote: false });
  });

  it('returns figures once a quotation exists for the selection', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection({ currentQuoteId: 'quote-1' }));
    mockPricingFindUnique.mockResolvedValue({
      currency: 'USD', totalAmount: 2400, depositAmount: 720, paidAmount: 720, balanceDue: 1680,
    });
    const r = res();
    await getPaymentBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data).toEqual({
      hasQuote: true, currency: 'USD', totalAmount: 2400, depositAmount: 720, paidAmount: 720, balanceDue: 1680,
    });
  });

  it('withholds figures when a quote pointer exists but the pricing row does not', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection({ currentQuoteId: 'quote-1' }));
    mockPricingFindUnique.mockResolvedValue(null);
    const r = res();
    await getPaymentBrief({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data).toEqual({ hasQuote: false });
  });
});

describe('attachPackageForVoice', () => {
  it('rejects a request with no packageId', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    await expectNextError(attachPackageForVoice, { params: { id: 'lead-1' }, body: {} }, 'packageId is required');
  });

  it('creates a new selection for an unattached package', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ primarySelectionId: null }));
    mockSelectionFindFirst.mockResolvedValue(null);
    mockFetchPackage.mockResolvedValue({ title: 'Bali Escape' });
    mockSelectionCreate.mockResolvedValue({ id: 'sel-2' });
    const r = res();
    await attachPackageForVoice({ params: { id: 'lead-1' }, body: { packageId: 'pkg-2' } }, r, next);
    expect(mockSelectionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-1', packageId: 'pkg-2' }),
    }));
    expect(r.json.mock.calls[0][0].data).toEqual({ selectionId: 'sel-2', packageName: 'Bali Escape', alreadyAttached: false });
  });

  it('does not create a duplicate selection for a package already on the lead', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-1' });
    const r = res();
    await attachPackageForVoice({ params: { id: 'lead-1' }, body: { packageId: 'pkg-1' } }, r, next);
    expect(mockSelectionCreate).not.toHaveBeenCalled();
    expect(r.json.mock.calls[0][0].data.alreadyAttached).toBe(true);
  });

  it('flags the lead as AI-touched and marks the exact package as auto-book eligible', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ primarySelectionId: null }));
    mockSelectionFindFirst.mockResolvedValue(null);
    mockFetchPackage.mockResolvedValue({ title: 'Bali Escape' });
    mockSelectionCreate.mockResolvedValue({ id: 'sel-2' });
    await attachPackageForVoice({ params: { id: 'lead-1' }, body: { packageId: 'pkg-2' } }, res(), next);
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aiHandled: true,
        needsRepFollowup: true,
        voiceExactPackageMatch: true,
        voicePriceChanged: false,
        voiceNeedsRepReview: false,
        voiceReviewReason: null,
        voiceAiBookingAllowed: false,
      }),
    }));
  });

  it('still attaches the package when package-service is unreachable', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ primarySelectionId: null }));
    mockSelectionFindFirst.mockResolvedValue(null);
    mockFetchPackage.mockRejectedValue(new Error('package-service down'));
    mockSelectionCreate.mockResolvedValue({ id: 'sel-2' });
    const r = res();
    await attachPackageForVoice({ params: { id: 'lead-1' }, body: { packageId: 'pkg-2' } }, r, next);
    expect(r.json.mock.calls[0][0].data.selectionId).toBe('sel-2');
  });
});

describe('adjustItineraryForVoice — status guards', () => {
  it('refuses to edit a lead already APPROVED', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'APPROVED' }));
    mockSelectionFindUnique.mockResolvedValue(selection());
    await expectNextError(adjustItineraryForVoice, { params: { id: 'lead-1' }, body: { addNights: 2 } }, /already being processed/);
    expect(mockApplyItinerary).not.toHaveBeenCalled();
  });

  it('refuses to edit a CONFIRMED booking', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'CONFIRMED' }));
    mockSelectionFindUnique.mockResolvedValue(selection());
    await expectNextError(adjustItineraryForVoice, { params: { id: 'lead-1' }, body: { addNights: 1 } }, /already being processed/);
  });

  it('moves a QUOTED lead to REVISION before applying the edit', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'QUOTED' }));
    mockSelectionFindUnique.mockResolvedValue({ ...selection(), itineraryDays: [] });
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lifecycleStatus: 'REVISION' }),
    }));
  });

  it('marks changed-package edits as rep review required with pricing recalculation', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'DRAFTING' }));
    mockSelectionFindUnique.mockResolvedValue({ ...selection(), itineraryDays: [] });
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        voiceExactPackageMatch: false,
        voicePriceChanged: true,
        voiceNeedsRepReview: true,
        voiceReviewReason: 'package_changed_requires_repricing',
        voiceAiBookingAllowed: false,
      }),
    }));
  });

  it('does not touch lifecycleStatus for a lead already in DRAFTING', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ lifecycleStatus: 'DRAFTING' }));
    mockSelectionFindUnique.mockResolvedValue({ ...selection(), itineraryDays: [] });
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, res(), next);
    const statusUpdateCalls = mockLeadUpdate.mock.calls.filter((c) => c[0].data?.lifecycleStatus);
    expect(statusUpdateCalls).toHaveLength(0);
  });
});

describe('adjustItineraryForVoice — day math', () => {
  const withDays = (n) => ({
    ...selection(),
    itineraryDays: Array.from({ length: n }, (_, i) => ({
      dayNumber: i + 1, title: null, description: null, breakfastCount: 0, lunchCount: 0, dinnerCount: 0,
      mealPriceOverride: null, accommodation: { name: 'Original Resort' }, flights: [], places: [], activities: [],
    })),
  });

  it('rejects a call with none of the recognised fields', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(3));
    await expectNextError(adjustItineraryForVoice, { params: { id: 'lead-1' }, body: {} }, 'At least one of');
  });

  it('appends the requested number of nights', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(3));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(mockApplyItinerary.mock.calls[0][0].days).toHaveLength(5);
  });

  it('caps a single add request at 14 nights', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(1));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 999 } }, res(), next);
    expect(mockApplyItinerary.mock.calls[0][0].days).toHaveLength(15);
  });

  it('trims the requested number of nights from the end', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(5));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { removeNights: 2 } }, res(), next);
    expect(mockApplyItinerary.mock.calls[0][0].days).toHaveLength(3);
  });

  it('never removes more nights than exist', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { removeNights: 10 } }, res(), next);
    expect(mockApplyItinerary.mock.calls[0][0].days).toHaveLength(0);
  });

  it('renumbers days sequentially after adding', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, res(), next);
    const days = mockApplyItinerary.mock.calls[0][0].days;
    expect(days.map((d) => d.dayNumber)).toEqual([1, 2, 3]);
  });

  it('sets the hotel name on every day while preserving other accommodation fields', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue({
      ...selection(),
      itineraryDays: [{
        dayNumber: 1, title: null, description: null, breakfastCount: 1, lunchCount: 0, dinnerCount: 0,
        mealPriceOverride: null, accommodation: { name: 'Old Resort', roomType: 'Deluxe' }, flights: [], places: [], activities: [],
      }],
    });
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { hotelName: 'Sunset Bay Resort' } }, res(), next);
    const day = mockApplyItinerary.mock.calls[0][0].days[0];
    expect(day.accommodation).toEqual({ name: 'Sunset Bay Resort', roomType: 'Deluxe' });
  });

  it('applies with actor SYSTEM so the audit trail attributes the edit to the voice agent', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(1));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, res(), next);
    expect(mockApplyItinerary.mock.calls[0][0].actor).toBe('SYSTEM');
  });

  it('flags the lead as AI-touched after an itinerary edit', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(1));
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, res(), next);
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aiHandled: true, needsRepFollowup: true }),
    }));
  });
});

describe('previewPricingForVoice', () => {
  it('never writes to leadPricing — the result is computed, not saved', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection());
    mockCostLineFindMany.mockResolvedValue([
      { category: 'package', description: 'Maldives 5N', basis: 'FIXED', quantity: 1, estimatedUnitPrice: 1000, actualUnitPrice: null, marginType: null, marginValue: null, source: 'AUTO' },
    ]);
    mockPricingFindUnique.mockResolvedValue(null);
    const r = res();
    await previewPricingForVoice({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.persisted).toBe(false);
  });

  it('returns 404 when the lead has no package selection to price', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ primarySelectionId: null }));
    mockSelectionFindMany.mockResolvedValue([]);
    await expectNextError(previewPricingForVoice, { params: { id: 'lead-1' } }, 'No package selection to price');
  });

  it('falls back to the package base price when no cost lines exist yet', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(selection());
    mockCostLineFindMany.mockResolvedValue([]);
    mockFetchPackage.mockResolvedValue({ title: 'Maldives 5N', basePrice: 1500 });
    mockPricingFindUnique.mockResolvedValue(null);
    const r = res();
    await previewPricingForVoice({ params: { id: 'lead-1' } }, r, next);
    expect(r.json.mock.calls[0][0].data.financials.sellSubtotal).toBeGreaterThan(0);
  });
});

describe('adjustItineraryForVoice — the before/after snapshot a rep reviews', () => {
  const withDays = (n, hotel = 'Original Resort') => ({
    ...selection(),
    itineraryDays: Array.from({ length: n }, (_, i) => ({
      dayNumber: i + 1, title: null, description: null, breakfastCount: 0, lunchCount: 0, dinnerCount: 0,
      mealPriceOverride: null, accommodation: { name: hotel }, flights: [], places: [], activities: [],
    })),
  });

  const snapshotFrom = () => {
    const call = mockSelectionUpdate.mock.calls.find((c) => c[0].data?.pendingAiChange);
    return call?.[0].data.pendingAiChange;
  };

  beforeEach(() => {
    mockApplyItinerary.mockResolvedValue({ leadId: 'lead-1', selectionId: 'sel-1', lifecycleStatus: 'DRAFTING' });
  });

  it('records the night count before the edit, which the edit itself overwrites', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(3));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(snapshotFrom().before.nights).toBe(3);
  });

  it('records the night count after the edit', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(3));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(snapshotFrom().after.nights).toBe(5);
  });

  it('describes an added-nights change in plain language', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(3));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 2 } }, res(), next);
    expect(snapshotFrom().summary).toBe('Added 2 nights');
  });

  it('describes a removed-nights change in plain language', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(5));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { removeNights: 1 } }, res(), next);
    expect(snapshotFrom().summary).toBe('Removed 1 night');
  });

  it('records both the old and new hotel name', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2, 'Old Resort'));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { hotelName: 'Sunset Bay' } }, res(), next);
    const snap = snapshotFrom();
    expect(snap.before.hotel).toBe('Old Resort');
    expect(snap.after.hotel).toBe('Sunset Bay');
    expect(snap.summary).toContain('Changed hotel to Sunset Bay');
  });

  it('records a destination change against the lead’s existing destination', async () => {
    mockLeadFindUnique.mockResolvedValue(lead({ destination: 'Maldives' }));
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { destination: 'Bali' } }, res(), next);
    const snap = snapshotFrom();
    expect(snap.before.destination).toBe('Maldives');
    expect(snap.after.destination).toBe('Bali');
  });

  it('stamps when the change was made, so the rep sees how fresh it is', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, res(), next);
    expect(Date.parse(snapshotFrom().changedAt)).not.toBeNaN();
  });

  // The itinerary write commits before the snapshot write. Failing the request
  // afterwards would tell the agent the edit did not happen when it did, and a
  // retry would apply it twice.
  it('still reports success when the review card cannot be saved', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    mockSelectionUpdate.mockRejectedValue(new Error('column does not exist'));
    const r = res();
    const log = { error: vi.fn() };
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 }, log }, r, next);
    expect(r.json.mock.calls[0][0].success).toBe(true);
    expect(r.json.mock.calls[0][0].data.reviewCardSaved).toBe(false);
  });

  it('logs loudly when the review card cannot be saved, rather than failing silently', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    mockSelectionUpdate.mockRejectedValue(new Error('column does not exist'));
    const log = { error: vi.fn() };
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 }, log }, res(), next);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1' }),
      expect.stringContaining('review card could not be saved'),
    );
  });

  it('reports reviewCardSaved true on the normal path', async () => {
    mockLeadFindUnique.mockResolvedValue(lead());
    mockSelectionFindUnique.mockResolvedValue(withDays(2));
    const r = res();
    await adjustItineraryForVoice({ params: { id: 'lead-1' }, body: { addNights: 1 } }, r, next);
    expect(r.json.mock.calls[0][0].data.reviewCardSaved).toBe(true);
  });
});

describe('approveAiChange', () => {
  it('clears the pending change once a rep accepts it', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pendingAiChange: { summary: 'Added 2 nights' } });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', pendingAiChange: null });
    await approveAiChange({ params: { id: 'lead-1', selectionId: 'sel-1' }, user: { id: 'rep-1' } }, res(), next);
    expect(mockSelectionUpdate.mock.calls[0][0].data.pendingAiChange).toBeNull();
  });

  it('clears the lead’s needs-a-rep flag and stamps who reviewed it', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pendingAiChange: { summary: 'x' } });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', pendingAiChange: null });
    await approveAiChange({ params: { id: 'lead-1', selectionId: 'sel-1' }, user: { id: 'rep-7' } }, res(), next);
    const leadUpdate = mockLeadUpdate.mock.calls[0][0].data;
    expect(leadUpdate.needsRepFollowup).toBe(false);
    expect(leadUpdate.aiVerifiedById).toBe('rep-7');
  });

  it('refuses when there is no pending change to approve', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pendingAiChange: null });
    const err = await expectNextError(
      approveAiChange,
      { params: { id: 'lead-1', selectionId: 'sel-1' }, user: { id: 'rep-1' } },
      'no pending voice-agent change',
    );
    expect(err.statusCode).toBe(409);
  });

  it('refuses a selection that belongs to a different lead', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'someone-elses-lead', pendingAiChange: { summary: 'x' } });
    const err = await expectNextError(
      approveAiChange,
      { params: { id: 'lead-1', selectionId: 'sel-1' }, user: { id: 'rep-1' } },
      'Package selection not found',
    );
    expect(err.statusCode).toBe(404);
  });
});

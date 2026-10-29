import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLeadFindUnique,
  mockLeadUpdate,
  mockSelectionFindUnique,
  mockSelectionFindMany,
  mockSelectionFindFirst,
  mockSelectionCreate,
  mockSelectionUpdate,
  mockSelectionDelete,
  mockCostLineFindMany,
  mockOptionalFlightFindMany,
  mockOptionalFlightFindUnique,
  mockOptionalFlightCreate,
  mockOptionalFlightDelete,
  mockCostLineCreate,
  mockCostLineDeleteMany,
  mockCostLineCreateMany,
  mockPricingUpdate,
  mockTransaction,
  mockFetchPackage,
  mockDeriveSelectionView,
  mockToEditorDays,
  mockIsSelectionMaterialized,
  mockMaterializeSelection,
  mockRefreshSelection,
  mockRecomputeSelectionPricing,
  mockSnapshotSelectionQuotation,
  mockSendVoiceQuotation,
  mockSyncLeadBudgetFromSelection,
  mockApplyLeadSelectionItinerary,
  mockSerializeLeadDays,
  mockBuildAutoCostLines,
  mockValidateTransition,
  mockGatekeeperInputs,
} = vi.hoisted(() => ({
  mockLeadFindUnique: vi.fn(),
  mockLeadUpdate: vi.fn(),
  mockSelectionFindUnique: vi.fn(),
  mockSelectionFindMany: vi.fn(),
  mockSelectionFindFirst: vi.fn(),
  mockSelectionCreate: vi.fn(),
  mockSelectionUpdate: vi.fn(),
  mockSelectionDelete: vi.fn(),
  mockCostLineFindMany: vi.fn(),
  mockOptionalFlightFindMany: vi.fn(),
  mockOptionalFlightFindUnique: vi.fn(),
  mockOptionalFlightCreate: vi.fn(),
  mockOptionalFlightDelete: vi.fn(),
  mockCostLineCreate: vi.fn(),
  mockCostLineDeleteMany: vi.fn(),
  mockCostLineCreateMany: vi.fn(),
  mockPricingUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockFetchPackage: vi.fn(),
  mockDeriveSelectionView: vi.fn(),
  mockToEditorDays: vi.fn(),
  mockIsSelectionMaterialized: vi.fn(),
  mockMaterializeSelection: vi.fn(),
  mockRefreshSelection: vi.fn(),
  mockRecomputeSelectionPricing: vi.fn(),
  mockSnapshotSelectionQuotation: vi.fn(),
  mockSendVoiceQuotation: vi.fn(),
  mockSyncLeadBudgetFromSelection: vi.fn(),
  mockApplyLeadSelectionItinerary: vi.fn(),
  mockSerializeLeadDays: vi.fn(),
  mockBuildAutoCostLines: vi.fn(),
  mockValidateTransition: vi.fn(),
  mockGatekeeperInputs: vi.fn(),
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
      delete: mockSelectionDelete,
    },
    leadCostLine: { findMany: mockCostLineFindMany, create: mockCostLineCreate, deleteMany: mockCostLineDeleteMany, createMany: mockCostLineCreateMany },
    leadOptionalFlight: { findMany: mockOptionalFlightFindMany, findUnique: mockOptionalFlightFindUnique, create: mockOptionalFlightCreate, delete: mockOptionalFlightDelete },
    leadPricing: { update: mockPricingUpdate },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../services/lead-draft.service.js', () => ({ fetchPackage: mockFetchPackage }));

vi.mock('../../services/lead-selection.service.js', () => ({
  deriveSelectionView: mockDeriveSelectionView,
  toEditorDays: mockToEditorDays,
  isSelectionMaterialized: mockIsSelectionMaterialized,
  materializeSelection: mockMaterializeSelection,
  refreshSelection: mockRefreshSelection,
  recomputeSelectionPricing: mockRecomputeSelectionPricing,
  snapshotSelectionQuotation: mockSnapshotSelectionQuotation,
  sendVoiceQuotation: mockSendVoiceQuotation,
  syncLeadBudgetFromSelection: mockSyncLeadBudgetFromSelection,
}));

vi.mock('../../services/lead-itinerary.service.js', () => ({
  applyLeadSelectionItinerary: mockApplyLeadSelectionItinerary,
  serializeLeadDays: mockSerializeLeadDays,
  buildAutoCostLines: mockBuildAutoCostLines,
  EDIT_BLOCKED_STATUSES: ['QUOTED', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'BOOKING_FAILED', 'CLOSED_LOST', 'CANCELLED'],
}));

vi.mock('../../services/state-machine.service.js', () => ({ validateTransition: mockValidateTransition }));
vi.mock('../../services/gatekeeper.service.js', () => ({ gatekeeperInputs: mockGatekeeperInputs }));

import {
  listPackageSelections,
  createPackageSelection,
  updatePackageSelection,
  deletePackageSelection,
  refreshPackageSelection,
  quotePackageSelection,
  autoQuoteVoiceBooking,
  calculateSelectionPricing,
  addSelectionFlight,
  deleteSelectionFlight,
} from '../lead-package-selection.controller.js';

function buildReqRes({ leadId = 'lead-1', selectionId = 'sel-1', body = {}, user = { id: 'user-1' } } = {}) {
  const req = { params: { id: leadId, selectionId }, body, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

const resetAll = () => {
  for (const m of [
    mockLeadFindUnique, mockLeadUpdate, mockSelectionFindUnique, mockSelectionFindMany, mockSelectionFindFirst,
    mockSelectionCreate, mockSelectionUpdate, mockSelectionDelete, mockCostLineFindMany, mockOptionalFlightFindMany,
    mockOptionalFlightFindUnique, mockOptionalFlightCreate, mockOptionalFlightDelete, mockCostLineCreate,
    mockCostLineDeleteMany, mockCostLineCreateMany, mockPricingUpdate, mockTransaction, mockFetchPackage,
    mockDeriveSelectionView, mockToEditorDays, mockIsSelectionMaterialized, mockMaterializeSelection,
    mockRefreshSelection, mockRecomputeSelectionPricing, mockSnapshotSelectionQuotation, mockApplyLeadSelectionItinerary,
    mockSendVoiceQuotation,
    mockSerializeLeadDays, mockBuildAutoCostLines, mockValidateTransition, mockGatekeeperInputs,
  ]) m.mockReset();
  mockTransaction.mockImplementation(async (ops) => Promise.all(ops));
};

describe('listPackageSelections', () => {
  beforeEach(resetAll);

  it('404s when the lead does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes();
    await listPackageSelections(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
  });

  it('presents a materialized selection using serializeLeadDays, without deriving from package-service', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockSelectionFindMany.mockResolvedValue([
      { id: 'sel-1', isManual: false, packageId: 'pkg-1', pricing: { id: 'pr-1' }, itineraryDays: [{ dayNumber: 1 }], costLines: [] },
    ]);
    mockSerializeLeadDays.mockReturnValue([{ dayNumber: 1, serialized: true }]);

    const { req, res, next } = buildReqRes();
    await listPackageSelections(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDeriveSelectionView).not.toHaveBeenCalled();
    const [{ data }] = res.json.mock.calls[0];
    expect(data[0].isMaterialized).toBe(true);
    expect(data[0].itineraryDays).toEqual([{ dayNumber: 1, serialized: true }]);
  });

  it('derives a pristine selection from the live package instead', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockSelectionFindMany.mockResolvedValue([
      { id: 'sel-1', isManual: false, packageId: 'pkg-1', pricing: null, itineraryDays: [], costLines: [] },
    ]);
    mockDeriveSelectionView.mockResolvedValue({ packageName: 'Pkg', days: [{ nested: true }], costLines: [], pricing: { currency: 'USD' } });
    mockToEditorDays.mockReturnValue([{ dayNumber: 1, derived: true }]);

    const { req, res, next } = buildReqRes();
    await listPackageSelections(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [{ data }] = res.json.mock.calls[0];
    expect(data[0].isMaterialized).toBe(false);
    expect(data[0].itineraryDays).toEqual([{ dayNumber: 1, derived: true }]);
  });

  it('computes prospective totals for a pristine selection instead of returning bare margin settings', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockSelectionFindMany.mockResolvedValue([
      { id: 'sel-1', isManual: false, packageId: 'pkg-1', pricing: null, itineraryDays: [], costLines: [], lead: { numberOfTravelers: 2 } },
    ]);
    mockDeriveSelectionView.mockResolvedValue({
      packageName: 'Pkg',
      days: [],
      costLines: [
        { category: 'activity', description: 'Tour', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: 100, actualUnitPrice: null, marginType: null, marginValue: null, source: 'AUTO' },
      ],
      pricing: { currency: 'USD', marginType: null, marginValue: null },
    });
    mockToEditorDays.mockReturnValue([]);

    const { req, res, next } = buildReqRes();
    await listPackageSelections(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [{ data }] = res.json.mock.calls[0];
    // PER_PERSON line scales with the lead's 2 travelers: 100 * 2 = 200 sell
    // subtotal, plus the default 18% tax → 236 total.
    expect(data[0].pricing).toEqual(expect.objectContaining({ sellSubtotal: 200, taxAmount: 36, totalAmount: 236, currency: 'USD' }));
  });

  it('degrades gracefully when package-service is unreachable for one selection', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1' });
    mockSelectionFindMany.mockResolvedValue([
      { id: 'sel-1', isManual: false, packageId: 'pkg-1', pricing: null, itineraryDays: [], costLines: [] },
    ]);
    mockDeriveSelectionView.mockRejectedValue(new Error('network down'));

    const { req, res, next } = buildReqRes();
    await listPackageSelections(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [{ data }] = res.json.mock.calls[0];
    expect(data[0].derivationError).toBe(true);
    expect(data[0].isMaterialized).toBe(false);
  });
});

describe('createPackageSelection', () => {
  beforeEach(resetAll);

  it('rejects a second manual selection for the same lead', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: 'sel-0' });
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-existing', isManual: true });

    const { req, res, next } = buildReqRes({ body: { isManual: true } });
    await createPackageSelection(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/already has a manual/i) }));
    expect(mockSelectionCreate).not.toHaveBeenCalled();
  });

  it('rejects attaching the same packageId twice', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: 'sel-0' });
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-existing', packageId: 'pkg-1' });

    const { req, res, next } = buildReqRes({ body: { packageId: '11111111-1111-1111-1111-111111111111' } });
    await createPackageSelection(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/already attached/i) }));
  });

  it('creates a selection and sets it as primary when it is the lead\'s first', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: null });
    mockSelectionFindFirst.mockResolvedValue(null);
    mockFetchPackage.mockResolvedValue({ title: 'Sri Lanka Explorer' });
    mockSelectionCreate.mockResolvedValue({ id: 'sel-1', packageId: '11111111-1111-1111-1111-111111111111', isManual: false, packageName: 'Sri Lanka Explorer' });

    const { req, res, next } = buildReqRes({ body: { packageId: '11111111-1111-1111-1111-111111111111' } });
    await createPackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { primarySelectionId: 'sel-1' } });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not re-point primarySelectionId when the lead already has one', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: 'sel-existing' });
    mockSelectionFindFirst.mockResolvedValue(null);
    mockFetchPackage.mockResolvedValue({ title: 'Pkg B' });
    mockSelectionCreate.mockResolvedValue({ id: 'sel-2' });

    const { req, res, next } = buildReqRes({ body: { packageId: '22222222-2222-2222-2222-222222222222' } });
    await createPackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe('updatePackageSelection', () => {
  beforeEach(resetAll);

  it('sets destinationOverride on the owned selection', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', destinationOverride: 'Sigiriya, Sri Lanka' });

    const { req, res, next } = buildReqRes({ body: { destinationOverride: 'Sigiriya, Sri Lanka' } });
    await updatePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSelectionUpdate).toHaveBeenCalledWith({
      where: { id: 'sel-1' },
      data: { destinationOverride: 'Sigiriya, Sri Lanka' },
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'sel-1', leadId: 'lead-1', destinationOverride: 'Sigiriya, Sri Lanka' },
    });
  });

  it('clears destinationOverride when sent as null', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', destinationOverride: null });

    const { req, res, next } = buildReqRes({ body: { destinationOverride: null } });
    await updatePackageSelection(req, res, next);

    expect(mockSelectionUpdate).toHaveBeenCalledWith({ where: { id: 'sel-1' }, data: { destinationOverride: null } });
  });

  it('rejects a selection belonging to a different lead', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'other-lead' });

    const { req, res, next } = buildReqRes({ body: { destinationOverride: 'Bali' } });
    await updatePackageSelection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockSelectionUpdate).not.toHaveBeenCalled();
  });

  it('rejects an empty-string destinationOverride', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });

    const { req, res, next } = buildReqRes({ body: { destinationOverride: '' } });
    await updatePackageSelection(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockSelectionUpdate).not.toHaveBeenCalled();
  });
});

describe('deletePackageSelection', () => {
  beforeEach(resetAll);

  it('re-points primarySelectionId to the next remaining selection when the primary is deleted', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: 'sel-1' });
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-2' });

    const { req, res, next } = buildReqRes();
    await deletePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSelectionDelete).toHaveBeenCalledWith({ where: { id: 'sel-1' } });
    expect(mockLeadUpdate).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { primarySelectionId: 'sel-2' } });
  });

  it('leaves primarySelectionId untouched when a non-primary selection is deleted', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-2', leadId: 'lead-1' });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', primarySelectionId: 'sel-1' });

    const { req, res, next } = buildReqRes({ selectionId: 'sel-2' });
    await deletePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe('refreshPackageSelection', () => {
  beforeEach(resetAll);

  it('blocks refresh while the lead itinerary is locked (e.g. QUOTED)', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'QUOTED' });
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });

    const { req, res, next } = buildReqRes();
    await refreshPackageSelection(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/locked after QUOTED/i) }));
    expect(mockRefreshSelection).not.toHaveBeenCalled();
  });

  it('delegates to refreshSelection with force from the body', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'DRAFTING' });
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockRefreshSelection.mockResolvedValue({ id: 'sel-1' });

    const { req, res, next } = buildReqRes({ body: { force: true } });
    await refreshPackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockRefreshSelection).toHaveBeenCalledWith({ selectionId: 'sel-1', force: true });
  });
});

describe('quotePackageSelection', () => {
  beforeEach(resetAll);

  it('moves the lead to QUOTED on its first quote and points primarySelectionId at the selection', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'DRAFTING' });
    mockIsSelectionMaterialized.mockResolvedValue(true);
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pricing: { sellSubtotal: 500 }, costLines: [], itineraryDays: [] });
    mockGatekeeperInputs.mockReturnValue({ sellSubtotal: 500 });
    mockSnapshotSelectionQuotation.mockResolvedValue({ id: 'quote-1' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', currentQuoteId: 'quote-1' });
    mockLeadUpdate.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'QUOTED' });

    const { req, res, next } = buildReqRes();
    await quotePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockValidateTransition).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'DRAFTING', nextStatus: 'QUOTED' }));
    expect(mockSnapshotSelectionQuotation).toHaveBeenCalledWith('sel-1', { createdById: 'user-1' });
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ primarySelectionId: 'sel-1', lifecycleStatus: 'QUOTED' }),
    }));
  });

  it('quoting a second package on an already-QUOTED lead does not re-trigger the status history entry', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'QUOTED' });
    mockIsSelectionMaterialized.mockResolvedValue(true);
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-2', leadId: 'lead-1', pricing: { sellSubtotal: 300 }, costLines: [], itineraryDays: [] });
    mockGatekeeperInputs.mockReturnValue({ sellSubtotal: 300 });
    mockSnapshotSelectionQuotation.mockResolvedValue({ id: 'quote-2' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-2', currentQuoteId: 'quote-2' });
    mockLeadUpdate.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'QUOTED' });

    const { req, res, next } = buildReqRes({ selectionId: 'sel-2' });
    await quotePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [{ data }] = mockLeadUpdate.mock.calls[0];
    expect(data.lifecycleStatus).toBeUndefined();
    expect(data.statusHistory).toBeUndefined();
    expect(data.primarySelectionId).toBe('sel-2');
  });

  it('materializes a pristine selection, recomputes pricing, then auto-promotes a NEW lead through DRAFTING to QUOTED', async () => {
    // Pristine selection: nothing persisted, yet the UI showed a real subtotal
    // (a computed preview). The gatekeeper must see the materialized numbers,
    // not a 0-sellSubtotal bare row.
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'NEW' });
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pricing: null, costLines: [], itineraryDays: [] });
    mockIsSelectionMaterialized.mockResolvedValue(false);
    mockMaterializeSelection.mockResolvedValue({ id: 'sel-1' });
    mockRecomputeSelectionPricing.mockResolvedValue({ id: 'sel-1', sellSubtotal: 500 });
    mockGatekeeperInputs.mockReturnValue({ sellSubtotal: 500 });
    mockSnapshotSelectionQuotation.mockResolvedValue({ id: 'quote-1' });
    mockSelectionUpdate.mockResolvedValue({ id: 'sel-1', currentQuoteId: 'quote-1' });
    mockLeadUpdate.mockResolvedValue({ id: 'lead-1', lifecycleStatus: 'QUOTED' });

    const { req, res, next } = buildReqRes();
    await quotePackageSelection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockIsSelectionMaterialized).toHaveBeenCalledWith('sel-1');
    expect(mockMaterializeSelection).toHaveBeenCalledWith(expect.objectContaining({ selectionId: 'sel-1' }));
    expect(mockRecomputeSelectionPricing).toHaveBeenCalledWith('sel-1');
    expect(mockValidateTransition).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'NEW', nextStatus: 'DRAFTING' }));
    expect(mockValidateTransition).toHaveBeenCalledWith(expect.objectContaining({ currentStatus: 'DRAFTING', nextStatus: 'QUOTED' }));
    const [{ data }] = mockLeadUpdate.mock.calls[0];
    expect(data.lifecycleStatus).toBe('QUOTED');
    expect(data.statusHistory.create).toEqual([
      expect.objectContaining({ status: 'DRAFTING' }),
      expect.objectContaining({ status: 'QUOTED' }),
    ]);
  });
});

describe('autoQuoteVoiceBooking', () => {
  beforeEach(resetAll);

  const body = {
    leadId: 'lead-1',
    bookingId: 'booking-1',
    packageId: 'pkg-1',
    searchPriceSnapshot: 1200,
  };

  function eligibleVoiceLead(overrides = {}) {
    return {
      id: 'lead-1',
      convertedBookingId: 'booking-1',
      lifecycleStatus: 'PENDING_VERIFICATION',
      voiceExactPackageMatch: true,
      voiceCustomerIdentityConfirmed: true,
      voiceAiBookingAllowed: true,
      voicePriceChanged: false,
      voiceNeedsRepReview: false,
      ...overrides,
    };
  }

  it('creates and sends an exact-price quotation, recording valid system transitions', async () => {
    mockLeadFindUnique.mockResolvedValue(eligibleVoiceLead());
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-1', currentQuoteId: null, pendingAiChange: null });
    mockFetchPackage.mockResolvedValue({ isActive: true, sellPrice: 1200 });
    mockIsSelectionMaterialized.mockResolvedValue(true);
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pricing: {}, costLines: [] });
    mockGatekeeperInputs.mockReturnValue({ sellSubtotal: 1200 });
    mockSnapshotSelectionQuotation.mockResolvedValue({ id: 'quote-1', subtotal: 1200, totalAmount: 1416 });
    mockSendVoiceQuotation.mockResolvedValue({ allSent: true, email: 'sent', whatsapp: 'sent' });

    const { req, res, next } = buildReqRes({ body });
    await autoQuoteVoiceBooking(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSnapshotSelectionQuotation).toHaveBeenCalledWith('sel-1');
    expect(mockSendVoiceQuotation).toHaveBeenCalledWith('quote-1', {
      leadId: 'lead-1', packageId: 'pkg-1', expectedPackagePrice: 1200,
    }, undefined);
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({
        lifecycleStatus: 'QUOTED',
        needsRepFollowup: false,
        statusHistory: { create: [
          expect.objectContaining({ status: 'NEW', actor: 'SYSTEM' }),
          expect.objectContaining({ status: 'DRAFTING', actor: 'SYSTEM' }),
          expect.objectContaining({ status: 'QUOTED', actor: 'SYSTEM' }),
        ] },
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ issued: true }),
    }));
  });

  it('flags a package-price change for rep review without creating a quotation', async () => {
    mockLeadFindUnique.mockResolvedValue(eligibleVoiceLead());
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-1', currentQuoteId: null, pendingAiChange: null });
    mockFetchPackage.mockResolvedValue({ isActive: true, sellPrice: 1201 });

    const { req, res, next } = buildReqRes({ body });
    await autoQuoteVoiceBooking(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSnapshotSelectionQuotation).not.toHaveBeenCalled();
    expect(mockSendVoiceQuotation).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        needsRepFollowup: true,
        voiceNeedsRepReview: true,
        voiceReviewReason: 'package_price_changed_since_search',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ issued: false, needsRepFollowup: true }),
    }));
  });

  it('flags the lead for rep follow-up when either quote channel fails', async () => {
    mockLeadFindUnique.mockResolvedValue(eligibleVoiceLead());
    mockSelectionFindFirst.mockResolvedValue({ id: 'sel-1', currentQuoteId: null, pendingAiChange: null });
    mockFetchPackage.mockResolvedValue({ isActive: true, sellPrice: 1200 });
    mockIsSelectionMaterialized.mockResolvedValue(true);
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', pricing: {}, costLines: [] });
    mockGatekeeperInputs.mockReturnValue({ sellSubtotal: 1200 });
    mockSnapshotSelectionQuotation.mockResolvedValue({ id: 'quote-1', subtotal: 1200, totalAmount: 1416 });
    mockSendVoiceQuotation.mockResolvedValue({ allSent: false, email: 'sent', whatsapp: 'failed' });

    const { req, res, next } = buildReqRes({ body });
    await autoQuoteVoiceBooking(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        needsRepFollowup: true,
        voiceNeedsRepReview: true,
        voiceReviewReason: 'auto_quote_delivery_failed',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ issued: false, needsRepFollowup: true }),
    }));
  });
});

describe('calculateSelectionPricing', () => {
  beforeEach(resetAll);

  it('merges persisted MANUAL lines with days-derived AUTO lines, scoped to this selection', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockBuildAutoCostLines.mockReturnValue([{ category: 'food', basis: 'PER_PERSON', estimatedUnit: 60, quantity: 1, description: 'Meals', source: 'AUTO' }]);
    mockCostLineFindMany.mockResolvedValue([]);

    const { req, res, next } = buildReqRes({ body: { days: [{ dayNumber: 1 }], travelers: 2 } });
    await calculateSelectionPricing(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCostLineFindMany).toHaveBeenCalledWith({
      where: { leadPackageSelectionId: 'sel-1', source: 'MANUAL' },
      orderBy: { orderIndex: 'asc' },
    });
  });

  it('rejects a body with neither lines nor days', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    const { req, res, next } = buildReqRes({ body: { travelers: 2 } });
    await calculateSelectionPricing(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/lines or days/i) }));
  });

  it('previews a flat cost line from basePrice when there are no auto or manual lines to derive from', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', packageId: 'pkg-1' });
    mockBuildAutoCostLines.mockReturnValue([]);
    mockCostLineFindMany.mockResolvedValue([]);
    mockFetchPackage.mockResolvedValue({ id: 'pkg-1', title: 'Weekend Getaway', basePrice: 500 });

    const { req, res, next } = buildReqRes({ body: { days: [], travelers: 1 } });
    await calculateSelectionPricing(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [{ data }] = res.json.mock.calls[0];
    expect(data.financials.sellSubtotal).toBe(500);
  });

  it('does not fetch the package when auto or manual lines already exist', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1', packageId: 'pkg-1' });
    mockBuildAutoCostLines.mockReturnValue([
      { category: 'food', description: 'Meals', basis: 'PER_PERSON', quantity: 1, estimatedUnitPrice: 60, actualUnitPrice: null, marginType: null, marginValue: null, source: 'AUTO' },
    ]);
    mockCostLineFindMany.mockResolvedValue([]);

    const { req, res, next } = buildReqRes({ body: { days: [{ dayNumber: 1 }], travelers: 1 } });
    await calculateSelectionPricing(req, res, next);

    expect(mockFetchPackage).not.toHaveBeenCalled();
  });
});

describe('addSelectionFlight', () => {
  beforeEach(resetAll);

  it('materializes a still-pristine selection before recomputing pricing', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', numberOfTravelers: 2 });
    mockSelectionFindUnique.mockResolvedValueOnce({ id: 'sel-1', leadId: 'lead-1' }); // ownership check
    mockIsSelectionMaterialized.mockResolvedValue(false);
    mockMaterializeSelection.mockResolvedValue({});
    mockSelectionFindUnique.mockResolvedValueOnce({ id: 'sel-1', costLines: [] }); // post-materialize reload
    mockOptionalFlightCreate.mockResolvedValue({ id: 'flight-1' });
    mockCostLineCreate.mockResolvedValue({});
    mockRecomputeSelectionPricing.mockResolvedValue({});

    const { req, res, next } = buildReqRes({ body: { flightType: 'TO_START', origin: 'CMB', destination: 'DXB' } });
    await addSelectionFlight(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockMaterializeSelection).toHaveBeenCalledWith({ selectionId: 'sel-1' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('skips materialization when already materialized', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', numberOfTravelers: 1 });
    mockSelectionFindUnique.mockResolvedValueOnce({ id: 'sel-1', leadId: 'lead-1' });
    mockIsSelectionMaterialized.mockResolvedValue(true);
    mockSelectionFindUnique.mockResolvedValueOnce({ id: 'sel-1', costLines: [] });
    mockOptionalFlightCreate.mockResolvedValue({ id: 'flight-1' });
    mockCostLineCreate.mockResolvedValue({});
    mockRecomputeSelectionPricing.mockResolvedValue({});

    const { req, res, next } = buildReqRes({ body: { flightType: 'RETURN_HOME' } });
    await addSelectionFlight(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockMaterializeSelection).not.toHaveBeenCalled();
  });
});

describe('deleteSelectionFlight', () => {
  beforeEach(resetAll);

  it('404s when the flight does not belong to this selection', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockOptionalFlightFindUnique.mockResolvedValue({ id: 'flight-1', leadPackageSelectionId: 'sel-other' });

    const { req, res, next } = buildReqRes();
    req.params.flightId = 'flight-1';
    await deleteSelectionFlight(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/not found/i) }));
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('removes the linked cost line and the flight, then recomputes pricing', async () => {
    mockSelectionFindUnique.mockResolvedValue({ id: 'sel-1', leadId: 'lead-1' });
    mockOptionalFlightFindUnique.mockResolvedValue({ id: 'flight-1', leadPackageSelectionId: 'sel-1' });
    mockRecomputeSelectionPricing.mockResolvedValue({});

    const { req, res, next } = buildReqRes();
    req.params.flightId = 'flight-1';
    await deleteSelectionFlight(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockRecomputeSelectionPricing).toHaveBeenCalledWith('sel-1');
  });
});

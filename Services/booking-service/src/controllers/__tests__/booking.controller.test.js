import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockQueryRaw, mockExecuteRaw, mockBookingCreate, mockSendLeadAssignmentEmail,
  mockTransaction, mockTxQueryRaw, mockTxExecuteRaw, mockBookingFindUnique,
} = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockExecuteRaw: vi.fn(),
  mockBookingCreate: vi.fn(),
  mockSendLeadAssignmentEmail: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxQueryRaw: vi.fn(),
  mockTxExecuteRaw: vi.fn(),
  mockBookingFindUnique: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
    $transaction: (...args) => mockTransaction(...args),
    booking: { create: mockBookingCreate, findUnique: mockBookingFindUnique },
  },
}));

vi.mock('../../utils/email.js', () => ({
  sendLeadAssignmentEmail: mockSendLeadAssignmentEmail,
}));

const { createWebsiteBooking, createVoiceBooking } = await import('../booking.controller.js');

function buildReqRes(body) {
  const req = { body, log: { warn: vi.fn(), error: vi.fn() } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { req, res };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('createWebsiteBooking — lead assignment email', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // $queryRaw call order: findPackageById, findUserByEmail, autoAssignSalesRep (settings), findSalesRepEmail
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 'pkg-1', name: 'Bali Getaway', destination: 'Bali', price: 1500, isActive: true }])
      .mockResolvedValueOnce([{ id: 'user-1', name: 'Jane Doe', email: 'jane@test.com', phone: '5550100' }])
      .mockResolvedValueOnce([{ id: 'settings-1', enabledSalesRepIds: ['rep-1'], roundRobinIndex: 0, autoStrategy: 'round_robin', assignmentMode: 'auto' }])
      .mockResolvedValueOnce([{ name: 'Sam Rep', email: 'sam@test.com' }]);

    // $executeRaw call order: round-robin update, lead insert, status-history insert, package-bookings increment
    mockExecuteRaw.mockResolvedValue(undefined);

    mockBookingCreate.mockResolvedValue({ id: 'booking-1' });
  });

  it('still returns 201 when the lead-assignment email fails to send', async () => {
    mockSendLeadAssignmentEmail.mockRejectedValue(new Error('SMTP down'));

    const { req, res } = buildReqRes({
      name: 'Jane Doe', email: 'jane@test.com', phone: '+1-555-010-0100',
      travelers: 2, travelDate: '2026-12-01', packageId: 'pkg-1',
    });

    await createWebsiteBooking(req, res, vi.fn());
    await flush();

    expect(res.status).toHaveBeenCalledWith(201);
    expect(req.log.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Failed to send assignment email');
  });

  it('passes the lead\'s phone and destination through to the assignment email', async () => {
    mockSendLeadAssignmentEmail.mockResolvedValue({ success: true });

    const { req, res } = buildReqRes({
      name: 'Jane Doe', email: 'jane@test.com', phone: '+1-555-010-0100',
      travelers: 2, travelDate: '2026-12-01', packageId: 'pkg-1',
    });

    await createWebsiteBooking(req, res, vi.fn());
    await flush();

    expect(mockSendLeadAssignmentEmail).toHaveBeenCalledWith(expect.objectContaining({
      lead: expect.objectContaining({ phone: '15550100100', destination: 'Bali' }),
    }));
  });
});

describe('createVoiceBooking — exact package booking gates', () => {
  const body = {
    conversationId: 'conv-1',
    packageId: '11111111-1111-4111-8111-111111111111',
    searchPriceSnapshot: 1000,
    bookingConfirmed: true,
    name: 'Jane Doe',
    email: 'jane@example.com',
    travelDate: '2026-12-01',
    travelers: 2,
  };
  const packageRow = {
    id: body.packageId,
    title: 'Bali Getaway',
    destination: 'Bali',
    basePrice: 1000,
    defaultMarginType: 'FIXED',
    defaultMarginInput: 0,
    isActive: true,
    durationDays: 8,
  };

  beforeEach(() => {
    mockTxQueryRaw.mockReset();
    mockTxExecuteRaw.mockReset().mockResolvedValue(undefined);
    mockBookingCreate.mockReset();
    mockBookingFindUnique.mockReset();
    mockTransaction.mockImplementation((callback) => callback({
      $queryRaw: (...args) => mockTxQueryRaw(...args),
      $executeRaw: (...args) => mockTxExecuteRaw(...args),
      booking: {
        create: (...args) => mockBookingCreate(...args),
        findUnique: (...args) => mockBookingFindUnique(...args),
      },
    }));
  });

  it('rejects booking when explicit caller consent is missing', async () => {
    const { req, res } = buildReqRes({ ...body, bookingConfirmed: false });
    const next = vi.fn();
    await createVoiceBooking(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('returns the existing booking on a retry instead of creating a duplicate', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: 'lead-1', disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{
        id: 'lead-1', primarySelectionId: 'selection-1', convertedBookingId: 'booking-existing',
        lifecycleStatus: 'NEW', voiceNeedsRepReview: false, voicePriceChanged: false,
      }]);
    mockBookingFindUnique.mockResolvedValue({
      packageId: body.packageId,
      travelDate: new Date('2026-12-01T00:00:00.000Z'),
      numberOfTravelers: 2,
    });
    const { req, res } = buildReqRes(body);
    const next = vi.fn();
    await createVoiceBooking(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: 'booking-existing', alreadyCreated: true }),
    }));
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it('creates a pending booking and marks identity only after all required details are valid', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: null, disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{ id: 'user-1', name: 'Jane Doe', email: 'jane@example.com', phone: '15550100100' }]);
    mockBookingCreate.mockResolvedValue({ id: 'booking-new' });
    const { req, res } = buildReqRes(body);
    const next = vi.fn();
    await createVoiceBooking(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mockBookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1', packageId: body.packageId, numberOfTravelers: 2,
        paymentStatus: 'pending', bookingStatus: 'pending',
      }),
    }));
    expect(mockTxExecuteRaw).toHaveBeenCalledTimes(7);
    expect(mockTxExecuteRaw.mock.calls.some(([parts]) => parts.join('').includes('LeadStatusHistory'))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ bookingId: 'booking-new', bookingStatus: 'pending' });
  });

  it('flags a changed primary package for rep review without creating a booking', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: 'lead-1', disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{
        id: 'lead-1', primarySelectionId: 'selection-1', convertedBookingId: null,
        lifecycleStatus: 'NEW', voiceNeedsRepReview: false, voicePriceChanged: false,
      }])
      .mockResolvedValueOnce([{ id: 'selection-1', packageId: '22222222-2222-4222-8222-222222222222' }]);
    const { req, res } = buildReqRes(body);
    const next = vi.fn();
    await createVoiceBooking(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ reviewRequired: true, bookingId: null });
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it('flags a catalog price change since search for rep review without creating a booking', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: null, disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([{ ...packageRow, basePrice: 1100 }]);
    const { req, res } = buildReqRes(body);
    await createVoiceBooking(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      reviewRequired: true, reason: 'package_price_changed_since_search',
    });
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it('does not treat a different package retry as the already-created booking', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: 'lead-1', disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{
        id: 'lead-1', primarySelectionId: 'selection-1', convertedBookingId: 'booking-existing',
        lifecycleStatus: 'NEW', voiceNeedsRepReview: false, voicePriceChanged: false,
      }]);
    mockBookingFindUnique.mockResolvedValue({
      packageId: '22222222-2222-4222-8222-222222222222',
      travelDate: new Date('2026-12-01T00:00:00.000Z'),
      numberOfTravelers: 2,
    });
    const { req, res } = buildReqRes(body);
    await createVoiceBooking(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].data.reason).toBe('booking_request_conflicts_with_existing');
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it('routes a changed caller identity on a booking retry to rep review', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: 'lead-1', disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{
        id: 'lead-1', name: 'Another Customer', email: 'other@example.com', primarySelectionId: 'selection-1',
        convertedBookingId: 'booking-existing', lifecycleStatus: 'NEW', voiceNeedsRepReview: false, voicePriceChanged: false,
      }]);
    const { req, res } = buildReqRes(body);
    await createVoiceBooking(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].data.reason).toBe('customer_identity_changed_requires_review');
    expect(mockBookingFindUnique).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it('routes changed travel details on a quoted lead to rep review', async () => {
    mockTxQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'vc-1', fromNumber: '+1-555-010-0100', leadId: 'lead-1', disposition: 'IN_PROGRESS' }])
      .mockResolvedValueOnce([packageRow])
      .mockResolvedValueOnce([{
        id: 'lead-1', name: 'Jane Doe', email: 'jane@example.com', primarySelectionId: 'selection-1',
        convertedBookingId: null, lifecycleStatus: 'QUOTED', travelDate: new Date('2026-12-02T00:00:00.000Z'),
        endDate: null, numberOfTravelers: 2, voiceNeedsRepReview: false, voicePriceChanged: false,
      }]);
    const { req, res } = buildReqRes(body);
    await createVoiceBooking(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].data.reason).toBe('booking_details_changed_requires_review');
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });
});

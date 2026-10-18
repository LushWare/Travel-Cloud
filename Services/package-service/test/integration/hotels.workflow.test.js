import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { buildSearchRequest, buildBookingRequest, buildGuest } from '../factories/hotel.js';

// Force mock mode — no real API calls
beforeAll(() => {
  delete process.env.LITEAPI_API_KEY;
  process.env.LITEAPI_MOCK_MODE = 'true';
});

const { default: app } = await import('../../src/app.js');

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    hotelBooking: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma }));

const prisma = mockPrisma;

function auth(overrides = {}) {
  return {
    'x-user-id': overrides.id || 'agent-1',
    'x-user-role': overrides.role || 'admin',
    'x-user-permissions': '[]',
    'x-user-is-super-admin': String(overrides.isSuperAdmin ?? false),
  };
}

function makeBooking(overrides = {}) {
  const checkin = new Date();
  checkin.setDate(checkin.getDate() + 30);
  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + 2);
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    liteapiBookingId: 'MOCK-BOOK-ABC123',
    hotelId: 'MOCK-HOTEL-1',
    hotelName: 'Grand Hyatt',
    hotelAddress: '100 Main Street, City Center',
    hotelImage: null,
    checkin,
    checkout,
    currency: 'USD',
    totalAmount: 250,
    status: 'confirmed',
    createdById: 'agent-1',
    customerId: null,
    guestInfo: [{ firstName: 'John', lastName: 'Doe', title: 'Mr' }],
    roomDetails: { roomType: 'Deluxe King', boardType: 'Bed & Breakfast' },
    searchSnapshot: {},
    cancellationReason: null,
    cancelledAt: null,
    leadId: null,
    packageId: null,
    customizedPackageId: null,
    dayNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Hotel Booking — Complete Workflow', () => {
  beforeEach(() => vi.clearAllMocks());

  const fullFlow = 'should complete the full booking lifecycle: search → details → prebook → book → verify → list → cancel';

  it(fullFlow, async () => {
    // ── 1. Search ──────────────────────────────────────────────────────
    const searchRes = await request(app)
      .post('/api/v1/hotels/search')
      .set(auth())
      .send(buildSearchRequest());

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.success).toBe(true);
    expect(searchRes.body.data.length).toBeGreaterThan(0);
    expect(searchRes.body.data[0]).toHaveProperty('hotelId');
    expect(searchRes.body.data[0].cheapestRate).toHaveProperty('offerId');

    const { hotelId } = searchRes.body.data[0];
    const { offerId } = searchRes.body.data[0].cheapestRate;

    // ── 2. Details ─────────────────────────────────────────────────────
    const detailsRes = await request(app)
      .post('/api/v1/hotels/details')
      .set(auth())
      .send({ hotelId });

    expect(detailsRes.status).toBe(200);
    expect(detailsRes.body.success).toBe(true);
    expect(detailsRes.body.data.hotelId).toBe(hotelId);

    // ── 3. Prebook ─────────────────────────────────────────────────────
    const prebookRes = await request(app)
      .post('/api/v1/hotels/prebook')
      .set(auth())
      .send({ offerId });

    expect(prebookRes.status).toBe(200);
    expect(prebookRes.body.success).toBe(true);
    expect(prebookRes.body.data.prebookId).toMatch(/^MOCK-PREBOOK-/);
    expect(prebookRes.body.data.status).toBe('valid');

    const { prebookId } = prebookRes.body.data;

    // ── 4. Book ────────────────────────────────────────────────────────
    const bookingRecord = makeBooking();
    prisma.hotelBooking.create.mockResolvedValue(bookingRecord);

    const payload = buildBookingRequest({ prebookId, offer: searchRes.body.data[0] });
    const bookRes = await request(app)
      .post('/api/v1/hotels/book')
      .set(auth())
      .send(payload);

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.success).toBe(true);
    expect(bookRes.body.data.status).toBe('confirmed');
    expect(bookRes.body.data.hotelId).toBeDefined();

    const bookingId = bookRes.body.data.id;

    // Verify prisma.create called with correct shape
    expect(prisma.hotelBooking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          liteapiBookingId: expect.any(String),
          status: 'confirmed',
          hotelId: expect.any(String),
          createdById: 'agent-1',
        }),
      }),
    );

    // ── 5. Get booking by ID ──────────────────────────────────────────
    prisma.hotelBooking.findFirst.mockResolvedValue(bookingRecord);

    const getRes = await request(app)
      .get(`/api/v1/hotels/bookings/${bookingId}`)
      .set(auth());

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(bookingId);
    expect(getRes.body.data.status).toBe('confirmed');

    // ── 6. List bookings ──────────────────────────────────────────────
    prisma.hotelBooking.findMany.mockResolvedValue([bookingRecord]);

    const listRes = await request(app)
      .get('/api/v1/hotels/bookings')
      .set(auth());

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.data[0].id).toBe(bookingId);

    // ── 7. Cancel ─────────────────────────────────────────────────────
    const cancelledRecord = { ...bookingRecord, status: 'cancelled', cancelledAt: new Date() };
    prisma.hotelBooking.findFirst.mockResolvedValue({ ...bookingRecord, status: 'confirmed' });
    prisma.hotelBooking.update.mockResolvedValue(cancelledRecord);

    const cancelRes = await request(app)
      .post(`/api/v1/hotels/bookings/${bookingId}/cancel`)
      .set(auth())
      .send({ reason: 'workflow test cancellation' });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.success).toBe(true);
    expect(cancelRes.body.data.status).toBe('cancelled');

    // ── 8. Verify cancellation persisted ───────────────────────────────
    prisma.hotelBooking.findFirst.mockResolvedValue(cancelledRecord);

    const verifyRes = await request(app)
      .get(`/api/v1/hotels/bookings/${bookingId}`)
      .set(auth());

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.status).toBe('cancelled');
  });
});

describe('Hotel Booking — Error paths across workflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return 400 when prebook has no offerId', async () => {
    const res = await request(app)
      .post('/api/v1/hotels/prebook')
      .set(auth())
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 when cancelling an already-cancelled booking', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    prisma.hotelBooking.findFirst.mockResolvedValue({ id: uuid, status: 'cancelled', liteapiBookingId: null });

    const res = await request(app)
      .post(`/api/v1/hotels/bookings/${uuid}/cancel`)
      .set(auth())
      .send({ reason: 'test' });

    expect(res.status).toBe(400);
  });

  it('should return 404 when cancelling non-existent booking', async () => {
    const uuid = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
    prisma.hotelBooking.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/v1/hotels/bookings/${uuid}/cancel`)
      .set(auth())
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('Hotel Booking — bookWithContext workflow', () => {
  beforeEach(() => vi.clearAllMocks());

  const leadId = 'c3d4e5f6-a7b8-4012-8def-123456789012';

  it('should create a booking linked to a lead', async () => {
    const bookingRecord = makeBooking({ leadId, dayNumber: 3 });
    prisma.hotelBooking.create.mockResolvedValue(bookingRecord);

    const res = await request(app)
      .post('/api/v1/hotels/book-with-context')
      .set(auth())
      .send({
        prebookId: 'mock-prebook',
        guests: [buildGuest()],
        contact: { email: 'agent@test.com', phone: '+15555550100' },
        offer: { hotelId: 'MOCK-HOTEL-1', name: 'Grand Hyatt' },
        leadId,
        dayNumber: 3,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.leadId).toBe(leadId);
    expect(res.body.data.dayNumber).toBe(3);
  });

  it('should retrieve bookings by leadId', async () => {
    const booking1 = makeBooking({ id: '11111111-1111-4111-8111-111111111111', leadId, dayNumber: 1 });
    const booking2 = makeBooking({ id: '22222222-2222-4222-8222-222222222222', leadId, dayNumber: 2 });
    prisma.hotelBooking.findMany.mockResolvedValue([booking1, booking2]);

    const res = await request(app)
      .get(`/api/v1/hotels/bookings/by-lead/${leadId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].leadId).toBe(leadId);
  });

  it('should return empty array for lead with no bookings', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get(`/api/v1/hotels/bookings/by-lead/${leadId}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('should reject invalid leadId UUID', async () => {
    const res = await request(app)
      .get('/api/v1/hotels/bookings/by-lead/not-a-uuid')
      .set(auth());
    expect(res.status).toBe(400);
  });
});

describe('Hotel Booking — Role-based access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should scope listBookings by createdById for salesRep', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/hotels/bookings')
      .set(auth({ role: 'salesRep', id: 'rep-99' }));

    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdById: 'rep-99' }),
      }),
    );
  });

  it('should NOT scope listBookings for admin', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/hotels/bookings')
      .set(auth({ role: 'admin', id: 'admin-1' }));

    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ createdById: expect.any(String) }),
      }),
    );
  });

  it('should scope getByLead by createdById for salesRep', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    const lid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    await request(app)
      .get(`/api/v1/hotels/bookings/by-lead/${lid}`)
      .set(auth({ role: 'salesRep', id: 'rep-42' }));

    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: lid, createdById: 'rep-42' },
      }),
    );
  });
});

describe('Hotel Booking — Status filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return all bookings without filter', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    await request(app).get('/api/v1/hotels/bookings').set(auth());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('should filter by status=confirmed', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    await request(app).get('/api/v1/hotels/bookings?status=confirmed').set(auth());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'confirmed' } }),
    );
  });

  it('should filter by status=cancelled', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    await request(app).get('/api/v1/hotels/bookings?status=cancelled').set(auth());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'cancelled' } }),
    );
  });

  it('should reject invalid status value', async () => {
    const res = await request(app).get('/api/v1/hotels/bookings?status=invalid').set(auth());
    expect(res.status).toBe(400);
  });
});

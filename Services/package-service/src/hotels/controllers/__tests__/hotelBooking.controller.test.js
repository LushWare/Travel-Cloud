import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockHotelClient } from '../../clients/mock.client.js';
import { buildHotelOffer, buildHotelOffers, buildSearchRequest, buildBookingRequest, buildGuest } from '../../../../test/factories/hotel.js';

// ── Mock prisma ──────────────────────────────────────────────────────
vi.mock('../../../db/client.js', () => ({
  default: {
    hotelBooking: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const { search, getDetails, prebook, book, listBookings, getBooking, cancelBooking } = await import('../hotelBooking.controller.js');
const prisma = (await import('../../../db/client.js')).default;

function mockReq(overrides = {}) {
  return {
    user: { id: 'agent-1', role: 'admin', isSuperAdmin: false },
    body: {}, params: {}, query: {},
    log: mockLogger,
    _hotelClient: new MockHotelClient(),
    ...overrides,
  };
}
function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should return hotel offers', async () => {
    const req = mockReq({ body: buildSearchRequest() });
    const res = mockRes();
    await search(req, res, vi.fn());
    expect(res.json).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.length).toBeGreaterThan(0);
  });
});

describe('getDetails', () => {
  it('should return hotel details by body hotelId', async () => {
    const req = mockReq({ body: { hotelId: 'MOCK-HOTEL-1' } });
    const res = mockRes();
    await getDetails(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('should also accept hotelId from query params', async () => {
    const req = mockReq({ body: {}, query: { hotelId: 'MOCK-HOTEL-2' } });
    const res = mockRes();
    await getDetails(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});

describe('prebook', () => {
  it('should return prebook result', async () => {
    const req = mockReq({ body: { offerId: 'offer-1' } });
    const res = mockRes();
    await prebook(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data).toHaveProperty('prebookId');
  });
});

describe('book', () => {
  it('should create a booking via mock client and persist to DB', async () => {
    prisma.hotelBooking.create.mockResolvedValue({
      id: 'booking-1', liteapiBookingId: 'mock-booking', hotelName: 'Test Hotel',
      status: 'confirmed', totalAmount: 200, currency: 'USD',
    });
    const req = mockReq({ body: buildBookingRequest() });
    const res = mockRes();
    await book(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.status).toBe('confirmed');
  });
});

describe('listBookings', () => {
  it('should return bookings for admin', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([{ id: 'b1', hotelName: 'Test', status: 'confirmed' }]);
    const req = mockReq({ user: { id: 'a', role: 'admin', isSuperAdmin: false } });
    const res = mockRes();
    await listBookings(req, res, vi.fn());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  it('should scope to sales rep', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    const req = mockReq({ user: { id: 'rep-5', role: 'salesRep', isSuperAdmin: false } });
    const res = mockRes();
    await listBookings(req, res, vi.fn());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { createdById: 'rep-5' } }));
  });

  it('should not scope superAdmin', async () => {
    prisma.hotelBooking.findMany.mockResolvedValue([]);
    const req = mockReq({ user: { id: 'sa', role: 'salesRep', isSuperAdmin: true } });
    await listBookings(req, mockRes(), vi.fn());
    expect(prisma.hotelBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('getBooking', () => {
  it('should return a booking', async () => {
    prisma.hotelBooking.findFirst.mockResolvedValue({ id: 'b1', hotelName: 'H', status: 'confirmed' });
    const req = mockReq({ params: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
    const res = mockRes();
    await getBooking(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].data.id).toBe('b1');
  });

  it('should return 404 when not found', async () => {
    prisma.hotelBooking.findFirst.mockResolvedValue(null);
    const req = mockReq({ params: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
    const next = vi.fn();
    await getBooking(req, mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

describe('cancelBooking', () => {
  it('should cancel a booking', async () => {
    const checkin = new Date();
    checkin.setDate(checkin.getDate() + 30);
    prisma.hotelBooking.findFirst.mockResolvedValue({
      id: 'b1', status: 'confirmed', liteapiBookingId: 'MOCK-BOOK-1', checkin,
    });
    prisma.hotelBooking.update.mockResolvedValue({ id: 'b1', status: 'cancelled' });
    const req = mockReq({ params: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }, body: { reason: 'test' } });
    const res = mockRes();
    await cancelBooking(req, res, vi.fn());
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(res.json.mock.calls[0][0].data.status).toBe('cancelled');
  });

  it('should return 400 when already cancelled', async () => {
    prisma.hotelBooking.findFirst.mockResolvedValue({ id: 'b1', status: 'cancelled' });
    const req = mockReq({ params: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
    const next = vi.fn();
    await cancelBooking(req, mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});

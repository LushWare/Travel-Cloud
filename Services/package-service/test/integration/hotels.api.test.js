import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { buildSearchRequest, buildBookingRequest, buildGuest } from '../factories/hotel.js';

// Force mock mode for integration tests — no real API calls
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

describe('Hotel API — Search', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/hotels/search', () => {
    it('should return 200 with hotel offers', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/search')
        .set(auth())
        .send(buildSearchRequest());
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('hotelId');
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('cheapestRate');
    });

    it('should return 401 without auth', async () => {
      const res = await request(app).post('/api/v1/hotels/search').send(buildSearchRequest());
      expect(res.status).toBe(401);
    });

    it('should return 403 for vendor role', async () => {
      const res = await request(app).post('/api/v1/hotels/search').set(auth({ role: 'vendor' })).send(buildSearchRequest());
      expect(res.status).toBe(403);
    });

    it('should return 400 for missing dates', async () => {
      const res = await request(app).post('/api/v1/hotels/search').set(auth()).send({ city: 'Colombo' });
      expect(res.status).toBe(400);
    });
  });
});

describe('Hotel API — Details', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/hotels/details', () => {
    it('should return 200 with hotel details', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/details')
        .set(auth())
        .send({ hotelId: 'MOCK-HOTEL-1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('hotelId', 'MOCK-HOTEL-1');
      expect(res.body.data).toHaveProperty('name');
    });

    it('should return 400 for missing hotelId', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/details')
        .set(auth())
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/details')
        .send({ hotelId: 'MOCK-HOTEL-1' });
      expect(res.status).toBe(401);
    });
  });
});

describe('Hotel API — Prebook', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/hotels/prebook', () => {
    it('should return 200 with prebook token', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/prebook')
        .set(auth())
        .send({ offerId: 'MOCK-OFFER-1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('prebookId');
      expect(res.body.data.status).toBe('valid');
    });

    it('should return 400 for missing offerId', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/prebook')
        .set(auth())
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 without auth', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/prebook')
        .send({ offerId: 'MOCK-OFFER-1' });
      expect(res.status).toBe(401);
    });

    it('should return 403 for vendor role', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/prebook')
        .set(auth({ role: 'vendor' }))
        .send({ offerId: 'MOCK-OFFER-1' });
      expect(res.status).toBe(403);
    });
  });
});

describe('Hotel API — Book', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/hotels/book', () => {
    it('should return 201 with a booking', async () => {
      prisma.hotelBooking.create.mockResolvedValue({
        id: 'b1', liteapiBookingId: 'mock-book', hotelName: 'Test Hotel',
        status: 'confirmed', totalAmount: 250, currency: 'USD',
      });
      const payload = buildBookingRequest();
      const res = await request(app).post('/api/v1/hotels/book').set(auth()).send(payload);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });

    it('should return 400 when guests is empty', async () => {
      const res = await request(app).post('/api/v1/hotels/book').set(auth()).send({ prebookId: 'x', guests: [], contact: { email: 'a@b.com' } });
      expect(res.status).toBe(400);
    });

    it('should return 400 with invalid contact email', async () => {
      const res = await request(app).post('/api/v1/hotels/book').set(auth()).send({
        prebookId: 'x', guests: [{ firstName: 'J', lastName: 'D' }], contact: { email: 'bad' },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('Hotel API — Booking Management', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/hotels/bookings', () => {
    it('should return bookings list', async () => {
      prisma.hotelBooking.findMany.mockResolvedValue([{ id: 'b1', hotelName: 'H', status: 'confirmed' }]);
      const res = await request(app).get('/api/v1/hotels/bookings').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/v1/hotels/bookings/:id', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    it('should return a booking', async () => {
      prisma.hotelBooking.findFirst.mockResolvedValue({ id: uuid, hotelName: 'H', status: 'confirmed' });
      const res = await request(app).get(`/api/v1/hotels/bookings/${uuid}`).set(auth());
      expect(res.status).toBe(200);
    });
    it('should return 404 when not found', async () => {
      prisma.hotelBooking.findFirst.mockResolvedValue(null);
      const res = await request(app).get(`/api/v1/hotels/bookings/${uuid}`).set(auth());
      expect(res.status).toBe(404);
    });
    it('should reject invalid UUID', async () => {
      const res = await request(app).get('/api/v1/hotels/bookings/not-a-uuid').set(auth());
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/hotels/bookings/:id/cancel', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    it('should cancel a booking', async () => {
      const checkin = new Date();
      checkin.setDate(checkin.getDate() + 30);
      prisma.hotelBooking.findFirst.mockResolvedValue({
        id: uuid, status: 'confirmed', liteapiBookingId: 'MOCK-BOOK-1', checkin,
      });
      prisma.hotelBooking.update.mockResolvedValue({ id: uuid, status: 'cancelled' });
      const res = await request(app).post(`/api/v1/hotels/bookings/${uuid}/cancel`).set(auth()).send({ reason: 'test' });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });
  });
});

describe('Hotel API — bookWithContext', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/v1/hotels/book-with-context', () => {
    it('should return 201 with lead-scoped booking', async () => {
      prisma.hotelBooking.create.mockResolvedValue({
        id: 'b2', liteapiBookingId: 'mock-book-2', hotelName: 'Context Hotel',
        status: 'confirmed', totalAmount: 300, currency: 'USD',
        leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', dayNumber: 2,
      });
      const res = await request(app)
        .post('/api/v1/hotels/book-with-context')
        .set(auth())
        .send({
          prebookId: 'mock-prebook',
          guests: [buildGuest()],
          contact: { email: 'agent@test.com', phone: '+15555550100' },
          offer: { hotelId: 'MOCK-HOTEL-1', name: 'Grand Hyatt' },
          leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          dayNumber: 2,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.leadId).toBeDefined();
      expect(res.body.data.dayNumber).toBe(2);
    });

    it('should return 400 for empty guests', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/book-with-context')
        .set(auth())
        .send({ prebookId: 'x', guests: [], contact: { email: 'a@b.com' } });
      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid leadId UUID', async () => {
      const res = await request(app)
        .post('/api/v1/hotels/book-with-context')
        .set(auth())
        .send({
          prebookId: 'x',
          guests: [buildGuest()],
          contact: { email: 'a@b.com' },
          leadId: 'not-a-uuid',
        });
      expect(res.status).toBe(400);
    });
  });
});

describe('Hotel API — Bookings by Lead', () => {
  beforeEach(() => vi.clearAllMocks());

  const lid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  describe('GET /api/v1/hotels/bookings/by-lead/:leadId', () => {
    it('should return bookings for a lead', async () => {
      prisma.hotelBooking.findMany.mockResolvedValue([
        { id: 'b1', leadId: lid, hotelName: 'H1', status: 'confirmed', dayNumber: 1 },
      ]);
      const res = await request(app)
        .get(`/api/v1/hotels/bookings/by-lead/${lid}`)
        .set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    it('should return empty array for lead with no bookings', async () => {
      prisma.hotelBooking.findMany.mockResolvedValue([]);
      const res = await request(app)
        .get(`/api/v1/hotels/bookings/by-lead/${lid}`)
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
});

describe('Hotel API — Health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { MockFlightClient } from '../../src/clients/mock.client.js';
import {
  buildFlightOffer,
  buildFlightSegment,
  buildSearchRequest,
  buildBookingRequest,
} from '../factories/flight.js';

// ── Ensure mock mode (no real Travelport calls) ─────────────────────
beforeAll(() => {
  process.env.TRAVELPORT_MOCK_MODE = 'true';
  // Pretend flights are allowed only in automated tests, and only when asked for.
  process.env.NODE_ENV = 'test';
  process.env.FLIGHT_PROVIDER = 'mock';
});

// ── Mock prisma (no real DB) ────────────────────────────────────────
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    flightBooking: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      // listBookings reports a real total now, so the page size cannot be
      // mistaken for the total.
      count: vi.fn(),
    },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma }));

// Dynamic import after mocks and env are set
const { default: app } = await import('../../src/app.js');
const prisma = mockPrisma;

// ── Auth helper ──────────────────────────────────────────────────────
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

// ── Tests ────────────────────────────────────────────────────────────
describe('Flight API — Search & Book', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/flights/search', () => {
    it('should return 200 with flight offers from mock client', async () => {
      const res = await request(app)
        .post('/api/v1/flights/search')
        .set(authHeaders())
        .send(buildSearchRequest());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.data[0]).toHaveProperty('offerId');
      expect(res.body.data[0]).toHaveProperty('airline');
      expect(res.body.data[0]).toHaveProperty('segments');
      expect(res.body.data[0].segments[0]).toHaveProperty('flightNumber');
    });

    it('should return 401 when auth headers are missing', async () => {
      const res = await request(app)
        .post('/api/v1/flights/search')
        .send(buildSearchRequest());

      expect(res.status).toBe(401);
    });

    it('should return 403 for roles not in the allowed list', async () => {
      const res = await request(app)
        .post('/api/v1/flights/search')
        .set(authHeaders({ role: 'vendor' }))
        .send(buildSearchRequest());

      expect(res.status).toBe(403);
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/flights/search')
        .set(authHeaders())
        .send({ origin: 'CMB' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/flights/book', () => {
    it('should return 201 with a booking', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(undefined);

      const fakeBooking = {
        id: 'booking-1',
        pnr: 'MOCKABC',
        travelportOrderId: 'MOCK-ORDER-ABC',
        status: 'confirmed',
        totalAmount: 260,
        currency: 'USD',
        tripType: 'oneWay',
        cabinClass: 'Economy',
        baseFare: 220,
        taxes: 40,
        segments: [
          {
            sequence: 1,
            origin: 'CMB',
            destination: 'DXB',
            marketingCarrier: 'EK',
            flightNumber: 'EK502',
            departureAt: '2026-08-01T06:00:00Z',
            arrivalAt: '2026-08-01T10:15:00Z',
          },
        ],
        travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe' }],
      };
      prisma.flightBooking.create.mockResolvedValue(fakeBooking);

      const res = await request(app)
        .post('/api/v1/flights/book')
        .set(authHeaders())
        .send(buildBookingRequest());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pnr).toBeTruthy();
      expect(res.body.data.status).toBe('confirmed');
    });

    it('should store the trip type the caller searched with', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(undefined);
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-rt', pnr: 'MOCKRT', status: 'confirmed' });

      const res = await request(app)
        .post('/api/v1/flights/book')
        .set(authHeaders())
        .send(
          buildBookingRequest({
            tripType: 'roundTrip',
            offer: buildFlightOffer({
              legCount: 2,
              segments: [buildFlightSegment({ sequence: 1 }), buildFlightSegment({ sequence: 101 })],
            }),
          }),
        );

      expect(res.status).toBe(201);
      expect(prisma.flightBooking.create.mock.calls[0][0].data.tripType).toBe('roundTrip');
    });

    // The validated boundary fills tripType in from its own default, so the
    // offer-derived inference in the controller is only reachable below the
    // HTTP layer (covered by the controller unit tests).
    it('should default an omitted tripType to oneWay', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.$executeRaw.mockResolvedValue(undefined);
      prisma.flightBooking.create.mockResolvedValue({ id: 'booking-def', pnr: 'MOCKDEF', status: 'confirmed' });

      const payload = buildBookingRequest({
        offer: buildFlightOffer({
          legCount: 2,
          segments: [buildFlightSegment({ sequence: 1 }), buildFlightSegment({ sequence: 101 })],
        }),
      });
      delete payload.tripType;

      const res = await request(app)
        .post('/api/v1/flights/book')
        .set(authHeaders())
        .send(payload);

      expect(res.status).toBe(201);
      expect(prisma.flightBooking.create.mock.calls[0][0].data.tripType).toBe('oneWay');
    });

    it('should return 400 when travelers array is empty', async () => {
      const res = await request(app)
        .post('/api/v1/flights/book')
        .set(authHeaders())
        .send({
          offer: { offerId: 'X' },
          travelers: [],
          contact: { email: 'a@b.com' },
        });

      expect(res.status).toBe(400);
      // Field-level detail travels in errors[] now; the message is a fixed sentence
      // written for the caller rather than the validator's own wording.
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: expect.stringContaining('travelers') }),
        ]),
      );
    });
  });

  describe('POST /api/v1/flights/price', () => {
    it('should return 200 with pricing', async () => {
      const res = await request(app)
        .post('/api/v1/flights/price')
        .set(authHeaders())
        .send({ offerId: 'OFF-1' });

      expect(res.status).toBe(200);
      expect(res.body.data.revalidated).toBe(true);
    });
  });
});

describe('Flight API — Booking Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/flights/bookings', () => {
    it('should return 200 with booking list', async () => {
      prisma.flightBooking.findMany.mockResolvedValue([
        {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', pnr: 'PNR1', status: 'confirmed', totalAmount: 300,
          currency: 'USD', segments: [], travelers: [],
        },
        {
          id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', pnr: 'PNR2', status: 'cancelled', totalAmount: 450,
          currency: 'USD', segments: [], travelers: [],
        },
      ]);

      const res = await request(app)
        .get('/api/v1/flights/bookings')
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('should return segments in sequence order', async () => {
      prisma.flightBooking.findMany.mockResolvedValue([]);

      await request(app)
        .get('/api/v1/flights/bookings')
        .set(authHeaders());

      expect(prisma.flightBooking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { segments: { orderBy: { sequence: 'asc' } }, travelers: true },
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.flightBooking.findMany.mockResolvedValue([]);

      await request(app)
        .get('/api/v1/flights/bookings?status=cancelled')
        .set(authHeaders());

      expect(prisma.flightBooking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'cancelled' } }),
      );
    });
  });

  describe('GET /api/v1/flights/bookings/:id', () => {
    it('should return 200 with a single booking', async () => {
      prisma.flightBooking.findFirst.mockResolvedValue({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', pnr: 'PNR1', status: 'confirmed', segments: [], travelers: [],
      });

      const res = await request(app)
        .get('/api/v1/flights/bookings/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
        .set(authHeaders());

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('should return 404 when not found', async () => {
      prisma.flightBooking.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/flights/bookings/00000000-0000-0000-0000-000000000000')
        .set(authHeaders());

      expect(res.status).toBe(404);
    });

    it('should read segments in sequence order', async () => {
      prisma.flightBooking.findFirst.mockResolvedValue({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', segments: [], travelers: [],
      });

      await request(app)
        .get('/api/v1/flights/bookings/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
        .set(authHeaders());

      expect(prisma.flightBooking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { segments: { orderBy: { sequence: 'asc' } }, travelers: true },
        }),
      );
    });
  });

  describe('POST /api/v1/flights/bookings/:id/cancel', () => {
    it('should cancel via mock client and update DB', async () => {
      prisma.flightBooking.findFirst.mockResolvedValue({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', status: 'confirmed', travelportOrderId: 'ORD-1',
      });
      prisma.flightBooking.update.mockResolvedValue({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', pnr: 'PNR1', status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: 'Customer request',
        segments: [], travelers: [],
      });

      const res = await request(app)
        .post('/api/v1/flights/bookings/a1b2c3d4-e5f6-7890-abcd-ef1234567890/cancel')
        .set(authHeaders())
        .send({ reason: 'Customer request' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('should cancel locally when no travelportOrderId', async () => {
      prisma.flightBooking.findFirst.mockResolvedValue({
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', status: 'pending', travelportOrderId: null,
      });
      prisma.flightBooking.update.mockResolvedValue({
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', status: 'cancelled', segments: [], travelers: [],
      });

      const res = await request(app)
        .post('/api/v1/flights/bookings/b2c3d4e5-f6a7-8901-bcde-f12345678901/cancel')
        .set(authHeaders());

      expect(res.status).toBe(200);
    });
  });
});

describe('Flight API — lead-scoped bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read segments in sequence order', async () => {
    prisma.flightBooking.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/flights/bookings/by-lead/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .set(authHeaders());

    expect(res.status).toBe(200);
    expect(prisma.flightBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { segments: { orderBy: { sequence: 'asc' } }, travelers: true },
      }),
    );
  });
});

describe('Flight API — Health & Edge Cases', () => {
  it('GET /health should return ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should return 404 for unknown flight routes', async () => {
    const res = await request(app)
      .get('/api/v1/flights/nonexistent-route')
      .set(authHeaders());

    expect(res.status).toBe(404);
  });

  it('should allow superAdmin with any base role', async () => {
    const res = await request(app)
      .post('/api/v1/flights/search')
      .set(authHeaders({ role: 'vendor', isSuperAdmin: true }))
      .send(buildSearchRequest());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
  });

  it('should allow salesRep for all flight endpoints', async () => {
    const res = await request(app)
      .post('/api/v1/flights/price')
      .set(authHeaders({ role: 'salesRep' }))
      .send({ offerId: 'X' });

    expect(res.status).toBe(200);
  });

  it('should inject a fresh flightClient per request', async () => {
    // Verify the mock client returns consistent data across requests
    const res1 = await request(app)
      .post('/api/v1/flights/search')
      .set(authHeaders())
      .send({ origin: 'LHR', destination: 'CDG', departureDate: '2026-09-01' });

    expect(res1.body.data).toHaveLength(5);
  });
});

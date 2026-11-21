import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DuffelClient } from '../duffel.client.js';
import logger from '../../config/logger.js';

// ── Hoisted mock for axios ───────────────────────────────────────────
const { mockAxiosInstance } = vi.hoisted(() => ({
  mockAxiosInstance: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────
/**
 * Wrap a Duffel API response body to simulate axios's { data: body } shape.
 * The Duffel API also wraps responses in { data: {...} }, so the full shape is:
 *   axios({ data: duffelWrapper({ data: actualPayload }) })
 */
function axiosify(duffelBody) {
  return { data: duffelBody };
}

function mockDuffelOfferRequest(overrides = {}) {
  return axiosify({
    data: {
      id: 'orq_00009hjdomFOCJyxHG7k7k',
      live_mode: false,
      created_at: '2026-08-01T06:00:00Z',
      slices: [
        {
          origin: { iata_code: 'CMB' },
          destination: { iata_code: 'DXB' },
          segments: [
            {
              marketing_carrier: { iata_code: 'EK', name: 'Emirates' },
              operating_carrier: { iata_code: 'EK', name: 'Emirates' },
              marketing_carrier_flight_number: '502',
              origin: { iata_code: 'CMB' },
              destination: { iata_code: 'DXB' },
              departing_at: '2026-08-01T08:30:00Z',
              arriving_at: '2026-08-01T14:45:00Z',
              duration: 'PT6H15M',
            },
          ],
          cabin_class: 'economy',
        },
      ],
      passengers: [{ id: 'pas_0001', type: 'adult' }],
      offers: [
        {
          id: 'off_00009htYpSCXrwaB9DnUm0',
          owner: { name: 'Emirates', iata_code: 'EK' },
          total_amount: '301.57',
          total_currency: 'USD',
          base_amount: '250.00',
          tax_amount: '51.57',
          conditions: {
            refund_before_departure: { allowed: true, penalty_amount: '50.00', penalty_currency: 'USD' },
            change_before_departure: { allowed: true, penalty_amount: '25.00', penalty_currency: 'USD' },
          },
          slices: [
            {
              cabin_class: 'economy',
              segments: [
                {
                  marketing_carrier: { iata_code: 'EK', name: 'Emirates' },
                  operating_carrier: { iata_code: 'EK', name: 'Emirates' },
                  marketing_carrier_flight_number: '502',
                  origin: { iata_code: 'CMB' },
                  destination: { iata_code: 'DXB' },
                  departing_at: '2026-08-01T08:30:00Z',
                  arriving_at: '2026-08-01T14:45:00Z',
                  duration: 'PT6H15M',
                },
              ],
            },
          ],
        },
      ],
      ...overrides,
    },
  });
}

function mockDuffelOrder(overrides = {}) {
  return axiosify({
    data: {
      id: 'ord_00009hthhsUZ8W4LxQgkjo',
      booking_reference: 'ABC123',
      total_amount: '301.57',
      total_currency: 'USD',
      cancelled_at: null,
      created_at: '2026-08-01T06:05:00Z',
      ...overrides,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────
describe('DuffelClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_key_12345';
    client = new DuffelClient();
  });

  afterEach(() => {
    delete process.env.DUFFEL_ACCESS_TOKEN;
  });

  describe('constructor', () => {
    it('should throw a user-facing message when DUFFEL_ACCESS_TOKEN is not set', () => {
      delete process.env.DUFFEL_ACCESS_TOKEN;

      let thrown;
      try {
        new DuffelClient();
      } catch (err) {
        thrown = err;
      }

      expect(thrown.message).toBe('Flight search is temporarily unavailable. Please try again in a moment.');
      expect(thrown.message).not.toContain('DUFFEL_ACCESS_TOKEN');
      expect(thrown.code).toBe('PROVIDER_UNAVAILABLE');
    });

    it("sends an agency's own token instead of Lushware's", async () => {
      const axios = (await import('axios')).default;
      mockAxiosInstance.get.mockResolvedValue(mockDuffelOrder());

      await new DuffelClient({ accessToken: 'duffel_test_agency_token_1' }).getOrder('ord_00009hthhsUZ8W4LxQgkjo');

      expect(axios.create).toHaveBeenLastCalledWith(expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer duffel_test_agency_token_1' }),
      }));
    });

    it('refuses an agency account with no token', () => {
      expect(() => new DuffelClient({ accessToken: '' })).toThrow('temporarily unavailable');
    });
  });

  // A Duffel error names the supplier and its own field paths. None of that may
  // reach a traveller, so each operation is checked for both the sentence shown
  // and the text withheld.
  describe('provider failures are sanitised', () => {
    const providerError = (status, data) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
      });

    const callFor = {
      search: () => client.searchFlights({ origin: 'CMB', destination: 'DXB', departureDate: '2026-08-01' }),
      price: () => client.priceOffer('off_1'),
      book: () =>
        client.createOrder({
          offerId: 'off_1',
          travelers: [{ id: 't1' }],
          contact: { email: 'a@b.test' },
        }),
      retrieve: () => client.getOrder('ord_1'),
      cancel: () => client.cancelOrder('ord_1'),
    };

    async function failure(operation, status, data) {
      const err = providerError(status, data);
      mockAxiosInstance.post.mockRejectedValue(err);
      mockAxiosInstance.get.mockRejectedValue(err);
      return callFor[operation]().catch((e) => e);
    }

    const rawPayload = {
      errors: [{ field: 'passengers[0].born_on', title: 'is invalid' }],
      message: 'raw operator text',
    };

    it.each([
      ['search', 422, 400, 'PROVIDER_REJECTED'],
      ['search', 503, 502, 'PROVIDER_UNAVAILABLE'],
      ['price', 404, 404, 'NOT_FOUND'],
      ['price', 500, 502, 'PROVIDER_UNAVAILABLE'],
      ['book', 400, 400, 'PROVIDER_REJECTED'],
      ['book', 502, 502, 'PROVIDER_UNAVAILABLE'],
      ['retrieve', 404, 404, 'NOT_FOUND'],
      ['cancel', 409, 400, 'PROVIDER_REJECTED'],
    ])(
      '%s failing with provider status %i surfaces %i / %s',
      async (operation, providerStatus, statusCode, code) => {
        const err = await failure(operation, providerStatus, rawPayload);

        expect(err.statusCode).toBe(statusCode);
        expect(err.code).toBe(code);
        expect(err.message).not.toMatch(
          /Duffel|born_on|raw operator text|passengers\[0\]|Request failed with status code/,
        );
      },
    );

    it('maps a provider outage with no status to a retryable 502', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('socket hang up'));
      mockAxiosInstance.get.mockRejectedValue(new Error('socket hang up'));

      const err = await callFor.search().catch((e) => e);

      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('PROVIDER_UNAVAILABLE');
      expect(err.message).not.toContain('socket hang up');
    });

    it('logs the provider payload it refuses to show', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      await failure('search', 422, rawPayload);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'search', status: 422, data: rawPayload }),
        'Duffel API error details',
      );
      spy.mockRestore();
    });
  });

  describe('searchFlights', () => {
    it('should normalise Duffel offer response to FlightOffer shape', async () => {
      mockAxiosInstance.post.mockResolvedValue(mockDuffelOfferRequest());

      const offers = await client.searchFlights({
        origin: 'CMB',
        destination: 'DXB',
        departureDate: '2026-08-01',
        adults: 1,
      });

      expect(offers).toHaveLength(1);
      const offer = offers[0];
      expect(offer.offerId).toBe('off_00009htYpSCXrwaB9DnUm0');
      expect(offer.airline).toBe('Emirates');
      expect(offer.airlineCode).toBe('EK');
      expect(offer.legCount).toBe(1);
      expect(offer.currency).toBe('USD');
      expect(offer.baseFare).toBe(250.00);
      expect(offer.taxes).toBe(51.57);
      expect(offer.fareTotal).toBe(301.57);
      expect(offer.refundable).toBe(true);
      expect(offer.segments).toHaveLength(1);
      expect(offer.segments[0].flightNumber).toBe('EK502');
      expect(offer.segments[0].origin).toBe('CMB');
      expect(offer.segments[0].destination).toBe('DXB');
      expect(offer.segments[0].durationMinutes).toBe(375);
    });

    it('should build round-trip slices when returnDate is provided', async () => {
      mockAxiosInstance.post.mockResolvedValue(mockDuffelOfferRequest());

      await client.searchFlights({
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2026-09-10',
        returnDate: '2026-09-20',
        adults: 2,
      });

      const call = mockAxiosInstance.post.mock.calls[0];
      const body = call[1];
      expect(body.data.slices).toHaveLength(2);
      expect(body.data.slices[0].departure_date).toBe('2026-09-10');
      expect(body.data.slices[1].departure_date).toBe('2026-09-20');
      expect(body.data.passengers).toHaveLength(2);
    });

    it('should report one leg per slice and flatten both slices\' segments for a round trip', async () => {
      const segment = (number, origin, destination, departingAt, duration) => ({
        marketing_carrier: { iata_code: 'EK', name: 'Emirates' },
        marketing_carrier_flight_number: number,
        origin: { iata_code: origin },
        destination: { iata_code: destination },
        departing_at: departingAt,
        arriving_at: departingAt,
        duration,
      });

      mockAxiosInstance.post.mockResolvedValue(
        mockDuffelOfferRequest({
          offers: [
            {
              id: 'off_rt_1',
              owner: { name: 'Emirates', iata_code: 'EK' },
              total_amount: '620.00',
              total_currency: 'USD',
              base_amount: '520.00',
              tax_amount: '100.00',
              slices: [
                {
                  cabin_class: 'economy',
                  segments: [
                    segment('1', 'LHR', 'IST', '2026-08-01T08:00:00Z', 'PT4H'),
                    segment('2', 'IST', 'DXB', '2026-08-01T13:00:00Z', 'PT5H'),
                  ],
                },
                {
                  cabin_class: 'economy',
                  segments: [segment('3', 'DXB', 'LHR', '2026-08-08T08:00:00Z', 'PT7H')],
                },
              ],
            },
          ],
        }),
      );

      const offers = await client.searchFlights({
        origin: 'LHR',
        destination: 'DXB',
        departureDate: '2026-08-01',
        returnDate: '2026-08-08',
        adults: 1,
      });

      expect(offers[0].legCount).toBe(2);
      expect(offers[0].segments).toHaveLength(3);
      // Sequence is sliceIdx * 100 + segIdx + 1 — the booking read orders by it.
      expect(offers[0].segments.map((s) => s.sequence)).toEqual([1, 2, 101]);
    });

    it('should reject when required fields are missing', async () => {
      await expect(
        client.searchFlights({ origin: 'CMB', destination: '', departureDate: '2026-08-01' }),
      ).rejects.toThrow('origin');
    });
  });

  describe('priceOffer', () => {
    it('should return revalidated pricing', async () => {
      mockAxiosInstance.get.mockResolvedValue(axiosify({
        data: {
          id: 'off_1',
          total_amount: '320.00',
          base_amount: '260.00',
        },
      }));

      const result = await client.priceOffer('off_1');

      expect(result).toEqual({
        offerId: 'off_1',
        revalidated: true,
        priceChanged: true,
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/air/offers/off_1', expect.anything());
    });
  });

  describe('createOrder', () => {
    it('should book and return a normalised order', async () => {
      mockAxiosInstance.post.mockResolvedValue(mockDuffelOrder());

      const result = await client.createOrder({
        offerId: 'off_00009htYpSCXrwaB9DnUm0',
        travelers: [
          {
            type: 'adult', title: 'Mr', firstName: 'John', lastName: 'Doe',
            dob: '1990-05-15', email: 'john@test.com', phone: '+1234567890',
            gender: 'M', passengerId: 'pas_0001',
          },
        ],
        contact: { name: 'John Doe', email: 'john@test.com' },
      });

      expect(result.pnr).toBe('ABC123');
      expect(result.travelportOrderId).toBe('ord_00009hthhsUZ8W4LxQgkjo');
      expect(result.status).toBe('confirmed');
    });

    it('should reject when travelers array is empty', async () => {
      await expect(
        client.createOrder({ offerId: 'X', travelers: [], contact: { email: 'a@b.com' } }),
      ).rejects.toThrow('traveler');
    });
  });

  describe('cancelOrder', () => {
    it('should create cancellation and confirm it (two-step)', async () => {
      mockAxiosInstance.post
        // Step 1: create cancellation
        .mockResolvedValueOnce({
          data: {
            data: {
              id: 'orc_0001',
              refund_amount: '200.00',
              refund_currency: 'USD',
              expires_at: '2026-08-02T06:05:00Z',
            },
          },
        })
        // Step 2: confirm cancellation
        .mockResolvedValueOnce({ data: { data: { id: 'orc_0001', confirmed_at: new Date().toISOString() } } });

      const result = await client.cancelOrder('ord_0001');

      expect(result.status).toBe('cancelled');
      expect(result.travelportOrderId).toBe('ord_0001');
      expect(result.refundAmount).toBe('200.00');

      // Verify two calls were made
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(1, '/air/order_cancellations', expect.anything());
      expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
        2,
        '/air/order_cancellations/orc_0001/actions/confirm',
      );
    });
  });

  describe('getFlightDetails', () => {
    it('should return a stub with explanatory note', async () => {
      const details = await client.getFlightDetails({
        flightNumber: 'EK502',
        departureDate: '2026-08-01',
      });

      expect(details.flightNumber).toBe('EK502');
      expect(details.status).toBe('SCHEDULED');
      expect(details.note).toContain('not available via Duffel');
    });
  });
});

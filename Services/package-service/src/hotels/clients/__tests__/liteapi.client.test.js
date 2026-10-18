import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import logger from '../../../config/logger.js';

// ── Hoisted axios mock ───────────────────────────────────────────────
// The client calls axios.create per request (search and booking use separate
// hosts), so one shared instance stands in for both.
const { mockInstance } = vi.hoisted(() => ({
  mockInstance: { post: vi.fn(), get: vi.fn(), put: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockInstance) },
}));

import { LiteApiClient } from '../liteapi.client.js';

// LiteAPI returned its error body as an object which was JSON.stringify'd into
// the message a traveller read, and every provider failure surfaced as a 500 —
// including a hotel that simply no longer exists.
describe('LiteApiClient error sanitisation', () => {
  let client;

  const rawPayload = {
    error: { code: 'RATE_NOT_AVAILABLE', message: 'operator-facing supplier text' },
    message: 'raw operator text',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LITEAPI_API_KEY = 'test-key';
    client = new LiteApiClient();
  });

  afterEach(() => {
    delete process.env.LITEAPI_API_KEY;
    vi.restoreAllMocks();
  });

  const callFor = {
    search: () => client.searchHotels({ checkin: '2026-09-01', checkout: '2026-09-03', city: 'Paris' }),
    details: () => client.getHotelDetails('hotel-1'),
    book: () =>
      client.book({
        prebookId: 'pb-1',
        guests: [{ firstName: 'Sam', lastName: 'Rep' }],
        contact: { email: 'a@b.test', phone: '+15555550100' },
      }),
    retrieve: () => client.getBooking('bk-1'),
    list: () => client.listBookings(),
    cancel: () => client.cancelBooking('bk-1'),
  };

  async function failure(operation, status) {
    const err = Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data: rawPayload },
    });
    mockInstance.post.mockRejectedValue(err);
    mockInstance.get.mockRejectedValue(err);
    mockInstance.put.mockRejectedValue(err);
    return callFor[operation]().catch((e) => e);
  }

  it('tells the user nothing about configuration when the provider is unset', () => {
    // The check runs in the constructor, so the client must be built without a key.
    delete process.env.LITEAPI_API_KEY;

    let thrown;
    try {
      new LiteApiClient();
    } catch (err) {
      thrown = err;
    }

    expect(thrown.message).toBe('Hotel search is temporarily unavailable. Please try again in a moment.');
    expect(thrown.message).not.toContain('LITEAPI_API_KEY');
    expect(thrown.statusCode).toBe(503);
    expect(thrown.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it.each([
    ['search', 422, 400, 'PROVIDER_REJECTED'],
    ['search', 503, 502, 'PROVIDER_UNAVAILABLE'],
    ['details', 404, 404, 'NOT_FOUND'],
    ['details', 500, 502, 'PROVIDER_UNAVAILABLE'],
    ['book', 400, 400, 'PROVIDER_REJECTED'],
    ['book', 502, 502, 'PROVIDER_UNAVAILABLE'],
    ['retrieve', 404, 404, 'NOT_FOUND'],
    ['list', 500, 502, 'PROVIDER_UNAVAILABLE'],
    ['cancel', 500, 502, 'PROVIDER_UNAVAILABLE'],
  ])(
    '%s failing with provider status %i surfaces %i / %s',
    async (operation, providerStatus, statusCode, code) => {
      const err = await failure(operation, providerStatus);

      expect(err.statusCode).toBe(statusCode);
      expect(err.code).toBe(code);
      expect(err.message).not.toMatch(
        /LiteAPI|RATE_NOT_AVAILABLE|operator-facing|raw operator text|Request failed with status code/,
      );
    },
  );

  it('never stringifies the provider error object into the message', async () => {
    const err = await failure('search', 400);

    expect(err.message).not.toContain('{');
    expect(err.message).not.toContain('}');
    expect(err.message).not.toContain('"code"');
  });

  it('maps a provider outage with no status to a retryable 502', async () => {
    mockInstance.post.mockRejectedValue(new Error('socket hang up'));
    mockInstance.get.mockRejectedValue(new Error('socket hang up'));
    mockInstance.put.mockRejectedValue(new Error('socket hang up'));

    const err = await callFor.search().catch((e) => e);

    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.message).not.toContain('socket hang up');
  });

  it('logs the provider payload it refuses to show', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await failure('search', 400);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'search', status: 400, data: rawPayload }),
      'LiteAPI error details',
    );
    spy.mockRestore();
  });

  it('keeps a client-authored guard at 400 with its own text', async () => {
    // These are written for the caller, carry no supplier vocabulary, and used to
    // arrive as an unhandled 500 because they were plain Errors.
    const guard = await client.getHotelDetails('').catch((e) => e);

    expect(guard.message).toBe('hotelId is required');
    expect(guard.statusCode).toBe(400);
    expect(guard.code).toBeUndefined();
  });
});

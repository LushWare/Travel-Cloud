import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestVoiceBooking } from '../booking.client.js';

beforeEach(() => {
  process.env.INTERNAL_EVENTS_TOKEN = 'booking-test-token';
  process.env.BOOKING_SERVICE_URL = 'http://booking.test';
  delete process.env.K_SERVICE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INTERNAL_EVENTS_TOKEN;
  delete process.env.BOOKING_SERVICE_URL;
});

const payload = {
  conversationId: 'call-1',
  packageId: '11111111-1111-4111-8111-111111111111',
  searchPriceSnapshot: 1950,
  bookingConfirmed: true,
  name: 'Jane Doe',
  email: 'jane@example.com',
  travelDate: '2026-12-01',
  travelers: 2,
};

describe('requestVoiceBooking', () => {
  it('sends the complete confirmed request to the internal booking endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { bookingId: 'booking-1', bookingStatus: 'pending' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestVoiceBooking(payload, 'req-1')).resolves.toEqual({
      bookingId: 'booking-1', bookingStatus: 'pending',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('http://booking.test/api/v1/bookings/internal/voice');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'x-internal-token': 'booking-test-token',
      'x-request-id': 'req-1',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(payload);
  });

  it('returns a review-required result from booking-service without converting it into a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        success: false,
        data: { reviewRequired: true, reason: 'package_price_changed_since_search' },
      }),
    })));

    await expect(requestVoiceBooking(payload)).resolves.toEqual({
      reviewRequired: true, reason: 'package_price_changed_since_search',
    });
  });

  it('does not call booking-service without the internal service token', async () => {
    delete process.env.INTERNAL_EVENTS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestVoiceBooking(payload)).rejects.toThrow('INTERNAL_EVENTS_TOKEN is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
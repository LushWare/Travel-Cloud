import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  submitIntake, lookupLeadsByPhone,
  getTripBrief, getPaymentBrief, attachPackage, adjustItinerary, previewPricing, issueVoiceQuotation,
} from '../lead.client.js';

const ok = (data) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data }),
});

function slowFetch(ms, data) {
  return vi.fn((_url, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(ok(data)), ms);
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
}

beforeEach(() => {
  process.env.INTERNAL_EVENTS_TOKEN = 'test-token';
  process.env.LEAD_SERVICE_URL = 'http://lead.test';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('submitIntake timeout budget', () => {
  it('waits longer than 2s, so a slow intake transaction is not aborted mid-flight', async () => {
    vi.stubGlobal('fetch', slowFetch(5000, { leadId: 'lead-1', created: true }));

    const promise = submitIntake({ channel: 'voice', sessionId: 'call_1' });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ leadId: 'lead-1', created: true });
  });

  it('still gives up on an intake that hangs past the intake budget', async () => {
    vi.stubGlobal('fetch', slowFetch(60_000, {}));

    const promise = submitIntake({ channel: 'voice', sessionId: 'call_1' });
    const assertion = expect(promise).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });
});

describe('lookupLeadsByPhone timeout budget', () => {
  it('gives up within the call-setup budget so the phone still gets answered', async () => {
    vi.stubGlobal('fetch', slowFetch(5000, { count: 0, matches: [] }));

    const promise = lookupLeadsByPhone('94771234567');
    const assertion = expect(promise).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(2500);

    await assertion;
  });

  it('returns matches when the lookup answers inside the budget', async () => {
    vi.stubGlobal('fetch', slowFetch(500, { count: 1, matches: [{ leadId: 'lead-1' }] }));

    const promise = lookupLeadsByPhone('94771234567');
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toEqual({ count: 1, matches: [{ leadId: 'lead-1' }] });
  });
});

describe('internal auth', () => {
  it('sends the internal token rather than any user credential', async () => {
    const spy = slowFetch(0, { count: 0, matches: [] });
    vi.stubGlobal('fetch', spy);

    const promise = lookupLeadsByPhone('94771234567');
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(spy.mock.calls[0][1].headers['x-internal-token']).toBe('test-token');
  });

  it('refuses to call lead-service when no internal token is configured', async () => {
    delete process.env.INTERNAL_EVENTS_TOKEN;
    await expect(lookupLeadsByPhone('94771234567')).rejects.toThrow(/INTERNAL_EVENTS_TOKEN/);
  });
});

describe('live in-call actions', () => {
  it('getTripBrief calls the trip-brief route for the given lead', async () => {
    const spy = slowFetch(0, { statusClass: 'quote_sent' });
    vi.stubGlobal('fetch', spy);
    const promise = getTripBrief('lead-1');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(spy.mock.calls[0][0]).toBe('http://lead.test/api/v1/leads/internal/lead-1/trip-brief');
  });

  it('getPaymentBrief calls the payment-brief route for the given lead', async () => {
    const spy = slowFetch(0, { hasQuote: false });
    vi.stubGlobal('fetch', spy);
    const promise = getPaymentBrief('lead-1');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(spy.mock.calls[0][0]).toBe('http://lead.test/api/v1/leads/internal/lead-1/payment-brief');
  });

  it('attachPackage posts the packageId in the request body', async () => {
    const spy = slowFetch(0, { selectionId: 'sel-1' });
    vi.stubGlobal('fetch', spy);
    const promise = attachPackage('lead-1', 'pkg-9');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ packageId: 'pkg-9' });
  });

  it('adjustItinerary posts the changes object as the request body', async () => {
    const spy = slowFetch(0, { nights: 5 });
    vi.stubGlobal('fetch', spy);
    const promise = adjustItinerary('lead-1', { addNights: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ addNights: 2 });
  });

  it('previewPricing calls the pricing-preview route for the given lead', async () => {
    const spy = slowFetch(0, { financials: {}, persisted: false });
    vi.stubGlobal('fetch', spy);
    const promise = previewPricing('lead-1');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(spy.mock.calls[0][0]).toBe('http://lead.test/api/v1/leads/internal/lead-1/pricing/preview');
  });

  it('issues a verified voice quotation through the internal route with a longer webhook budget', async () => {
    const spy = slowFetch(20_000, { issued: true });
    vi.stubGlobal('fetch', spy);
    const payload = { leadId: 'lead-1', bookingId: 'booking-1', packageId: 'pkg-1', searchPriceSnapshot: 1200 };
    const promise = issueVoiceQuotation(payload, 'request-1');
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(promise).resolves.toEqual({ issued: true });
    expect(spy.mock.calls[0][0]).toBe('http://lead.test/api/v1/leads/internal/voice-auto-quote');
    expect(spy.mock.calls[0][1].headers['x-internal-token']).toBe('test-token');
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual(payload);
    expect(spy.mock.calls[0][1].signal.aborted).toBe(false);
  });

  it('a live write action waits longer than the lookup budget, so it is not aborted mid-write', async () => {
    vi.stubGlobal('fetch', slowFetch(5000, { nights: 5 }));
    const promise = adjustItinerary('lead-1', { addNights: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ nights: 5 });
  });

  // Regression: measured live at ~8.0s end-to-end (transaction + pricing
  // recompute + a package-service round trip) against the shared pooler —
  // the general LIVE_WRITE_TIMEOUT_MS (8000ms) was cutting this off right at
  // the boundary. adjustItinerary needs its own, larger budget.
  it('adjustItinerary tolerates a write slower than the general write budget', async () => {
    vi.stubGlobal('fetch', slowFetch(9000, { nights: 5 }));
    const promise = adjustItinerary('lead-1', { addNights: 1 });
    await vi.advanceTimersByTimeAsync(9000);
    await expect(promise).resolves.toEqual({ nights: 5 });
  });

  it('adjustItinerary still gives up on a write that hangs indefinitely', async () => {
    vi.stubGlobal('fetch', slowFetch(120_000, { nights: 5 }));
    const promise = adjustItinerary('lead-1', { addNights: 1 });
    const assertion = expect(promise).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});

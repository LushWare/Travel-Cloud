import { describe, expect, it, vi } from 'vitest';
import { createDuffelWebhook, duffelModeOf, duffelTokenSchema, verifyDuffelToken, DUFFEL_WEBHOOK_EVENTS } from '../duffel.js';

const reply = (status, body) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

describe('duffelTokenSchema', () => {
  it.each(['duffel_test_abcdefghij', 'duffel_live_ABC-def_1234567'])('accepts %s', (token) => {
    expect(duffelTokenSchema.safeParse({ accessToken: token }).success).toBe(true);
  });

  it.each(['', 'duffel_test_', 'sk_live_abcdefghijkl', 'duffel_test_has spaces in it', 'duffel_prod_abcdefghijkl'])('refuses "%s"', (token) => {
    expect(duffelTokenSchema.safeParse({ accessToken: token }).success).toBe(false);
  });

  it('refuses extra fields', () => {
    expect(duffelTokenSchema.safeParse({ accessToken: 'duffel_test_abcdefghij', mode: 'live' }).success).toBe(false);
  });
});

describe('duffelModeOf', () => {
  it('reads live from the token prefix', () => expect(duffelModeOf('duffel_live_x')).toBe('live'));
  it('reads test from the token prefix', () => expect(duffelModeOf('duffel_test_x')).toBe('test'));
});

describe('verifyDuffelToken', () => {
  it('sends the token and the Duffel API version', async () => {
    const fetchImpl = reply(200, { data: [] });

    await verifyDuffelToken('duffel_test_abc', { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.duffel.com/air/airlines?limit=1');
    expect(init.headers).toMatchObject({ authorization: 'Bearer duffel_test_abc', 'duffel-version': 'v2' });
  });

  it('throws with the status when Duffel refuses the token', async () => {
    await expect(verifyDuffelToken('duffel_test_bad', { fetchImpl: reply(401, {}) })).rejects.toMatchObject({ status: 401 });
  });
});

describe('createDuffelWebhook', () => {
  it('subscribes to the booking events and returns the one-time secret', async () => {
    const fetchImpl = reply(201, { data: { id: 'sev_1', secret: 'whsec_x', active: true } });

    const webhook = await createDuffelWebhook('duffel_test_abc', 'https://api.example.travel/hook', { fetchImpl });

    expect(webhook).toEqual({ id: 'sev_1', secret: 'whsec_x' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ data: { url: 'https://api.example.travel/hook', events: DUFFEL_WEBHOOK_EVENTS } });
  });

  it('throws when Duffel returns no secret', async () => {
    await expect(createDuffelWebhook('duffel_test_abc', 'https://x.test/h', { fetchImpl: reply(201, { data: { id: 'sev_1' } }) }))
      .rejects.toThrow('secret');
  });
});

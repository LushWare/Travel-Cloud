import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../../../shared/tenancy/src/index.js';
import { clearAgencyLiteApiCache, getAgencyLiteApiCredentials } from '../agencyLiteApi.js';
import { LITEAPI_NOT_CONNECTED, NotConnectedHotelClient, resolveHotelClient } from '../index.js';
import { LiteApiClient } from '../liteapi.client.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';
const LUSHWARE = '00000000-0000-4000-8000-000000000001';
const KEY = 'sand_c0ffee12-3456-7890-abcd-ef0123456789';
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  clearAgencyLiteApiCache();
  vi.stubEnv('PUBLIC_SITE_TENANT_ID', LUSHWARE);
  vi.stubEnv('LITEAPI_API_KEY', '');
  vi.stubEnv('LITEAPI_MOCK_MODE', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('getAgencyLiteApiCredentials', () => {
  it('asks integration-service for the current agency\'s key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { data: { apiKey: KEY, mode: 'test' } }));

    const result = await runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl }));

    expect(result).toEqual({ apiKey: KEY, mode: 'test' });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/v1\/integrations\/internal\/liteapi\/credentials$/);
    expect(fetchImpl.mock.calls[0][1].headers['x-tenant-id']).toBe(AGENCY);
  });

  it('returns null when the agency has not connected LiteAPI', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(404, {}));

    expect(await runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl }))).toBeNull();
  });

  it('remembers the answer briefly instead of asking on every call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { data: { apiKey: KEY, mode: 'test' } }));

    await runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl }));
    await runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when integration-service is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl })))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  it('answers 503 rather than use a reply that is not a LiteAPI key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { data: { apiKey: 'something-else' } }));

    await expect(runWithTenant(AGENCY, () => getAgencyLiteApiCredentials({ fetchImpl })))
      .rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('resolveHotelClient', () => {
  it('uses the agency\'s own LiteAPI account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, { data: { apiKey: KEY, mode: 'test' } })));

    const client = await runWithTenant(AGENCY, () => resolveHotelClient());

    expect(client).toBeInstanceOf(LiteApiClient);
    expect(client._apiKey).toBe(KEY);
  });

  it('never gives another agency Lushware\'s account', async () => {
    vi.stubEnv('LITEAPI_API_KEY', 'prod_lushware-own-key-0000');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, {})));

    const client = await runWithTenant(AGENCY, () => resolveHotelClient());

    expect(client).toBeInstanceOf(NotConnectedHotelClient);
  });

  it('tells an unconnected agency how to connect, with 409 HOTELS_NOT_CONNECTED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, {})));
    const client = await runWithTenant(AGENCY, () => resolveHotelClient());

    expect(() => client.searchHotels({})).toThrow(LITEAPI_NOT_CONNECTED);
    try { client.book({}); } catch (error) { expect(error).toMatchObject({ statusCode: 409, code: 'HOTELS_NOT_CONNECTED' }); }
  });

  it('keeps Lushware\'s agency on Lushware\'s own key when it has not connected one', async () => {
    vi.stubEnv('LITEAPI_API_KEY', 'prod_lushware-own-key-0000');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, {})));

    const client = await runWithTenant(LUSHWARE, () => resolveHotelClient());

    expect(client._apiKey).toBe('prod_lushware-own-key-0000');
  });

  it('keeps Lushware\'s agency working when the lookup fails', async () => {
    vi.stubEnv('LITEAPI_API_KEY', 'prod_lushware-own-key-0000');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    expect(await runWithTenant(LUSHWARE, () => resolveHotelClient())).toBeInstanceOf(LiteApiClient);
  });

  it('refuses another agency when the lookup fails, instead of guessing', async () => {
    vi.stubEnv('LITEAPI_API_KEY', 'prod_lushware-own-key-0000');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));

    await expect(runWithTenant(AGENCY, () => resolveHotelClient())).rejects.toMatchObject({ statusCode: 503 });
  });
});

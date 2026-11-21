import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';
import { DEMO_TENANT_ID } from '../../../../shared/constants/src/index.js';
import {
  clearAgencyDuffelCache, getAgencyDuffelCredentials, isLegacyDuffelTenant,
} from '../agencyDuffel.js';
import { DuffelClient } from '../duffel.client.js';
import { MockFlightClient } from '../mock.client.js';
import { NotConnectedFlightClient, resolveFlightClient } from '../index.js';

const AGENCY = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'duffel_test_agencytoken1234';
const ENV_KEYS = ['INTEGRATION_SERVICE_URL', 'INTERNAL_EVENTS_TOKEN', 'DUFFEL_ACCESS_TOKEN', 'DUFFEL_LEGACY_TENANT_ID',
  'PUBLIC_SITE_TENANT_ID', 'FLIGHT_PROVIDER', 'NODE_ENV', 'TRAVELPORT_MOCK_MODE'];
const savedEnv = {};

const reply = (status, data) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => ({ data }) });
const asAgency = (fn, tenantId = AGENCY) => runWithTenant(tenantId, fn);

beforeEach(() => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key]; }
  process.env.INTEGRATION_SERVICE_URL = 'http://localhost:3015';
  process.env.INTERNAL_EVENTS_TOKEN = 'internal-secret';
  clearAgencyDuffelCache();
  vi.unstubAllGlobals();
});
afterEach(() => {
  for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
  vi.unstubAllGlobals();
});

describe('getAgencyDuffelCredentials', () => {
  it("returns the agency's own token", async () => {
    const fetchImpl = reply(200, { accessToken: TOKEN, webhookSecret: 'whsec_1', mode: 'test' });

    const account = await asAgency(() => getAgencyDuffelCredentials({ fetchImpl }));

    expect(account).toEqual({ accessToken: TOKEN, webhookSecret: 'whsec_1', mode: 'test' });
  });

  it('asks integration-service with the internal token and the agency', async () => {
    const fetchImpl = reply(200, { accessToken: TOKEN, mode: 'test' });

    await asAgency(() => getAgencyDuffelCredentials({ fetchImpl }));

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://localhost:3015/api/v1/integrations/internal/duffel/credentials');
    expect(init.headers).toMatchObject({ 'x-internal-token': 'internal-secret', 'x-tenant-id': AGENCY });
  });

  it('returns null when the agency has not connected Duffel', async () => {
    const account = await asAgency(() => getAgencyDuffelCredentials({ fetchImpl: reply(404) }));

    expect(account).toBeNull();
  });

  it('reuses the answer for the same agency instead of asking again', async () => {
    const fetchImpl = reply(200, { accessToken: TOKEN, mode: 'test' });

    await asAgency(() => getAgencyDuffelCredentials({ fetchImpl }));
    await asAgency(() => getAgencyDuffelCredentials({ fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never hands one agency another agency's cached token", async () => {
    const other = '33333333-3333-4333-8333-333333333333';
    await asAgency(() => getAgencyDuffelCredentials({ fetchImpl: reply(200, { accessToken: TOKEN, mode: 'test' }) }));

    const account = await asAgency(() => getAgencyDuffelCredentials({ fetchImpl: reply(404) }), other);

    expect(account).toBeNull();
  });

  it('answers 503 when integration-service is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(asAgency(() => getAgencyDuffelCredentials({ fetchImpl }))).rejects.toMatchObject({ statusCode: 503 });
  });

  it('answers 503 when integration-service fails', async () => {
    await expect(asAgency(() => getAgencyDuffelCredentials({ fetchImpl: reply(500) }))).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('isLegacyDuffelTenant', () => {
  it("is Lushware's public-website agency by default", () => {
    expect(isLegacyDuffelTenant(DEMO_TENANT_ID)).toBe(true);
  });

  it('follows DUFFEL_LEGACY_TENANT_ID when set', () => {
    process.env.DUFFEL_LEGACY_TENANT_ID = AGENCY;

    expect(isLegacyDuffelTenant(AGENCY)).toBe(true);
    expect(isLegacyDuffelTenant(DEMO_TENANT_ID)).toBe(false);
  });

  it('is false for any other agency', () => {
    expect(isLegacyDuffelTenant(AGENCY)).toBe(false);
  });
});

describe('resolveFlightClient', () => {
  it("uses the agency's own Duffel account when connected", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_lushwaretoken99';
    vi.stubGlobal('fetch', reply(200, { accessToken: TOKEN, mode: 'test' }));

    const client = await asAgency(() => resolveFlightClient());

    expect(client).toBeInstanceOf(DuffelClient);
  });

  it("never gives another agency Lushware's Duffel account", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_lushwaretoken99';
    vi.stubGlobal('fetch', reply(404));

    const client = await asAgency(() => resolveFlightClient());

    expect(client).toBeInstanceOf(NotConnectedFlightClient);
  });

  it("gives Lushware's agency the system Duffel account when it has none of its own", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_lushwaretoken99';
    vi.stubGlobal('fetch', reply(404));

    const client = await asAgency(() => resolveFlightClient(), DEMO_TENANT_ID);

    expect(client).toBeInstanceOf(DuffelClient);
  });

  it('never shows pretend flights in development when no real provider is configured', async () => {
    process.env.NODE_ENV = 'development';
    vi.stubGlobal('fetch', reply(404));

    const client = await asAgency(() => resolveFlightClient());

    expect(client).toBeInstanceOf(NotConnectedFlightClient);
  });

  it("asks Lushware's agency to connect Duffel when it has no token at all", async () => {
    process.env.NODE_ENV = 'development';
    vi.stubGlobal('fetch', reply(404));

    const client = await asAgency(() => resolveFlightClient(), DEMO_TENANT_ID);

    expect(client).toBeInstanceOf(NotConnectedFlightClient);
  });

  it('uses the mock only inside the automated tests', async () => {
    process.env.NODE_ENV = 'test';
    process.env.FLIGHT_PROVIDER = 'mock';

    const client = await asAgency(() => resolveFlightClient());

    expect(client).toBeInstanceOf(MockFlightClient);
  });

  it("keeps Lushware's agency on its own account when the lookup fails", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_lushwaretoken99';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const client = await asAgency(() => resolveFlightClient(), DEMO_TENANT_ID);

    expect(client).toBeInstanceOf(DuffelClient);
  });

  it("gives another agency an error, not Lushware's account, when the lookup fails", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_lushwaretoken99';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(asAgency(() => resolveFlightClient())).rejects.toMatchObject({ statusCode: 503 });
  });

  it('never falls back to the mock in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.stubGlobal('fetch', reply(404));

    const client = await asAgency(() => resolveFlightClient());

    expect(client).toBeInstanceOf(NotConnectedFlightClient);
  });
});

describe('NotConnectedFlightClient', () => {
  it('tells the agency to connect Duffel instead of searching', () => {
    expect(() => new NotConnectedFlightClient().searchFlights({})).toThrow(/Connect your agency's Duffel account/);
  });

  it('answers 409 FLIGHTS_NOT_CONNECTED', () => {
    try {
      new NotConnectedFlightClient().createOrder({});
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 409, code: 'FLIGHTS_NOT_CONNECTED' });
      return;
    }
    throw new Error('expected a refusal');
  });
});

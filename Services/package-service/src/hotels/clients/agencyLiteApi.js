import { createTenantCache, getTenantId } from '../../../../shared/tenancy/src/index.js';
import { DEMO_TENANT_ID } from '../../../../shared/constants/src/index.js';
import { cloudRunAuthHeader } from '../../services/cloudRunAuth.js';
import AppError from '../../utils/appError.js';
import logger from '../../config/logger.js';

// Each agency searches and books hotels on its own LiteAPI account, connected in Settings >
// Integrations and stored encrypted by integration-service. Lushware's own key (LITEAPI_API_KEY)
// is only ever used for Lushware's agency; another agency never falls back to it, because its
// bookings would be paid by Lushware's account.

// Short, so a newly connected or disconnected account takes effect within seconds.
const CACHE_MS = 30_000;
const cache = createTenantCache({ ttlMs: CACHE_MS });

export const HOTELS_UNAVAILABLE = 'Hotels are temporarily unavailable. Please try again in a minute.';

/**
 * The current agency's LiteAPI credentials { apiKey, mode }, or null when it has not connected
 * LiteAPI. Throws 503 when integration-service can't be reached; never guesses.
 */
export async function getAgencyLiteApiCredentials({ fetchImpl = fetch } = {}) {
  const cached = cache.get();
  if (cached !== undefined) return cached;

  const base = process.env.INTEGRATION_SERVICE_URL
    || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3015');
  if (!base) {
    logger.error('INTEGRATION_SERVICE_URL is not set; agency LiteAPI accounts cannot be read');
    throw new AppError(HOTELS_UNAVAILABLE, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
  }
  const url = `${base.replace(/\/$/, '')}/api/v1/integrations/internal/liteapi/credentials`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
        // installTenantFetch adds x-tenant-id; set it here too so a direct call is never agency-less.
        'x-tenant-id': getTenantId() || '',
        ...(await cloudRunAuthHeader(url)),
      },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    logger.error({ err: { message: error.message } }, 'integration-service unreachable for LiteAPI credentials');
    throw new AppError(HOTELS_UNAVAILABLE, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
  }

  if (response.status === 404) {
    cache.set(null);
    return null;
  }
  if (!response.ok) {
    logger.error({ status: response.status }, 'integration-service refused the LiteAPI credentials request');
    throw new AppError(HOTELS_UNAVAILABLE, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
  }
  const { data } = await response.json();
  if (typeof data?.apiKey !== 'string' || !/^(sand|prod)_/.test(data.apiKey)) {
    logger.error('integration-service returned no usable LiteAPI key');
    throw new AppError(HOTELS_UNAVAILABLE, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
  }
  const credentials = { apiKey: data.apiKey, mode: data.mode };
  cache.set(credentials);
  return credentials;
}

/** Lushware's own agency: LITEAPI_LEGACY_TENANT_ID, else the public-website agency, as elsewhere. */
export const legacyLiteApiTenantId = () =>
  process.env.LITEAPI_LEGACY_TENANT_ID || process.env.PUBLIC_SITE_TENANT_ID || DEMO_TENANT_ID;

export const isLegacyLiteApiTenant = (tenantId = getTenantId()) =>
  Boolean(tenantId && tenantId === legacyLiteApiTenantId());

export const clearAgencyLiteApiCache = () => cache.clear();

import { cloudRunAuthHeader } from '../services/cloudRunAuth.js';
import AppError from '../utils/appError.js';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;

let cache = null; // { value, expiresAt }

/** Settings pricing for leads: meal prices, seats per vehicle, people per room, tax rate. */
function toLinePricing(pricingDefaults, settings = {}) {
  const vehicleSeats = Object.fromEntries(
    Object.entries(pricingDefaults?.transportRates || {})
      .filter(([, rates]) => Number(rates?.seats) > 0)
      .map(([mode, rates]) => [mode, Number(rates.seats)]),
  );
  return {
    mealPrices: pricingDefaults?.mealPrices || undefined,
    vehicleSeats: Object.keys(vehicleSeats).length ? vehicleSeats : undefined,
    peoplePerRoom: Number(pricingDefaults?.peoplePerRoom) >= 1 ? Number(pricingDefaults.peoplePerRoom) : undefined,
    taxRate: Number(settings?.defaultTaxRate) || 0,
  };
}

/**
 * The agency's Settings pricing, cached. Prices are never invented: when
 * user-service can't be reached and nothing was read recently, this throws (503).
 */
export async function getLinePricing({ fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  try {
    const res = await fetchImpl(`${USER_SERVICE_URL}/api/v1/admin/internal/organization-settings`, {
      headers: { 'x-internal-token': INTERNAL_SERVICE_KEY, ...(await cloudRunAuthHeader(USER_SERVICE_URL)) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`user-service returned ${res.status}`);
    const body = await res.json();
    const value = toLinePricing(body?.data?.settings?.pricingDefaults, body?.data?.settings);
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch {
    if (cache) return cache.value;
    throw new AppError('Pricing settings could not be loaded. Please try again in a moment.', 503);
  }
}

/** Test-only: clear the module-level cache between test cases. */
export function _resetCache() {
  cache = null;
}

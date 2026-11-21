import { z } from 'zod';

// An agency's own LiteAPI account (hotel search and booking). Bookings are paid by that
// account's own payment method, never Lushware's.

const LITEAPI_DATA_URL = 'https://api.liteapi.travel/v3.0';
const TIMEOUT_MS = 10_000;

// LiteAPI keys start with sand_ (sandbox) or prod_ (live).
export const liteApiKeySchema = z.object({
  apiKey: z.string().trim().regex(/^(sand|prod)_[A-Za-z0-9-]{8,200}$/),
}).strict();

/** 'test' or 'live', from the key's own prefix. */
export const liteApiModeOf = (apiKey) => (apiKey.startsWith('prod_') ? 'live' : 'test');

/** Throws unless LiteAPI accepts the key. Lists countries, the cheapest call any key may make. */
export async function verifyLiteApiKey(apiKey, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${LITEAPI_DATA_URL}/data/countries`, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`LiteAPI GET /data/countries returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
}

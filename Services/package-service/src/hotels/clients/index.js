import { MockHotelClient } from './mock.client.js';
import { LiteApiClient } from './liteapi.client.js';
import { getAgencyLiteApiCredentials, isLegacyLiteApiTenant } from './agencyLiteApi.js';
import AppError from '../../utils/appError.js';
import { SERVICE_UNAVAILABLE } from '../../constants/httpStatus.js';
import { HOTELS_NOT_CONFIGURED } from '../../constants/errorMessages.js';

export const LITEAPI_NOT_CONNECTED =
  "Connect your agency's LiteAPI account in Settings > Integrations to search and book hotels.";

/**
 * Lushware's own system-wide hotel client (its own agency only).
 *
 * 1. LITEAPI_API_KEY set → LiteApiClient (real API)
 * 2. LITEAPI_MOCK_MODE='true' → MockHotelClient
 *
 * @returns {import('./interface.js').HotelApiClient}
 */
export function createHotelClient() {
  if (process.env.LITEAPI_API_KEY) {
    return new LiteApiClient();
  }

  if (process.env.LITEAPI_MOCK_MODE === 'true') {
    return new MockHotelClient();
  }

  throw new AppError(HOTELS_NOT_CONFIGURED, SERVICE_UNAVAILABLE, { code: 'PROVIDER_UNAVAILABLE' });
}

/** Stands in for an agency with no hotel account: every call explains how to connect one. */
export class NotConnectedHotelClient {
  #refuse() {
    throw new AppError(LITEAPI_NOT_CONNECTED, 409, { code: 'HOTELS_NOT_CONNECTED' });
  }

  searchHotels() { return this.#refuse(); }
  getHotelDetails() { return this.#refuse(); }
  getHotelReviews() { return this.#refuse(); }
  getCities() { return this.#refuse(); }
  getCountries() { return this.#refuse(); }
  getEsimPackages() { return this.#refuse(); }
  getHotelFilterOptions() { return this.#refuse(); }
  prebook() { return this.#refuse(); }
  book() { return this.#refuse(); }
  listBookings() { return this.#refuse(); }
  getBooking() { return this.#refuse(); }
  cancelBooking() { return this.#refuse(); }
}

/**
 * The hotel client for the current agency:
 * 1. Its own connected LiteAPI account.
 * 2. Lushware's agency only: Lushware's system account (LITEAPI_API_KEY, or mock mode).
 * 3. Otherwise a client that asks the agency to connect LiteAPI.
 *
 * @returns {Promise<import('./interface.js').HotelApiClient>}
 */
export async function resolveHotelClient() {
  let account;
  try {
    account = await getAgencyLiteApiCredentials();
  } catch (error) {
    // Lushware's own account is Lushware's to use, so its agency keeps working if the lookup fails.
    // Any other agency gets the error: guessing would put its bookings on Lushware's account.
    if (isLegacyLiteApiTenant()) return createHotelClient();
    throw error;
  }
  if (account) return new LiteApiClient({ apiKey: account.apiKey });
  if (isLegacyLiteApiTenant()) return createHotelClient();
  return new NotConnectedHotelClient();
}

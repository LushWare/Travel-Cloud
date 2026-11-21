import { MockFlightClient } from './mock.client.js';
import { TravelportClient } from './travelport.client.js';
import { DuffelClient } from './duffel.client.js';
import { getAgencyDuffelCredentials, isLegacyDuffelTenant } from './agencyDuffel.js';
import AppError from '../utils/appError.js';

export const DUFFEL_NOT_CONNECTED =
  "Connect your agency's Duffel account in Settings > Integrations to search and book flights.";

// Pretend flights exist only for the automated tests. The app never shows them: an agency
// without a real provider is told to connect Duffel instead.
const mockAllowed = () => process.env.NODE_ENV === 'test' && process.env.FLIGHT_PROVIDER?.toLowerCase() === 'mock';

/**
 * Lushware's own system-wide flight client, or null when none is configured.
 * 1. DUFFEL_ACCESS_TOKEN set → DuffelClient
 * 2. FLIGHT_PROVIDER=travelport, or TRAVELPORT_MOCK_MODE=false → TravelportClient
 * (FLIGHT_PROVIDER=mock → MockFlightClient, automated tests only.)
 *
 * @returns {import('./interface.js').FlightApiClient | null}
 */
export function createFlightClient() {
  if (mockAllowed()) return new MockFlightClient();
  const provider = process.env.FLIGHT_PROVIDER?.toLowerCase();
  if (provider === 'duffel' || process.env.DUFFEL_ACCESS_TOKEN) return new DuffelClient();
  if (provider === 'travelport' || process.env.TRAVELPORT_MOCK_MODE === 'false') return new TravelportClient();
  return null;
}

/** Stands in for an agency with no flight account: every call explains how to connect one. */
export class NotConnectedFlightClient {
  #refuse() {
    throw new AppError(DUFFEL_NOT_CONNECTED, 409, { code: 'FLIGHTS_NOT_CONNECTED' });
  }

  searchFlights() { return this.#refuse(); }
  priceOffer() { return this.#refuse(); }
  getCheckoutData() { return this.#refuse(); }
  createOrder() { return this.#refuse(); }
  getOrder() { return this.#refuse(); }
  cancelOrder() { return this.#refuse(); }
  createCancellationQuote() { return this.#refuse(); }
  confirmCancellation() { return this.#refuse(); }
  createLinksSession() { return this.#refuse(); }
}

/** Lushware's system client for its own agency, or "connect Duffel" when none is configured. */
const legacyClient = () => createFlightClient() ?? new NotConnectedFlightClient();

/**
 * The flight client for the current agency, always a real provider:
 * 1. Its own connected Duffel account.
 * 2. Lushware's agency only: Lushware's system account (DUFFEL_ACCESS_TOKEN).
 * 3. Otherwise a client that asks the agency to connect Duffel.
 *
 * @returns {Promise<import('./interface.js').FlightApiClient>}
 */
export async function resolveFlightClient() {
  if (mockAllowed()) return new MockFlightClient();

  let account;
  try {
    account = await getAgencyDuffelCredentials();
  } catch (error) {
    // Lushware's own account is Lushware's to use, so its agency keeps working if the lookup fails.
    // Any other agency gets the error: guessing would put its tickets on Lushware's balance.
    if (isLegacyDuffelTenant()) return legacyClient();
    throw error;
  }
  if (account) return new DuffelClient({ accessToken: account.accessToken, cardCheckoutEnabled: false });
  if (isLegacyDuffelTenant()) return legacyClient();
  return new NotConnectedFlightClient();
}

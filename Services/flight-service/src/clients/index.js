import { MockFlightClient } from './mock.client.js';
import { TravelportClient } from './travelport.client.js';
import { DuffelClient } from './duffel.client.js';
import logger from '../config/logger.js';

/**
 * Create the configured flight API client.
 *
 * Provider selection order:
 * 1. If DUFFEL_ACCESS_TOKEN is set → DuffelClient (takes priority)
 * 2. If TRAVELPORT_MOCK_MODE is not 'false' → MockFlightClient (default for dev)
 * 3. Otherwise → TravelportClient (requires full Travelport env config)
 *
 * @returns {import('./interface.js').FlightApiClient}
 */
export function createFlightClient() {
  const provider = process.env.FLIGHT_PROVIDER?.toLowerCase();
  if (provider === 'mock') {
    return new MockFlightClient();
  }
  if (provider === 'travelport') {
    return new TravelportClient();
  }
  if (provider === 'duffel') {
    return new DuffelClient();
  }

  // Duffel takes priority if configured (token-based, simpler setup)
  if (process.env.DUFFEL_ACCESS_TOKEN) {
    return new DuffelClient();
  }

  const useMock = process.env.TRAVELPORT_MOCK_MODE !== 'false';

  if (useMock) {
    return new MockFlightClient();
  }

  return new TravelportClient();
}

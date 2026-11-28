import { MockFlightClient } from './mock.client.js';
import { TravelportClient } from './travelport.client.js';
import { DuffelClient } from './duffel.client.js';
import logger from '../config/logger.js';
import AppError from '../utils/appError.js';

/**
 * Create the configured flight API client.
 *
 * Provider selection order:
 * 1. FLIGHT_PROVIDER names one explicitly (mock | travelport | duffel)
 * 2. DUFFEL_ACCESS_TOKEN set → DuffelClient
 * 3. TRAVELPORT_MOCK_MODE='true' → MockFlightClient (local testing only, made-up fares)
 * 4. TRAVELPORT_MOCK_MODE='false' → TravelportClient
 * 5. Otherwise → 503: fares are never invented by default.
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

  if (process.env.TRAVELPORT_MOCK_MODE === 'true') {
    return new MockFlightClient();
  }
  if (process.env.TRAVELPORT_MOCK_MODE === 'false') {
    return new TravelportClient();
  }

  throw new AppError('Flight search is not configured. Set DUFFEL_ACCESS_TOKEN.', 503);
}

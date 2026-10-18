import { MockHotelClient } from './mock.client.js';
import { LiteApiClient } from './liteapi.client.js';
import AppError from '../../utils/appError.js';
import { SERVICE_UNAVAILABLE } from '../../constants/httpStatus.js';
import { HOTELS_NOT_CONFIGURED } from '../../constants/errorMessages.js';

/**
 * Create the configured hotel API client.
 *
 * Provider selection:
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

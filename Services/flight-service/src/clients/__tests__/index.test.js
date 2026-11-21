import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createFlightClient } from '../index.js';
import { MockFlightClient } from '../mock.client.js';
import { TravelportClient } from '../travelport.client.js';
import { DuffelClient } from '../duffel.client.js';

describe('createFlightClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DUFFEL_ACCESS_TOKEN;
    delete process.env.TRAVELPORT_MOCK_MODE;
    delete process.env.FLIGHT_PROVIDER;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns no client when no real provider is configured, instead of pretend flights', () => {
    expect(createFlightClient()).toBeNull();
  });

  it('returns no client in mock mode outside the automated tests', () => {
    process.env.FLIGHT_PROVIDER = 'mock';
    process.env.NODE_ENV = 'development';

    expect(createFlightClient()).toBeNull();
  });

  it('returns no client when TRAVELPORT_MOCK_MODE is true', () => {
    process.env.TRAVELPORT_MOCK_MODE = 'true';

    expect(createFlightClient()).toBeNull();
  });

  it('allows the mock only for the automated tests', () => {
    process.env.FLIGHT_PROVIDER = 'mock';
    process.env.NODE_ENV = 'test';

    expect(createFlightClient()).toBeInstanceOf(MockFlightClient);
  });

  it('returns TravelportClient when TRAVELPORT_MOCK_MODE is "false"', () => {
    process.env.TRAVELPORT_MOCK_MODE = 'false';

    expect(createFlightClient()).toBeInstanceOf(TravelportClient);
  });

  it('returns DuffelClient when DUFFEL_ACCESS_TOKEN is set (takes priority)', () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_12345';
    process.env.TRAVELPORT_MOCK_MODE = 'false';

    expect(createFlightClient()).toBeInstanceOf(DuffelClient);
  });
});

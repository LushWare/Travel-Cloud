import { describe, it, expect, afterEach } from 'vitest';
import { createFlightClient } from '../index.js';
import { MockFlightClient } from '../mock.client.js';
import { TravelportClient } from '../travelport.client.js';
import { DuffelClient } from '../duffel.client.js';

describe('createFlightClient', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to search with made-up fares when no provider is configured', () => {
    delete process.env.DUFFEL_ACCESS_TOKEN;
    delete process.env.TRAVELPORT_MOCK_MODE;
    delete process.env.FLIGHT_PROVIDER;
    expect(() => createFlightClient()).toThrow('Flight search is not configured');
  });

  it('should return MockFlightClient when TRAVELPORT_MOCK_MODE is true', () => {
    delete process.env.DUFFEL_ACCESS_TOKEN;
    process.env.TRAVELPORT_MOCK_MODE = 'true';
    const client = createFlightClient();
    expect(client).toBeInstanceOf(MockFlightClient);
  });

  it('should return TravelportClient when TRAVELPORT_MOCK_MODE is "false"', () => {
    delete process.env.DUFFEL_ACCESS_TOKEN;
    process.env.TRAVELPORT_MOCK_MODE = 'false';
    const client = createFlightClient();
    expect(client).toBeInstanceOf(TravelportClient);
  });

  it('should return DuffelClient when DUFFEL_ACCESS_TOKEN is set (takes priority)', () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_12345';
    process.env.TRAVELPORT_MOCK_MODE = 'false'; // would be Travelport, but Duffel wins
    const client = createFlightClient();
    expect(client).toBeInstanceOf(DuffelClient);
  });

  it('should return DuffelClient even when mock mode is on (Duffel has priority)', () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_12345';
    process.env.TRAVELPORT_MOCK_MODE = 'true';
    const client = createFlightClient();
    expect(client).toBeInstanceOf(DuffelClient);
  });
});

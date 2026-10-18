import { describe, it, expect, afterEach } from 'vitest';
import { createHotelClient } from '../index.js';
import { MockHotelClient } from '../mock.client.js';
import { LiteApiClient } from '../liteapi.client.js';

describe('createHotelClient', () => {
  const orig = { ...process.env };

  afterEach(() => { process.env = { ...orig }; });

  it('should fail when no hotel provider is configured', () => {
    delete process.env.LITEAPI_API_KEY;
    delete process.env.LITEAPI_MOCK_MODE;
    expect(() => createHotelClient()).toThrow('Hotel search is temporarily unavailable. Please try again in a moment.');
  });

  it('should return LiteApiClient when LITEAPI_API_KEY is set', () => {
    process.env.LITEAPI_API_KEY = 'test-key';
    delete process.env.LITEAPI_MOCK_MODE;
    expect(createHotelClient()).toBeInstanceOf(LiteApiClient);
  });

  it('should return MockHotelClient when mock mode is explicitly true', () => {
    delete process.env.LITEAPI_API_KEY;
    process.env.LITEAPI_MOCK_MODE = 'true';
    expect(createHotelClient()).toBeInstanceOf(MockHotelClient);
  });
});

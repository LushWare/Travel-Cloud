import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  storeOptions: [],
}));

vi.mock('redis', () => ({ createClient: mocks.createClient }));
vi.mock('rate-limit-redis', () => ({
  RedisStore: class {
    constructor(options) {
      mocks.storeOptions.push(options);
    }
  },
}));

import { createRateLimitStores } from '../rateLimitStore.js';

describe('createRateLimitStores', () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.storeOptions.length = 0;
  });

  it('uses process-local stores outside production when Redis is not configured', async () => {
    const log = { warn: vi.fn(), error: vi.fn() };

    await expect(createRateLimitStores({ redisUrl: '', env: 'development', log })).resolves.toBeNull();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('refuses production startup when Redis is not configured', async () => {
    await expect(createRateLimitStores({ redisUrl: '', env: 'production' }))
      .rejects.toThrow('REDIS_URL is required in production');
  });

  it('creates a connected Redis store with a separate namespace for each limiter', async () => {
    const client = {
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn().mockResolvedValue('OK'),
    };
    const log = { warn: vi.fn(), error: vi.fn() };
    mocks.createClient.mockReturnValue(client);

    const stores = await createRateLimitStores({
      redisUrl: 'redis://redis.example.test:6379',
      env: 'production',
      log,
    });

    expect(client.connect).toHaveBeenCalledOnce();
    expect(Object.keys(stores)).toEqual([
      'global', 'auth', 'ai-itinerary-preview', 'itinerary-chat', 'recommendations', 'platform-login',
    ]);
    expect(mocks.storeOptions.map(({ prefix }) => prefix)).toEqual([
      'travel-crm:production:rate-limit:global:',
      'travel-crm:production:rate-limit:auth:',
      'travel-crm:production:rate-limit:ai-itinerary-preview:',
      'travel-crm:production:rate-limit:itinerary-chat:',
      'travel-crm:production:rate-limit:recommendations:',
      'travel-crm:production:rate-limit:platform-login:',
    ]);

    await mocks.storeOptions[0].sendCommand('GET', 'key');
    expect(client.sendCommand).toHaveBeenCalledWith(['GET', 'key']);
  });

  it('fails startup if Redis cannot connect', async () => {
    mocks.createClient.mockReturnValue({
      on: vi.fn(),
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
    });

    await expect(createRateLimitStores({
      redisUrl: 'redis://redis.example.test:6379',
      env: 'production',
    })).rejects.toThrow('connection refused');
  });
});

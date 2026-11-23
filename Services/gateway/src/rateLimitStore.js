import { createClient } from 'redis';
import { RedisStore } from 'rate-limit-redis';
import logger from './config/logger.js';

const LIMITER_NAMES = [
  'global',
  'auth',
  'ai-itinerary-preview',
  'itinerary-chat',
  'recommendations',
  'platform-login',
];

export async function createRateLimitStores({
  redisUrl = process.env.REDIS_URL,
  env = process.env.NODE_ENV,
  log = logger,
} = {}) {
  if (!redisUrl) {
    // Without Redis each gateway instance counts on its own, so a limit is per instance
    // rather than shared. That is weaker, but refusing to start would take the whole API down.
    if (env === 'production') {
      log.error('REDIS_URL is unset in production; gateway rate limits are per instance, not shared');
    } else if (env !== 'test') {
      log.warn('REDIS_URL is unset; gateway rate limits are process-local');
    }
    return null;
  }

  const client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    log.error({ err: { message: err.message, code: err.code } }, 'Rate-limit Redis client error');
  });
  await client.connect();

  const sendCommand = (...args) => client.sendCommand(args);
  const environment = env || 'development';
  return Object.fromEntries(LIMITER_NAMES.map((name) => [
    name,
    new RedisStore({
      prefix: `travel-crm:${environment}:rate-limit:${name}:`,
      sendCommand,
    }),
  ]));
}

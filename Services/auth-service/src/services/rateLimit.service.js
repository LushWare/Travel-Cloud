import crypto from 'node:crypto';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const CLEANUP_PROBABILITY = 0.01;

// Emails and IPs are stored only as hashes.
const keyFor = (scope, value) =>
  `${scope}:${crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex')}`;

/**
 * Counts one attempt in a fixed window shared by every instance (one atomic upsert).
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
export async function hit(scope, value, { limit, windowSeconds }) {
  const key = keyFor(scope, value);
  const rows = await prisma.$queryRaw`
    INSERT INTO "crm_auth"."RateLimit" ("key", "hits", "resetAt")
    VALUES (${key}, 1, now() + ${windowSeconds}::int * interval '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."hits" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= now()
                       THEN now() + ${windowSeconds}::int * interval '1 second'
                       ELSE "RateLimit"."resetAt" END
    RETURNING "hits", "resetAt"`;

  if (Math.random() < CLEANUP_PROBABILITY) {
    prisma.$executeRaw`DELETE FROM "crm_auth"."RateLimit" WHERE "resetAt" < now() - interval '1 hour'`
      .catch((err) => logger.warn({ err: { message: err.message } }, 'Rate limit cleanup failed'));
  }

  const { hits, resetAt } = rows[0];
  return {
    allowed: hits <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000)),
  };
}

export async function clear(scope, value) {
  await prisma.$executeRaw`DELETE FROM "crm_auth"."RateLimit" WHERE "key" = ${keyFor(scope, value)}`;
}

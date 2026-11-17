import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import logger from '../src/config/logger.js';
import { runHealthChecks } from '../src/healthChecks.js';

/**
 * Daily check of every agency's connected email, WhatsApp, Facebook and Stripe accounts
 * (`npm run integrations:health`). Needs the admin connection, because it reads every agency:
 * HEALTH_CHECK_DATABASE_URL, else DIRECT_URL. Exits 1 if any check could not be recorded.
 */
export async function run() {
  const connectionString = process.env.HEALTH_CHECK_DATABASE_URL || process.env.DIRECT_URL;
  if (!connectionString) throw new Error('HEALTH_CHECK_DATABASE_URL or DIRECT_URL must be set to the admin database connection.');
  const pool = new pg.Pool({ connectionString, max: 2 });
  try {
    const totals = await runHealthChecks({ pool, logger });
    logger.info(totals, 'Integration health checks finished');
    return totals;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run()
    .then(({ crashed }) => { process.exitCode = crashed ? 1 : 0; })
    .catch((error) => { logger.error({ err: { message: error.message } }, 'Integration health checks failed'); process.exitCode = 1; });
}

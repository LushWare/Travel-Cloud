import 'dotenv/config';
import app from './app.js';
import logger from './config/logger.js';
import pool from './db/pool.js';
import { loadKey } from './security/secretBox.js';
import { issueChallenge } from './security/tokens.js';

// Refuse to start half-configured rather than fail on the first sign-in.
for (const name of ['DATABASE_URL', 'PLATFORM_TOTP_KEY', 'PLATFORM_CHALLENGE_SECRET']) {
  if (!process.env[name]) {
    logger.fatal({ variable: name }, 'platform-service is missing a required setting; run `npm run init-env`');
    process.exit(1);
  }
}
loadKey();
issueChallenge('startup-check');

const PORT = process.env.PORT || 3014;
app.listen(PORT, '0.0.0.0', () => logger.info({ port: PORT }, 'platform-service started'));

const shutdown = () => pool.end().finally(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

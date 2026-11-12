// Creates local platform-service settings, or syncs notification email settings into an existing file.
//   cd Services/platform-service && npm run init-env
import crypto from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(HERE, '..', '.env');
const source = path.join(HERE, '..', '..', 'auth-service', '.env');
const notificationSource = path.join(HERE, '..', '..', 'notification-service', '.env');
const notificationEnv = existsSync(notificationSource) ? readFileSync(notificationSource, 'utf8') : '';
const internalToken = notificationEnv.match(/^INTERNAL_EVENTS_TOKEN=.*$/m)?.[0];

if (existsSync(target)) {
  if (!process.argv.includes('--sync-email')) {
    console.error('platform-service/.env already exists; use --sync-email to add email settings without replacing it.');
    process.exit(1);
  }
  if (!internalToken) {
    console.error('notification-service/.env must contain INTERNAL_EVENTS_TOKEN before email settings can be synced.');
    process.exit(1);
  }
  const existing = readFileSync(target, 'utf8');
  const additions = [
    ['INTERNAL_EVENTS_TOKEN', internalToken],
    ['NOTIFICATION_SERVICE_URL', 'NOTIFICATION_SERVICE_URL=http://localhost:3008'],
    ['PLATFORM_CONSOLE_URL', 'PLATFORM_CONSOLE_URL=http://localhost:5175'],
  ].filter(([key]) => !new RegExp(`^${key}=`, 'm').test(existing)).map(([, line]) => line);
  if (additions.length) writeFileSync(target, `${existing.replace(/\s*$/, '')}\n${additions.join('\n')}\n`, { mode: 0o600 });
  console.log('Synced missing platform staff email settings. Secret values were not printed.');
  process.exit(0);
}
if (!existsSync(source)) {
  console.error('auth-service/.env not found; it holds the admin database connection to copy.');
  process.exit(1);
}

const authEnv = readFileSync(source, 'utf8');
const line = (key) => authEnv.match(new RegExp(`^${key}=.*$`, 'm'))?.[0];
const databaseUrl = line('DATABASE_URL');
if (!databaseUrl) {
  console.error('auth-service/.env has no DATABASE_URL.');
  process.exit(1);
}
writeFileSync(target, [
  '# platform-service (Lushware console). Admin database connection: never use crm_app here.',
  'PORT=3014',
  databaseUrl,
  'NOTIFICATION_SERVICE_URL=http://localhost:3008',
  'PLATFORM_CONSOLE_URL=http://localhost:5175',
  ...(internalToken ? [internalToken] : []),
  `PLATFORM_TOTP_KEY=${crypto.randomBytes(32).toString('base64')}`,
  `PLATFORM_CHALLENGE_SECRET=${crypto.randomBytes(48).toString('base64url')}`,
  '',
].join('\n'), { mode: 0o600 });

console.log('Created platform-service/.env (database connection copied, two new secrets generated).');
if (!internalToken) console.warn('Set INTERNAL_EVENTS_TOKEN to the same value as notification-service before sending staff invitations.');

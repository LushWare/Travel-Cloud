// ═══════════════════════════════════════════════════════════════════════════════
// CI env provisioner — materialise every service's .env for a disposable stack
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//   There is no root workspace and every service loads its own .env via
//   `dotenv/config`. Those files are gitignored, so a CI runner has none of them
//   and the stack cannot start. This script copies each checked-in
//   `.env.example` to `.env` and then FORCES the handful of values that must not
//   come from an example file, because getting them wrong fails in a way that is
//   hard to read:
//
//     DATABASE_URL / DIRECT_URL   must point at the CI Postgres, not Supabase.
//                                 The examples carry a Supabase pooler DSN with
//                                 `?pgbouncer=true`, which a local Postgres
//                                 rejects.
//     *_SERVICE_URL               must stay on localhost: they are how the 12
//                                 processes find each other.
//     MANAGEMENT_COPILOT_ENABLED  must be 'true' on assistant-service, or the
//                                 copilot routes answer 404 and every spec fails
//                                 with "the panel never rendered".
//     VITE_MANAGEMENT_COPILOT_ENABLED must be 'true' for the Management build:
//                                 it is a BUILD-TIME gate, so without it the
//                                 panel is not in the bundle at all and no amount
//                                 of server configuration brings it back.
//
// SAFETY
//   Overwriting a developer's .env clobbers working local configuration, so this
//   refuses to write unless run in CI or explicitly forced. `--dry-run` prints
//   the plan and touches nothing, which is also how it is tested.
//
// USAGE
//   node Services/provision-ci-env.mjs --dry-run          # print the plan
//   CI=true node Services/provision-ci-env.mjs            # write, in CI
//   node Services/provision-ci-env.mjs --force            # write, deliberately

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { envQuoted, generateLoginKeyPair } from './create-login-keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// Every directory that carries its own .env.example and therefore needs a .env.
export function targetDirs(repoRoot = REPO) {
  const dirs = [];
  const services = path.join(repoRoot, 'Services');
  for (const entry of readdirSync(services, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(path.join(services, entry.name, '.env.example'))) {
      dirs.push(path.join('Services', entry.name));
    }
  }
  for (const app of ['Client', 'Management']) {
    if (existsSync(path.join(repoRoot, app, '.env.example'))) dirs.push(app);
  }
  return dirs;
}

// Clearly a placeholder, so a dry-run plan can be read without implying anyone
// connected to anything.
export const PLACEHOLDER_DSN = 'postgresql://ci-placeholder:ci-placeholder@127.0.0.1:5432/ci-placeholder';

/**
 * DSN for the CI Postgres, with no pooler parameters. `allowPlaceholder` exists
 * for `--dry-run`, which must print a plan on a machine with no database at all.
 */
export function ciDatabaseUrl({ databaseUrl, allowPlaceholder = false } = {}) {
  const url = databaseUrl ?? process.env.CI_DATABASE_URL ?? process.env.DATABASE_URL;
  if (url) return url;
  if (allowPlaceholder) return PLACEHOLDER_DSN;
  throw new Error('No database URL: set CI_DATABASE_URL (the disposable CI Postgres) before running this.');
}

/**
 * Force one KEY=value into a dotenv-format file body, replacing an existing line
 * (commented or not) or appending one. Pure, so it is unit-tested.
 */
export function forceEnvValue(body, key, value) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${key}=${value}`;
  const active = new RegExp(`^\\s*${escaped}\\s*=.*$`, 'm');
  const commented = new RegExp(`^\\s*#\\s*${escaped}\\s*=.*$`, 'm');

  if (active.test(body)) return body.replace(active, line);
  if (commented.test(body)) return body.replace(commented, line);
  return `${body.replace(/\s*$/, '')}\n${line}\n`;
}

/**
 * The values that must not come from an example, per directory. Keys are
 * repo-relative directory names.
 */
export function forcedValues({ databaseUrl, allowPlaceholder = false, keyPair = generateLoginKeyPair() } = {}) {
  const dsn = ciDatabaseUrl({ databaseUrl, allowPlaceholder });
  const shared = { DATABASE_URL: dsn, DIRECT_URL: dsn };
  return {
    __allServices: shared,
    // A fresh login key pair per run: auth-service will not start without one.
    'Services/auth-service': { ...shared, JWT_PRIVATE_KEY: envQuoted(keyPair.privatePem) },
    'Services/gateway': { ...shared, JWT_PUBLIC_KEYS: envQuoted(keyPair.publicPem) },
    'Services/assistant-service': { ...shared, MANAGEMENT_COPILOT_ENABLED: 'true' },
    Management: { VITE_MANAGEMENT_COPILOT_ENABLED: 'true' },
    // On a disposable database the shared-DB opt-in is not a hazard: it is the
    // flag the E2E suite requires before it will touch anything, and CI's
    // database is thrown away at the end of the job.
    'Services/e2e-tests': { E2E_I_UNDERSTAND_SHARED_DB: 'true' },
  };
}

export function plan({ repoRoot = REPO, databaseUrl, allowPlaceholder = false } = {}) {
  const forced = forcedValues({ databaseUrl, allowPlaceholder });
  return targetDirs(repoRoot).map((dir) => {
    const example = path.join(repoRoot, dir, '.env.example');
    const target = path.join(repoRoot, dir, '.env');
    const isService = dir.startsWith('Services/') && !dir.endsWith('e2e-tests');
    const values = {
      ...(isService ? forced.__allServices : {}),
      ...(forced[dir] ?? {}),
    };
    // `hasExample` and `examplePath` are separate on purpose. This used to return
    // `example: existsSync(example)` while the writer fed the same field to
    // readFileSync — so the write path passed a BOOLEAN where a path belongs, and
    // only ever worked because --dry-run (the only mode that had been run) returns
    // before reading. A test now exercises the write path for real.
    return {
      dir,
      hasExample: existsSync(example),
      examplePath: example,
      target,
      values,
      replacesExisting: existsSync(target),
    };
  });
}

/**
 * Materialise each planned .env. Split out of `main` so a test can run the REAL
 * write path against a temporary repo root — the coverage whose absence let a
 * boolean-as-path bug reach CI.
 */
export function applyPlan(entries, { dryRun = false, log = console.log } = {}) {
  for (const entry of entries) {
    const keys = Object.keys(entry.values);
    log(
      `  ${entry.dir.padEnd(34)} ${keys.length ? `force ${keys.join(', ')}` : '(copy only)'}` +
        `${entry.replacesExisting && !dryRun ? ' [REPLACED]' : ''}`,
    );
    if (dryRun) continue;

    let body = readFileSync(entry.examplePath, 'utf8');
    for (const [key, value] of Object.entries(entry.values)) body = forceEnvValue(body, key, value);
    writeFileSync(entry.target, body);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const inCi = Boolean(process.env.CI);

  if (!dryRun && !force && !inCi) {
    console.error(
      '\n✗ Refusing to write: this overwrites .env files in the working tree.\n' +
        '  Files that already exist will be REPLACED from their .env.example.\n\n' +
        '  Print the plan instead:   node Services/provision-ci-env.mjs --dry-run\n' +
        '  Write deliberately:       node Services/provision-ci-env.mjs --force\n' +
        '  Normal path is CI only:   CI=true node Services/provision-ci-env.mjs\n',
    );
    process.exitCode = 1;
    return;
  }

  const entries = plan({ allowPlaceholder: dryRun });
  const missing = entries.filter((entry) => !entry.hasExample);
  if (missing.length > 0) {
    console.error(`✗ ${missing.length} directory has no .env.example, so no .env can be made: ${missing.map((m) => m.dir).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${dryRun ? 'DRY RUN — ' : ''}provisioning ${entries.length} .env file(s) from .env.example`);
  applyPlan(entries, { dryRun });
  if (dryRun) console.log('\nNothing was written.');
}

// pathToFileURL, not fileURLToPath or a hand-built file:// string: argv[1] is a
// filesystem path, and the hand-built version breaks on spaces.
const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();

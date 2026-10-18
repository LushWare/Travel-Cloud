/**
 * Runs `prisma migrate deploy` across every Prisma-backed microservice.
 *
 * All 10 services below share one physical Postgres database (same host,
 * same database — just a different `@@schema` namespace per service), so
 * Prisma's `_prisma_migrations` bookkeeping table is effectively shared
 * too: any service's `migrate status` will list every other service's
 * migration names alongside its own. That's expected — `migrate deploy`
 * only ever applies migrations declared in the service's own local
 * `prisma/migrations/` folder, so this script is safe to run repeatedly
 * (each service no-ops once nothing is pending).
 *
 * `prisma migrate dev` is intentionally never used here — it's an
 * interactive, reset-capable command meant for local development against
 * a disposable database, not a shared remote one. Use `db:migrate` inside
 * an individual service for local dev; use this script (or a service's
 * `db:migrate:deploy`) to apply pending migrations for real.
 *
 * Run from Services/: node migrate-all.mjs
 *
 * The schemas are created first. Prisma does not create a multi-schema
 * datasource's schemas: it expects them to exist. On the shared dev database they
 * always have, so nothing noticed that this script could not bootstrap an EMPTY
 * one — the first service whose schema was missing died with
 * `ERROR: schema "crm_packages" does not exist`, and the shared `_prisma_migrations`
 * bookkeeping then blocked every service after it with P3009.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Order matters only for readability of the log output — each service's
// migrations are independent (different schema, different migration
// names), so there's no cross-service dependency to sequence around.
/** The schemas a service's datasource declares, in declaration order. */
function declaredSchemas(schemaPath) {
  const source = readFileSync(schemaPath, 'utf8');
  const match = source.match(/schemas\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/**
 * Create this service's schemas if they are missing. Idempotent, so it is safe on
 * a database that already has them — which is every run but the first.
 */
function ensureSchemas(service, dir, schemaPath) {
  const schemas = declaredSchemas(schemaPath);
  if (schemas.length === 0) return true;

  const sql = schemas.map((name) => `CREATE SCHEMA IF NOT EXISTS "${name}";`).join('\n');
  const result = spawnSync(
    'npx',
    ['prisma', 'db', 'execute', '--stdin', '--schema', path.join('prisma', 'schema.prisma')],
    {
      cwd: dir,
      // stdin carries the SQL, so stdout/stderr stream straight to the console.
      input: `${sql}\n`,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    console.error(`✗ ${service}: could not create ${schemas.join(', ')} (exit ${result.status})`);
    return false;
  }
  console.log(`  schemas ready: ${schemas.join(', ')}`);
  return true;
}

const SERVICES = [
  'auth-service',
  'user-service',
  'package-service',
  'lead-service',
  'booking-service',
  'billing-service',
  'career-service',
  'flight-service',
  'assistant-service',
  'recommendation-service',
  'voice-service',
];

let failed = false;

for (const service of SERVICES) {
  const dir = path.join(__dirname, service);
  const schemaPath = path.join(dir, 'prisma', 'schema.prisma');
  if (!existsSync(schemaPath)) {
    console.log(`⏭  ${service}: no prisma/schema.prisma, skipping`);
    continue;
  }

  console.log(`\n→ ${service}`);
  if (!ensureSchemas(service, dir, schemaPath)) {
    failed = true;
    continue;
  }

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`✗ ${service}: migrate deploy failed (exit ${result.status})`);
  } else {
    console.log(`✓ ${service}: up to date`);
  }
}

if (failed) {
  console.error('\nOne or more services failed to migrate — see above.');
  process.exit(1);
}

console.log('\nAll services migrated successfully.');

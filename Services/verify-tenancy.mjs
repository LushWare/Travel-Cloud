// Checks the database is really split by agency (Phase 1 gate). Reads only; writes nothing.
//
//   DATABASE_URL=<admin url> node Services/verify-tenancy.mjs
//   DATABASE_URL=<admin url> CRM_APP_DATABASE_URL=<crm_app url> node Services/verify-tenancy.mjs
//
// 1. No row is missing its agency.
// 2. Every crm_* table holding agency data has row-level security switched on and forced.
// 3. (with CRM_APP_DATABASE_URL) the services' user cannot bypass it and sees nothing without an agency.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SERVICES, tenantTables } from './add-tenancy.mjs';
import { requireDatabaseUrl } from './database-url.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Global by design: one login account per person, and the agency list itself.
export const GLOBAL_TABLES = new Set(['crm_users.User', 'crm_platform.Tenant']);
// Login-only tables; reached by auth-service's admin user, never by crm_app.
const IGNORED_SCHEMAS = new Set(['crm_auth', 'crm_platform']);

export function expectedTables() {
  return SERVICES.flatMap((service) => tenantTables(
    readFileSync(path.join(HERE, service, 'prisma', 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n'),
  ));
}

/** Tables in the database that hold agency data but are not locked. */
export function unlockedTables(catalog) {
  return catalog
    .filter((t) => !IGNORED_SCHEMAS.has(t.schema) && !GLOBAL_TABLES.has(`${t.schema}.${t.table}`))
    .filter((t) => !t.rls || !t.forced || !t.hasPolicy)
    .map((t) => `${t.schema}.${t.table}`);
}

// Loaded only when run, so the pure helpers above can be tested without a database driver.
const loadPg = async () => (await import('./analytics-service/node_modules/pg/lib/index.js')).default;

async function main() {
  const pg = await loadPg();
  const failures = [];
  const admin = new pg.Pool({ connectionString: requireDatabaseUrl('verify-tenancy.mjs'), ssl: { rejectUnauthorized: false } });
  try {
    for (const { schema, table } of expectedTables()) {
      const { rows } = await admin.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}" WHERE "tenantId" IS NULL`);
      if (rows[0].n > 0) failures.push(`${schema}.${table}: ${rows[0].n} row(s) without an agency`);
    }

    const { rows: catalog } = await admin.query(`
      SELECT n.nspname AS schema, c.relname AS "table", c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                     AND p.policyname = 'tenant_isolation') AS "hasPolicy"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname LIKE 'crm\\_%'`);
    for (const t of unlockedTables(catalog)) failures.push(`${t}: row-level security is not fully on`);
  } finally {
    await admin.end();
  }

  if (process.env.CRM_APP_DATABASE_URL) {
    const app = new pg.Pool({ connectionString: process.env.CRM_APP_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
      const { rows } = await app.query('SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user');
      if (rows[0]?.bypass) failures.push('the services\' database user bypasses row-level security');
      const { rows: leads } = await app.query('SELECT count(*)::int AS n FROM crm_leads."Lead"');
      if (leads[0].n !== 0) failures.push(`without an agency the services' user still sees ${leads[0].n} lead(s)`);
    } finally {
      await app.end();
    }
  } else {
    console.log('(Set CRM_APP_DATABASE_URL to also check the services\' database user.)');
  }

  if (failures.length) {
    console.error(`✗ ${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ Every row has an agency and every agency table is locked.');
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  });
}

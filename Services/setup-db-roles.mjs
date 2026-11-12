// Creates the limited database user the services connect as (Phase 1, row-level security).
//
//   DATABASE_URL=<admin url> CRM_APP_DB_PASSWORD=<long random> node Services/setup-db-roles.mjs           # show the plan
//   DATABASE_URL=<admin url> CRM_APP_DB_PASSWORD=<long random> node Services/setup-db-roles.mjs --apply   # do it
//
// crm_app can read and write agency data but cannot switch row-level security off, so even a
// bug that forgets the agency filter cannot reach another agency's rows. Migrations and
// auth-service (which must find a person across agencies at login) keep the admin user.
// Safe to re-run: it creates the role once and re-applies the grants.

import { pathToFileURL } from 'node:url';
import { requireDatabaseUrl } from './database-url.mjs';

export const APP_ROLE = 'crm_app';

// Every schema whose tables the services use. crm_auth is login-only and stays with the admin user.
export const APP_SCHEMAS = [
  'crm_users', 'crm_packages', 'crm_leads', 'crm_bookings', 'crm_billing', 'crm_careers',
  'crm_flights', 'crm_assistant', 'crm_recommendations', 'crm_voice',
];

const SAFE_PASSWORD = /^[A-Za-z0-9_-]{32,128}$/;

export function roleSql(password) {
  if (!SAFE_PASSWORD.test(password || '')) {
    throw new Error('CRM_APP_DB_PASSWORD must be 32–128 characters of letters, digits, "-" or "_".');
  }
  const statements = [
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}';
  ELSE
    ALTER ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}';
  END IF;
END $$;`,
  ];
  for (const schema of APP_SCHEMAS) {
    statements.push(
      `GRANT USAGE ON SCHEMA ${schema} TO ${APP_ROLE};`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${APP_ROLE};`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${APP_ROLE};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
    );
  }
  // The agency list is read-only for the services; the audit log is add-and-read only.
  statements.push(
    `GRANT USAGE ON SCHEMA crm_platform TO ${APP_ROLE};`,
    `GRANT SELECT ON crm_platform."Tenant" TO ${APP_ROLE};`,
    `DO $$ BEGIN
  IF to_regclass('crm_platform."AuditLog"') IS NOT NULL THEN
    GRANT INSERT, SELECT ON crm_platform."AuditLog" TO ${APP_ROLE};
    REVOKE UPDATE, DELETE, TRUNCATE ON crm_platform."AuditLog" FROM ${APP_ROLE};
  END IF;
  IF to_regclass('crm_platform."Plan"') IS NOT NULL THEN
    GRANT SELECT ON crm_platform."Plan" TO ${APP_ROLE};
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_platform."Plan" FROM ${APP_ROLE};
  END IF;
  IF to_regclass('crm_platform."PlanVersion"') IS NOT NULL THEN
    GRANT SELECT ON crm_platform."PlanVersion" TO ${APP_ROLE};
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_platform."PlanVersion" FROM ${APP_ROLE};
  END IF;
  IF to_regclass('crm_platform."TenantPlan"') IS NOT NULL THEN
    GRANT SELECT ON crm_platform."TenantPlan" TO ${APP_ROLE};
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_platform."TenantPlan" FROM ${APP_ROLE};
  END IF;
  IF to_regclass('crm_platform."PlanEntitlementOverride"') IS NOT NULL THEN
    GRANT SELECT ON crm_platform."PlanEntitlementOverride" TO ${APP_ROLE};
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_platform."PlanEntitlementOverride" FROM ${APP_ROLE};
  END IF;
  IF to_regclass('crm_platform."UsageCounter"') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON crm_platform."UsageCounter" TO ${APP_ROLE};
    REVOKE DELETE, TRUNCATE ON crm_platform."UsageCounter" FROM ${APP_ROLE};
  END IF;
END $$;`,
  );
  return statements;
}

const redact = (sql) => sql.replace(/PASSWORD '[^']*'/g, "PASSWORD '***'");

// Loaded only when run, so the pure helpers above can be tested without a database driver.
const loadPg = async () => (await import('./analytics-service/node_modules/pg/lib/index.js')).default;

async function main() {
  const pg = await loadPg();
  const apply = process.argv.includes('--apply');
  const statements = roleSql(process.env.CRM_APP_DB_PASSWORD);
  const pool = new pg.Pool({ connectionString: requireDatabaseUrl('setup-db-roles.mjs'), ssl: { rejectUnauthorized: false } });
  try {
    const { rows } = await pool.query('SELECT current_user AS name, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user');
    const admin = rows[0];
    console.log(`Connected as ${admin.name} (bypasses row-level security: ${admin.bypass ? 'yes' : 'NO'})`);
    if (!admin.bypass) {
      console.error('\n✗ This user does not bypass row-level security. Migrations and auth-service login run as it, so');
      console.error('  enabling row-level security would hide every row from them. Use the database admin user.');
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log('\nPLAN (nothing written; add --apply to run):\n');
      statements.forEach((s) => console.log(redact(s)));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of statements) await client.query(s);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    console.log(`\n✓ ${APP_ROLE} is ready. Point every service except auth-service at it:`);
    console.log(`  DATABASE_URL=postgresql://${APP_ROLE}.<project-ref>:<password>@<pooler-host>:6543/postgres?pgbouncer=true`);
    console.log('  Keep DIRECT_URL (migrations) and auth-service on the admin user.');
  } finally {
    await pool.end();
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  });
}

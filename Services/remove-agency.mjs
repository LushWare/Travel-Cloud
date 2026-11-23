#!/usr/bin/env node
/**
 * Remove whole agencies, and every row they own, from a database.
 *
 *   cd Services && DATABASE_URL=<admin url> node remove-agency.mjs --agency=acme-tours,globe-dmc            # report only
 *   cd Services && DATABASE_URL=<admin url> node remove-agency.mjs --agency=acme-tours,globe-dmc --commit   # delete
 *
 * WHY THIS EXISTS
 *   The demo agencies (acme-tours, globe-dmc) and a throwaway `test` trial were
 *   seeded into the live database. seed-demo's --reset only removes rows carrying
 *   its own id prefixes and then reseeds, so it cannot take an agency away.
 *
 * WHAT IT DOES
 *   Finds every `crm_*` table with a `tenantId` column (from information_schema, so
 *   new tables are covered) and deletes the named agencies' rows, then the agency
 *   itself from crm_platform."Tenant". Foreign keys decide the order: each pass
 *   deletes what it can and retries the rest until nothing is left. Everything runs
 *   in ONE transaction, so a failure (for example a table that points at the agency
 *   without a tenantId column) leaves the database exactly as it was.
 *
 *   It never removes the public-website agency (PUBLIC_SITE_TENANT_ID, default
 *   …0001), and never removes a global User: people whose last membership goes are
 *   listed so you can decide about them separately.
 *
 * Needs the ADMIN connection (auth-service's DATABASE_URL), not crm_app. Try it on a
 * copy of the database first.
 */

import pg from '../Services/platform-service/node_modules/pg/lib/index.js';
import { requireDatabaseUrl } from './database-url.mjs';

const PUBLIC_SITE_TENANT_ID = process.env.PUBLIC_SITE_TENANT_ID || '00000000-0000-4000-8000-000000000001';
const MAX_PASSES = 20;

export function parseArgs(argv) {
  const args = { agencies: [], commit: false };
  for (const a of argv) {
    if (a === '--commit') args.commit = true;
    else if (a.startsWith('--agency=')) {
      args.agencies.push(...a.slice('--agency='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  args.agencies = [...new Set(args.agencies)];
  return args;
}

const quote = (schema, table) => `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;

async function tenantTables(client) {
  const { rows } = await client.query(
    `SELECT c.table_schema AS schema, c.table_name AS table
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.column_name = 'tenantId' AND c.table_schema LIKE 'crm\\_%'
      ORDER BY 1, 2`,
  );
  return rows;
}

async function countRows(client, tables, tenantId) {
  const counts = [];
  for (const { schema, table } of tables) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${quote(schema, table)} WHERE "tenantId" = $1`, [tenantId]);
    if (rows[0].n > 0) counts.push({ schema, table, n: rows[0].n });
  }
  return counts;
}

/** Deletes one agency's rows inside the caller's transaction; throws if any remain. */
async function deleteAgencyRows(client, tables, tenantId) {
  // FORCE ROW LEVEL SECURITY tables only show the agency in app.tenant_id.
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  let remaining = await countRows(client, tables, tenantId);
  for (let pass = 1; remaining.length && pass <= MAX_PASSES; pass += 1) {
    for (const { schema, table } of remaining) {
      await client.query('SAVEPOINT remove_agency_row');
      try {
        await client.query(`DELETE FROM ${quote(schema, table)} WHERE "tenantId" = $1`, [tenantId]);
        await client.query('RELEASE SAVEPOINT remove_agency_row');
      } catch (err) {
        // 23503 = still referenced by a row a later pass removes.
        await client.query('ROLLBACK TO SAVEPOINT remove_agency_row');
        if (err.code !== '23503') throw err;
      }
    }
    remaining = await countRows(client, tables, tenantId);
  }
  if (remaining.length) {
    throw new Error(`Rows still left after ${MAX_PASSES} passes: ${remaining.map((r) => `${r.schema}.${r.table}`).join(', ')}`);
  }
}

async function usersLeftWithoutMembership(client, tenantIds) {
  const { rows } = await client.query(
    `SELECT DISTINCT u.id, u.email
       FROM crm_users."Membership" m
       JOIN crm_users."User" u ON u.id = m."userId"
      WHERE m."tenantId" = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM crm_users."Membership" o WHERE o."userId" = u.id AND NOT (o."tenantId" = ANY($1::uuid[])))
      ORDER BY u.email`,
    [tenantIds],
  );
  return rows;
}

const maskEmail = (email) => String(email).replace(/^[^@]*/, '***');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.agencies.length) {
    console.log('Usage: node remove-agency.mjs --agency=<slug>[,<slug>…] [--commit]');
    process.exit(args.help ? 0 : 1);
  }
  const pool = new pg.Pool({
    connectionString: requireDatabaseUrl('remove-agency.mjs'),
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const { rows: agencies } = await client.query(
      `SELECT id, slug, name, status FROM crm_platform."Tenant" WHERE slug = ANY($1::text[])`,
      [args.agencies],
    );
    const missing = args.agencies.filter((slug) => !agencies.some((a) => a.slug === slug));
    if (missing.length) throw new Error(`No agency with slug: ${missing.join(', ')}`);
    if (agencies.some((a) => a.id === PUBLIC_SITE_TENANT_ID)) {
      throw new Error('Refusing: the public-website agency can never be removed.');
    }

    const tables = await tenantTables(client);
    for (const agency of agencies) {
      const counts = await countRows(client, tables, agency.id);
      const total = counts.reduce((sum, c) => sum + c.n, 0);
      console.log(`\n${agency.name} (${agency.slug}, ${agency.status}) — ${total} rows in ${counts.length} tables`);
      for (const c of counts) console.log(`  ${String(c.n).padStart(6)}  ${c.schema}.${c.table}`);
    }
    const orphans = await usersLeftWithoutMembership(client, agencies.map((a) => a.id));
    if (orphans.length) {
      console.log(`\n${orphans.length} sign-in(s) would belong to no agency afterwards (kept, not deleted):`);
      for (const u of orphans) console.log(`  ${maskEmail(u.email)}  ${u.id}`);
    }

    if (!args.commit) {
      console.log('\nReport only. Add --commit to delete.');
      return;
    }

    await client.query('BEGIN');
    try {
      for (const agency of agencies) {
        await deleteAgencyRows(client, tables, agency.id);
        await client.query(`DELETE FROM crm_platform."Tenant" WHERE id = $1`, [agency.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(`\nRemoved ${agencies.map((a) => a.slug).join(', ')}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('remove-agency.mjs')) {
  main().catch((err) => {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  });
}

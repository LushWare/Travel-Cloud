// One-off generator for Phase 1 step 4: adds the agency label (tenantId) to every
// tenant-owned table, in each service's schema.prisma and as an add_tenancy migration.
//
//   node Services/add-tenancy.mjs           # write both
//   node Services/add-tenancy.mjs --check   # report what is missing, write nothing
//   node Services/add-tenancy.mjs --rls     # write the row-level security migrations
//
// Safe to re-run: models that already have tenantId are left alone.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEMO_TENANT_ID } from './shared/constants/src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATION_NAME = '20261109150000_add_tenancy';

/**
 * Every service records its migrations in ONE shared _prisma_migrations table, keyed by name, so
 * a name used by two services is applied by the first and silently skipped by the rest. Each
 * service therefore gets `<base>_<service>`; user-service keeps the bare name it was applied under.
 */
export function migrationDir(service, base) {
  const migrations = path.join(HERE, service, 'prisma', 'migrations');
  const existing = existsSync(migrations) && readdirSync(migrations).find((d) => d === base || d.startsWith(`${base}_`));
  return path.join(migrations, existing || `${base}_${service.replace(/-service$/, '')}`);
}

export const SERVICES = [
  'assistant-service', 'billing-service', 'booking-service', 'career-service', 'flight-service',
  'lead-service', 'package-service', 'recommendation-service', 'user-service', 'voice-service',
];

// Not tenant-owned: the global login identity and the agency registry itself.
export const EXCLUDED_MODELS = new Set(['User', 'Tenant']);
const EXCLUDED_SCHEMAS = new Set(['crm_platform']);

const CONTEXT_DEFAULT = "(nullif(current_setting('app.tenant_id', true), ''))::uuid";
export const TENANT_FIELD = `  tenantId String @default(dbgenerated("${CONTEXT_DEFAULT}")) @db.Uuid`;

/** Every model block with its name, table name and Postgres schema. */
export function parseModels(prisma) {
  const models = [];
  const re = /^model (\w+) \{\n([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(prisma))) {
    const body = m[2];
    models.push({
      name: m[1],
      table: body.match(/@@map\("([^"]+)"\)/)?.[1] ?? m[1],
      schema: body.match(/@@schema\("([^"]+)"\)/)?.[1],
      hasTenant: /^\s+tenantId\s/m.test(body),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return models;
}

export const needsTenant = (model) =>
  !model.hasTenant && !EXCLUDED_MODELS.has(model.name) && !EXCLUDED_SCHEMAS.has(model.schema);

/** Adds the tenantId field as the first field and an index before @@schema. */
export function addTenantToModel(block) {
  const withField = block.replace(/^(model \w+ \{\n)/, `$1${TENANT_FIELD}\n`);
  return withField.replace(/^(\s+)@@schema\(/m, '$1@@index([tenantId])\n$1@@schema(');
}

export function addTenancyToSchema(prisma) {
  const targets = parseModels(prisma).filter(needsTenant);
  let out = prisma;
  for (const model of [...targets].reverse()) {
    out = out.slice(0, model.start) + addTenantToModel(out.slice(model.start, model.end)) + out.slice(model.end);
  }
  return { schema: out, models: targets };
}

/** Add the column, label every existing row as the demo agency, then make it required. */
export function migrationSql(models) {
  const lines = [
    '-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.',
    "-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.",
    '',
  ];
  for (const { schema, table } of models) {
    const t = `"${schema}"."${table}"`;
    lines.push(
      `ALTER TABLE ${t} ADD COLUMN "tenantId" UUID;`,
      `UPDATE ${t} SET "tenantId" = '${DEMO_TENANT_ID}' WHERE "tenantId" IS NULL;`,
      `ALTER TABLE ${t} ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT ${CONTEXT_DEFAULT};`,
      `CREATE INDEX "${table}_tenantId_idx" ON ${t}("tenantId");`,
      '',
    );
  }
  return lines.join('\n');
}

export const RLS_MIGRATION_NAME = '20261109160000_enable_row_level_security';

/** Every table that carries tenantId, in the service's own schema(s). */
export const tenantTables = (prisma) =>
  parseModels(prisma).filter((m) => m.hasTenant && !EXCLUDED_SCHEMAS.has(m.schema));

/**
 * The database's own lock: rows of other agencies are invisible and cannot be written. With no
 * agency set, nothing is visible. FORCE applies it to the table owner too; only roles with
 * BYPASSRLS (migrations, login) are exempt.
 */
export function rlsSql(models) {
  const lines = [
    '-- Phase 1: the database itself keeps each agency to its own rows (row-level security).',
    '',
  ];
  for (const { schema, table } of models) {
    const t = `"${schema}"."${table}"`;
    lines.push(
      `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
      `DROP POLICY IF EXISTS tenant_isolation ON ${t};`,
      `CREATE POLICY tenant_isolation ON ${t}`,
      `  USING ("tenantId" = ${CONTEXT_DEFAULT})`,
      `  WITH CHECK ("tenantId" = ${CONTEXT_DEFAULT});`,
      '',
    );
  }
  return lines.join('\n');
}

function writeRlsMigrations() {
  let total = 0;
  for (const service of SERVICES) {
    const schema = readFileSync(path.join(HERE, service, 'prisma', 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
    const models = tenantTables(schema);
    total += models.length;
    const dir = migrationDir(service, RLS_MIGRATION_NAME);
    if (!existsSync(dir)) mkdirSync(dir);
    writeFileSync(path.join(dir, 'migration.sql'), rlsSql(models));
    console.log(`${service.padEnd(24)} ${models.length} table(s) locked`);
  }
  console.log(`\n${total} table(s) under row-level security.`);
}

function main() {
  if (process.argv.includes('--rls')) return writeRlsMigrations();
  const check = process.argv.includes('--check');
  let total = 0;
  for (const service of SERVICES) {
    const schemaPath = path.join(HERE, service, 'prisma', 'schema.prisma');
    const raw = readFileSync(schemaPath, 'utf8');
    const crlf = raw.includes('\r\n');
    const { schema, models } = addTenancyToSchema(raw.replace(/\r\n/g, '\n'));
    total += models.length;
    console.log(`${service.padEnd(24)} ${models.length ? models.map((m) => m.name).join(', ') : '(already done)'}`);
    if (check || models.length === 0) continue;

    writeFileSync(schemaPath, crlf ? schema.replace(/\n/g, '\r\n') : schema);
    const dir = migrationDir(service, MIGRATION_NAME);
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'migration.sql'), migrationSql(models));
  }
  console.log(`\n${total} table(s) ${check ? 'still need' : 'given'} a tenantId.`);
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();

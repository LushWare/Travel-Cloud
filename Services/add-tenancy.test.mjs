// Run with: node --test Services/add-tenancy.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICES, TENANT_FIELD, addTenancyToSchema, migrationSql, parseModels } from './add-tenancy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = '00000000-0000-4000-8000-000000000001';

const SAMPLE = `model Lead {
  id    String @id @default(uuid())
  name  String

  @@index([name])
  @@schema("crm_leads")
}

model Package_Image_Model {
  id String @id
  @@map("Package_Image")
  @@schema("crm_packages")
}

model User {
  id String @id
  @@schema("crm_users")
}

model Tenant {
  id String @id
  @@schema("crm_platform")
}
`;

test('labels ordinary tables with the agency', () => {
  const { models } = addTenancyToSchema(SAMPLE);

  assert.deepEqual(models.map((m) => m.name), ['Lead', 'Package_Image_Model']);
});

test('leaves the global login identity and the agency list unlabelled', () => {
  const { schema } = addTenancyToSchema(SAMPLE);
  const byName = Object.fromEntries(parseModels(schema).map((m) => [m.name, m]));

  assert.equal(byName.User.hasTenant, false);
  assert.equal(byName.Tenant.hasTenant, false);
});

test('adds the field and an index to each labelled model', () => {
  const { schema } = addTenancyToSchema(SAMPLE);
  const lead = schema.slice(0, schema.indexOf('model Package_Image_Model'));

  assert.ok(lead.includes(TENANT_FIELD));
  assert.ok(lead.includes('@@index([tenantId])\n  @@schema("crm_leads")'));
});

test('does nothing the second time', () => {
  const once = addTenancyToSchema(SAMPLE).schema;

  assert.equal(addTenancyToSchema(once).schema, once);
});

test('uses the real table name when a model is mapped', () => {
  const sql = migrationSql(addTenancyToSchema(SAMPLE).models);

  assert.ok(sql.includes('ALTER TABLE "crm_packages"."Package_Image" ADD COLUMN "tenantId" UUID;'));
});

test('labels existing rows as the demo agency before making the column required', () => {
  const sql = migrationSql(addTenancyToSchema(SAMPLE).models);
  const fill = sql.indexOf(`UPDATE "crm_leads"."Lead" SET "tenantId" = '${DEMO}'`);
  const required = sql.indexOf('ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "tenantId" SET NOT NULL');

  assert.ok(fill > 0 && required > fill);
});

test('every service schema now labels every tenant-owned table', () => {
  for (const service of SERVICES) {
    const schema = readFileSync(path.join(HERE, service, 'prisma', 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
    const missing = addTenancyToSchema(schema).models.map((m) => m.name);
    assert.deepEqual(missing, [], `${service} has tables without tenantId: ${missing.join(', ')}`);
  }
});

import { RLS_MIGRATION_NAME, migrationDir, rlsSql, tenantTables } from './add-tenancy.mjs';
import { readdirSync, existsSync } from 'node:fs';
import { roleSql, APP_SCHEMAS } from './setup-db-roles.mjs';
import { unlockedTables } from './verify-tenancy.mjs';

test('locks a table for both reading and writing, even for its owner', () => {
  const sql = rlsSql([{ schema: 'crm_leads', table: 'Lead' }]);

  assert.ok(sql.includes('ALTER TABLE "crm_leads"."Lead" ENABLE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes('ALTER TABLE "crm_leads"."Lead" FORCE ROW LEVEL SECURITY;'));
  assert.ok(sql.includes(`USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)`));
  assert.ok(sql.includes(`WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)`));
});

test('every service has a row-level security migration covering all of its agency tables', () => {
  for (const service of SERVICES) {
    const schema = readFileSync(path.join(HERE, service, 'prisma', 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
    const sql = readFileSync(path.join(migrationDir(service, RLS_MIGRATION_NAME), 'migration.sql'), 'utf8');
    for (const { schema: s, table } of tenantTables(schema)) {
      assert.ok(sql.includes(`CREATE POLICY tenant_isolation ON "${s}"."${table}"`), `${service}: ${s}.${table} is not locked`);
    }
  }
});

test('the services\' database user can never bypass row-level security', () => {
  const [createRole] = roleSql('a'.repeat(40));

  assert.ok(createRole.includes('NOBYPASSRLS'));
  assert.ok(createRole.includes('NOSUPERUSER'));
});

test('the services\' database user gets no access to login tables', () => {
  assert.equal(APP_SCHEMAS.includes('crm_auth'), false);
  assert.equal(roleSql('a'.repeat(40)).some((s) => s.includes('crm_auth')), false);
});

test("the services' database user may only add and read audit entries", () => {
  const sql = roleSql('a'.repeat(40)).join('\n');

  assert.ok(sql.includes('GRANT INSERT, SELECT ON crm_platform."AuditLog"'));
  assert.ok(sql.includes('REVOKE UPDATE, DELETE, TRUNCATE ON crm_platform."AuditLog"'));
});

test('the audit log migration blocks edits and deletes and limits reads to the current agency', () => {
  const sql = readFileSync(path.join(HERE, 'user-service/prisma/migrations/20261111100000_add_audit_log/migration.sql'), 'utf8');

  assert.ok(sql.includes('BEFORE UPDATE OR DELETE ON "crm_platform"."AuditLog"'));
  assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('FOR SELECT'));
  assert.ok(sql.includes('FOR INSERT'));
  assert.ok(!/FOR (UPDATE|DELETE|ALL)/.test(sql));
});

test("the agency services' database user can never read platform staff accounts or sessions", () => {
  const roles = roleSql('a'.repeat(40)).join('\n');
  const sql = readFileSync(path.join(HERE, 'user-service/prisma/migrations/20261111110000_add_platform_staff/migration.sql'), 'utf8');

  assert.ok(!/PlatformUser|PlatformSession/.test(roles));
  assert.ok(sql.includes('REVOKE ALL ON "crm_platform"."PlatformUser" FROM crm_app'));
  assert.ok(sql.includes('REVOKE ALL ON "crm_platform"."PlatformSession" FROM crm_app'));
  assert.ok(sql.includes('ALTER TABLE "crm_platform"."PlatformUser" FORCE ROW LEVEL SECURITY'));
  assert.ok(!/CREATE POLICY/.test(sql));
});

test('help access is capped at 30 minutes and hidden from the agency services', () => {
  const sql = readFileSync(path.join(HERE, 'user-service/prisma/migrations/20261111130000_add_help_access_grant/migration.sql'), 'utf8');

  assert.ok(sql.includes(`CHECK ("expiresAt" <= "createdAt" + INTERVAL '30 minutes')`));
  assert.ok(sql.includes('REVOKE ALL ON "crm_platform"."HelpAccessGrant" FROM crm_app'));
  assert.ok(sql.includes('ALTER TABLE "crm_platform"."HelpAccessGrant" FORCE ROW LEVEL SECURITY'));
});

test('refuses a short or unsafe database password', () => {
  assert.throws(() => roleSql('short'), /32–128/);
  assert.throws(() => roleSql(`${'a'.repeat(40)}'; DROP ROLE x; --`), /32–128/);
});

test('reports agency tables whose lock is missing or not forced', () => {
  const catalog = [
    { schema: 'crm_leads', table: 'Lead', rls: true, forced: true, hasPolicy: true },
    { schema: 'crm_leads', table: 'LeadRemark', rls: true, forced: false, hasPolicy: true },
    { schema: 'crm_billing', table: 'Invoice', rls: false, forced: false, hasPolicy: false },
    { schema: 'crm_users', table: 'User', rls: false, forced: false, hasPolicy: false },
    { schema: 'crm_auth', table: 'Otp', rls: false, forced: false, hasPolicy: false },
  ];

  assert.deepEqual(unlockedTables(catalog), ['crm_leads.LeadRemark', 'crm_billing.Invoice']);
});

test('no two services share a migration name (the shared migrations table would skip one)', () => {
  const owners = new Map();
  for (const service of readdirSync(HERE)) {
    const dir = path.join(HERE, service, 'prisma', 'migrations');
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((d) => /^\d{14}_/.test(d))) {
      assert.ok(!owners.has(name), `${name} is used by both ${owners.get(name)} and ${service}`);
      owners.set(name, service);
    }
  }
  assert.ok(owners.size > 20);
});

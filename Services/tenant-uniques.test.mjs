// Run with: node --test Services/tenant-uniques.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PER_AGENCY, applyToSchema, perAgencyBlock } from './tenant-uniques.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('turns a unique field into unique per agency', () => {
  const block = 'model Invoice {\n  id String @id\n  invoiceNumber String @unique\n\n  @@schema("crm_billing")\n}';

  const out = perAgencyBlock(block, [['invoiceNumber']]);

  assert.ok(out.includes('  invoiceNumber String\n'));
  assert.ok(out.includes('@@unique([tenantId, invoiceNumber])\n  @@schema("crm_billing")'));
});

test('turns a unique combination into unique per agency', () => {
  const block = 'model Lead {\n  id String @id\n\n  @@unique([intakeChannel, intakeSessionId])\n  @@schema("crm_leads")\n}';

  const out = perAgencyBlock(block, [['intakeChannel', 'intakeSessionId']]);

  assert.ok(!out.includes('@@unique([intakeChannel, intakeSessionId])'));
  assert.ok(out.includes('@@unique([tenantId, intakeChannel, intakeSessionId])'));
});

test('makes a settings table one row per agency', () => {
  const out = perAgencyBlock('model S {\n  id String @id\n  @@schema("x")\n}', [[]]);

  assert.ok(out.includes('@@unique([tenantId])'));
});

test('does nothing the second time', () => {
  const block = 'model Invoice {\n  id String @id\n  invoiceNumber String @unique\n  @@schema("x")\n}';
  const once = perAgencyBlock(block, [['invoiceNumber']]);

  assert.equal(perAgencyBlock(once, [['invoiceNumber']]), once);
});

test('every listed value is unique per agency in the real schemas', () => {
  for (const [service, models] of Object.entries(PER_AGENCY)) {
    const schema = readFileSync(path.join(HERE, service, 'prisma', 'schema.prisma'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(applyToSchema(schema, models), schema, `${service} still has a global unique that should be per agency`);
  }
});

test('login email stays unique across the whole system', () => {
  const schema = readFileSync(path.join(HERE, 'user-service', 'prisma', 'schema.prisma'), 'utf8');

  assert.match(schema, /^\s+email\s+String\s+@unique/m);
});

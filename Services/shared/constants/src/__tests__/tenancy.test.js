import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_TENANT_ID, DEMO_TENANT_SLUG } from '../index.js';

const migration = readFileSync(
  fileURLToPath(new URL(
    '../../../../user-service/prisma/migrations/20261109130000_add_tenants_and_memberships/migration.sql',
    import.meta.url,
  )),
  'utf8',
);

describe('demo tenant', () => {
  it('is created by the user-service migration with the shared id', () => {
    expect(migration).toContain(`VALUES ('${DEMO_TENANT_ID}', '${DEMO_TENANT_SLUG}'`);
  });

  it('receives the backfilled memberships under the same id', () => {
    expect(migration).toContain(`  '${DEMO_TENANT_ID}',\n  u."id",`);
  });

  it('is a valid version-4 uuid, as the uuid column requires', () => {
    expect(DEMO_TENANT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

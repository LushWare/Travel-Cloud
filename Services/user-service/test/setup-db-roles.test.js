import { describe, expect, it } from 'vitest';
import { roleSql } from '../../setup-db-roles.mjs';

describe('platform plan table grants', () => {
  it('grants tenant services guarded read-only access', () => {
    const sql = roleSql('x'.repeat(32)).join('\n');

    for (const table of ['Plan', 'PlanVersion', 'TenantPlan', 'PlanEntitlementOverride']) {
      expect(sql).toContain(`IF to_regclass('crm_platform."${table}"') IS NOT NULL THEN`);
      expect(sql).toContain(`GRANT SELECT ON crm_platform."${table}" TO crm_app;`);
      expect(sql).toContain(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON crm_platform."${table}" FROM crm_app;`);
    }
  });
});
import { describe, expect, it, vi } from 'vitest';
import { CURRENT_TENANT, createTenantPool, runWithTenant, scopeSqlToTenant } from '../index.js';

const A = '11111111-1111-4111-8111-111111111111';
const lead = `(SELECT * FROM crm_leads."Lead" WHERE "tenantId" = ${CURRENT_TENANT})`;

describe('scopeSqlToTenant', () => {
  it('narrows a table and keeps its alias', () => {
    expect(scopeSqlToTenant('SELECT l.id FROM crm_leads."Lead" l WHERE l.x = 1'))
      .toBe(`SELECT l.id FROM ${lead} AS l WHERE l.x = 1`);
  });

  it('keeps an alias written with AS', () => {
    expect(scopeSqlToTenant('FROM crm_leads."Lead" AS lead')).toBe(`FROM ${lead} AS lead`);
  });

  it('names an unaliased table after itself so its columns still resolve', () => {
    expect(scopeSqlToTenant('SELECT COUNT(*) FROM crm_leads."Lead" WHERE "assignedToId" = $1'))
      .toBe(`SELECT COUNT(*) FROM ${lead} AS "Lead" WHERE "assignedToId" = $1`);
  });

  it.each(['WHERE', 'GROUP BY x', 'ORDER BY x', 'LIMIT 5', 'LEFT JOIN y', 'JOIN y', 'where'])('does not take "%s" for an alias', (next) => {
    expect(scopeSqlToTenant(`FROM crm_leads."Lead" ${next}`)).toBe(`FROM ${lead} AS "Lead" ${next}`);
  });

  it('narrows every table in a join', () => {
    const sql = scopeSqlToTenant('FROM crm_billing."Invoice" i JOIN crm_leads."Lead" l ON l.id = i."leadId"');

    expect(sql).toContain(`(SELECT * FROM crm_billing."Invoice" WHERE "tenantId" = ${CURRENT_TENANT}) AS i`);
    expect(sql).toContain(`${lead} AS l ON`);
  });

  it('limits accounts to members of the agency', () => {
    const sql = scopeSqlToTenant('FROM crm_users."User" u WHERE u.role = $1');

    expect(sql).toContain('crm_users."Membership" tenant_m WHERE tenant_m."userId" = "User".id');
    expect(sql).toContain(`tenant_m."tenantId" = ${CURRENT_TENANT})) AS u WHERE`);
  });

  it('leaves the agency registry alone', () => {
    expect(scopeSqlToTenant('FROM crm_platform."Tenant" t')).toBe('FROM crm_platform."Tenant" t');
  });

  it('leaves queries without crm tables alone', () => {
    expect(scopeSqlToTenant('SELECT 1')).toBe('SELECT 1');
  });
});

describe('createTenantPool', () => {
  const fakePool = () => {
    const client = { query: vi.fn(async () => ({ rows: [{ n: 1 }] })), release: vi.fn() };
    return { pool: { connect: vi.fn(async () => client) }, client };
  };

  it('refuses to query without an agency', async () => {
    const { pool } = fakePool();

    await expect(createTenantPool(pool).query('SELECT 1')).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('sets the agency and runs the narrowed query in one transaction', async () => {
    const { pool, client } = fakePool();

    await runWithTenant(A, () => createTenantPool(pool).query('SELECT 1 FROM crm_leads."Lead" l', [5]));

    expect(client.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      "SELECT set_config('app.tenant_id', $1, true)",
      `SELECT 1 FROM ${lead} AS l`,
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual([A]);
    expect(client.query.mock.calls[2][1]).toEqual([5]);
  });

  it('rolls back and returns the connection when the query fails', async () => {
    const { pool, client } = fakePool();
    client.query.mockImplementation(async (sql) => {
      if (sql.startsWith('SELECT 1')) throw new Error('boom');
      return {};
    });

    await expect(runWithTenant(A, () => createTenantPool(pool).query('SELECT 1'))).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

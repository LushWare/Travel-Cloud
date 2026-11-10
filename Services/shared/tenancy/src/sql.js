import { requireTenantId } from './context.js';

export const CURRENT_TENANT = "(nullif(current_setting('app.tenant_id', true), ''))::uuid";

// Words that can follow a table name and are not its alias.
const NOT_AN_ALIAS = new Set([
  'where', 'group', 'order', 'limit', 'offset', 'having', 'window', 'union', 'intersect', 'except',
  'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'lateral', 'on', 'using',
  'for', 'fetch', 'returning', 'set', 'values',
]);

const TABLE = /crm_([a-z_]+)\."([A-Za-z_]+)"(\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

/** How a table is narrowed to one agency. Accounts are global: an agency sees its members. */
function narrowed(schema, table) {
  const source = `crm_${schema}."${table}"`;
  if (schema === 'users' && table === 'User') {
    return `(SELECT * FROM ${source} WHERE EXISTS (SELECT 1 FROM crm_users."Membership" tenant_m `
      + `WHERE tenant_m."userId" = "User".id AND tenant_m."tenantId" = ${CURRENT_TENANT}))`;
  }
  return `(SELECT * FROM ${source} WHERE "tenantId" = ${CURRENT_TENANT})`;
}

/**
 * Rewrites a read-only query so every crm_* table it reads is limited to the current agency
 * (set with set_config in the same transaction). Each table keeps its alias, or its own name.
 */
export function scopeSqlToTenant(sql) {
  return sql.replace(TABLE, (match, schema, table, aliasPart, alias) => {
    if (schema === 'platform') return match;
    const keepsAlias = alias && !NOT_AN_ALIAS.has(alias.toLowerCase());
    const rest = aliasPart && !keepsAlias ? aliasPart : '';
    return `${narrowed(schema, table)} AS ${keepsAlias ? alias : `"${table}"`}${rest}`;
  });
}

/**
 * A pg pool whose queries only see the current agency's rows. Each query runs in its own
 * transaction that sets app.tenant_id, so it also works through the transaction-mode pooler.
 */
export function createTenantPool(pool) {
  return {
    async query(text, params) {
      const tenantId = requireTenantId();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const result = await client.query(scopeSqlToTenant(text), params);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

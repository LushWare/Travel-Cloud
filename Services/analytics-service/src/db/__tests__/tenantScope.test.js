import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scopeSqlToTenant } from '../../../../shared/tenancy/src/index.js';

const controllers = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'controllers');
const queries = readdirSync(controllers)
  .filter((f) => f.endsWith('.js'))
  .flatMap((f) => [...readFileSync(path.join(controllers, f), 'utf8').matchAll(/`([^`]*crm_[^`]*)`/g)]
    .map((m) => ({ file: f, sql: m[1] })));

describe('every analytics query is limited to the agency', () => {
  it('finds the analytics queries to check', () => {
    expect(queries.length).toBeGreaterThan(50);
  });

  it.each(queries.map((q, i) => [`${q.file} #${i + 1}`, q.sql]))('%s reads no table outside the agency', (_name, sql) => {
    const scoped = scopeSqlToTenant(sql);
    const tables = [...scoped.matchAll(/crm_[a-z_]+\."[A-Za-z_]+"/g)];
    const unscoped = tables.filter((m) => {
      const before = scoped.slice(Math.max(0, m.index - 14), m.index);
      return !before.endsWith('SELECT * FROM ') && !m[0].startsWith('crm_users."Membership"');
    });
    expect(unscoped.map((m) => m[0])).toEqual([]);
  });
});

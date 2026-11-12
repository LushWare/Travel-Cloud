import { describe, it, expect, vi, beforeEach } from 'vitest';

// The API tests replace the database layer, so they cannot see SQL that Postgres would reject.
// These tests capture the real statements and check the one mistake that slipped through:
// a RETURNING list naming the "pv" alias on an INSERT that never declared it.
const { client } = vi.hoisted(() => ({ client: { query: vi.fn(), release: vi.fn() } }));
vi.mock('../src/db/pool.js', () => ({ default: { connect: vi.fn(async () => client), query: vi.fn() } }));

const { createPlan, createPlanVersion } = await import('../src/db/plans.js');

const req = { platformUser: { id: 'p-1', email: 'ops@lushware.test', role: 'platform_admin' }, headers: {}, ip: null };
const PLAN = {
  key: 'starter', name: 'Starter', description: null, priceMinorUnits: 4900, currency: 'USD',
  billingInterval: 'monthly', entitlements: { staff_seats: 5, packages: 25, features: {} },
};

const statements = () => client.query.mock.calls.map(([sql]) => String(sql));
const aliasProblems = () => statements()
  .filter((sql) => /^\s*INSERT/i.test(sql) && /\bpv\./.test(sql))
  .filter((sql) => !/INSERT INTO\s+\S+\s+AS pv\b/i.test(sql));

beforeEach(() => {
  client.query.mockReset().mockImplementation(async (sql) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 'plan-1', key: 'starter', archivedAt: null }] };
    if (/MAX\(version\)/.test(sql)) return { rows: [{ version: 1 }] };
    return { rows: [{ id: 'plan-1', key: 'starter', createdAt: new Date() }] };
  });
});

describe('plan SQL', () => {
  it('declares the pv alias on every plan-version insert that returns pv columns', async () => {
    await createPlan(PLAN, req);
    await createPlanVersion('plan-1', PLAN, req);

    expect(statements().filter((sql) => /INSERT INTO crm_platform."PlanVersion"/.test(sql))).toHaveLength(2);
    expect(aliasProblems()).toEqual([]);
  });

  it('creates the plan and its first version together, then commits', async () => {
    await createPlan(PLAN, req);

    const sql = statements();
    expect(sql[0]).toBe('BEGIN');
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.some((s) => /INSERT INTO crm_platform."AuditLog"/.test(s))).toBe(true);
  });
});

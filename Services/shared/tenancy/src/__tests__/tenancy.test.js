import { describe, expect, it, vi } from 'vitest';
import {
  BatchTransactionError, createScoper, createTenantPrisma, getTenantId, requireTenantId,
  runWithTenant, tenantMiddleware,
} from '../index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// Quotation → items (QuotationItem), lead (Lead); Lead → createdBy (User, global).
const relations = {
  Quotation: { items: 'QuotationItem', lead: 'Lead' },
  QuotationItem: { quotation: 'Quotation' },
  Lead: { createdBy: 'User', quotations: 'Quotation' },
  User: { memberships: 'Membership' },
  Membership: {},
};
const scope = createScoper({ relations, globalModels: ['User', 'Tenant'] });

describe('agency context', () => {
  it('is available inside runWithTenant', () => {
    runWithTenant(A, () => expect(getTenantId()).toBe(A));
  });

  it('survives awaits', async () => {
    await runWithTenant(A, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getTenantId()).toBe(A);
    });
  });

  it('is absent outside a request', () => {
    expect(getTenantId()).toBeNull();
  });

  it('fails closed when code needs an agency and none is set', () => {
    expect(() => requireTenantId()).toThrow(expect.objectContaining({ code: 'TENANT_CONTEXT_MISSING' }));
  });

  it('refuses a malformed agency id', () => {
    expect(() => runWithTenant('not-a-uuid', () => {})).toThrow('Invalid tenant id');
  });

  it('keeps two concurrent requests apart', async () => {
    const seen = await Promise.all([
      runWithTenant(A, async () => { await new Promise((r) => setTimeout(r, 5)); return getTenantId(); }),
      runWithTenant(B, async () => getTenantId()),
    ]);
    expect(seen).toEqual([A, B]);
  });
});

describe('tenantMiddleware', () => {
  it('runs the request inside the agency from the gateway header', () => {
    const req = { headers: { 'x-tenant-id': A } };
    let inside;
    tenantMiddleware(req, {}, () => { inside = getTenantId(); });

    expect(inside).toBe(A);
    expect(req.tenantId).toBe(A);
  });

  it('runs a request without an agency with none, so tenant data stays unreachable', () => {
    let inside = 'unset';
    tenantMiddleware({ headers: {} }, {}, () => { inside = getTenantId(); });

    expect(inside).toBeNull();
  });

  it('ignores a malformed agency header', () => {
    let inside = 'unset';
    tenantMiddleware({ headers: { 'x-tenant-id': "x' OR 1=1" } }, {}, () => { inside = getTenantId(); });

    expect(inside).toBeNull();
  });
});

describe('agency filter on reads', () => {
  it.each(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy', 'deleteMany', 'updateMany'])('limits %s to the agency', (op) => {
    expect(scope('Lead', op, { where: { status: 'NEW' } }, A).where).toEqual({ status: 'NEW', AND: [{ tenantId: A }] });
  });

  it('limits findUnique while keeping its unique field', () => {
    expect(scope('Lead', 'findUnique', { where: { id: 'l1' } }, A).where).toEqual({ id: 'l1', AND: [{ tenantId: A }] });
  });

  it('limits a single update and delete to the agency', () => {
    expect(scope('Lead', 'update', { where: { id: 'l1' }, data: {} }, A).where.AND).toEqual([{ tenantId: A }]);
    expect(scope('Lead', 'delete', { where: { id: 'l1' } }, A).where.AND).toEqual([{ tenantId: A }]);
  });

  it('keeps the caller\'s own AND conditions', () => {
    const where = scope('Lead', 'findMany', { where: { AND: [{ a: 1 }] } }, A).where;

    expect(where.AND).toEqual([{ a: 1 }, { tenantId: A }]);
  });

  it('adds the filter even when the caller passes no where', () => {
    expect(scope('Lead', 'findMany', {}, A).where).toEqual({ AND: [{ tenantId: A }] });
  });

  it('cannot be escaped by the caller asking for another agency', () => {
    const where = scope('Lead', 'findMany', { where: { tenantId: B } }, A).where;

    expect(where).toEqual({ tenantId: B, AND: [{ tenantId: A }] });
  });

  it('leaves global tables alone', () => {
    expect(scope('Tenant', 'findMany', { where: { slug: 'x' } }, A)).toEqual({ where: { slug: 'x' } });
  });
});

describe('agency label on writes', () => {
  it('labels a new row with the agency', () => {
    expect(scope('Lead', 'create', { data: { name: 'x' } }, A).data).toEqual({ name: 'x', tenantId: A });
  });

  it('labels every row of a bulk insert', () => {
    expect(scope('Lead', 'createMany', { data: [{ n: 1 }, { n: 2 }] }, A).data).toEqual([{ n: 1, tenantId: A }, { n: 2, tenantId: A }]);
  });

  it('labels nested children created with their parent', () => {
    const data = scope('Quotation', 'create', { data: { items: { create: [{ d: 1 }, { d: 2 }] } } }, A).data;

    expect(data.items.create).toEqual([{ d: 1, tenantId: A }, { d: 2, tenantId: A }]);
  });

  it('labels nested children created with createMany', () => {
    const data = scope('Quotation', 'create', { data: { items: { createMany: { data: [{ d: 1 }] } } } }, A).data;

    expect(data.items.createMany.data).toEqual([{ d: 1, tenantId: A }]);
  });

  it('labels children created during an update', () => {
    const data = scope('Quotation', 'update', { where: { id: 'q' }, data: { items: { create: { d: 1 } } } }, A).data;

    expect(data.items.create).toEqual({ d: 1, tenantId: A });
  });

  it('only links to existing rows of the same agency', () => {
    const data = scope('Quotation', 'create', { data: { lead: { connect: { id: 'l1' } } } }, A).data;

    expect(data.lead.connect).toEqual({ id: 'l1', tenantId: A });
  });

  it('labels both sides of an upsert', () => {
    const args = scope('Lead', 'upsert', { where: { id: 'l' }, create: { n: 1 }, update: { n: 2 } }, A);

    expect(args.create).toEqual({ n: 1, tenantId: A });
    expect(args.where.AND).toEqual([{ tenantId: A }]);
  });

  it('refuses to create a row for another agency', () => {
    expect(() => scope('Lead', 'create', { data: { tenantId: B } }, A)).toThrow('another agency');
  });

  it('refuses to move a row to another agency', () => {
    expect(() => scope('Lead', 'update', { where: { id: 'l' }, data: { tenantId: B } }, A)).toThrow('another agency');
  });

  it('does not label rows of global tables reached through a relation', () => {
    const data = scope('Lead', 'create', { data: { createdBy: { connect: { id: 'u1' } } } }, A).data;

    expect(data.createdBy.connect).toEqual({ id: 'u1' });
  });
});

describe('extra scopes for global tables', () => {
  const userScope = createScoper({
    relations, globalModels: ['User'],
    extraScopes: { User: (tenantId) => ({ memberships: { some: { tenantId } } }) },
  });

  it('limits global accounts to members of the agency', () => {
    expect(userScope('User', 'findMany', {}, A).where).toEqual({ AND: [{ memberships: { some: { tenantId: A } } }] });
  });
});

describe('createTenantPrisma', () => {
  function fakeBase() {
    const calls = [];
    const base = {
      $executeRaw: (strings, ...values) => ({ sql: strings.join('?'), values }),
      $queryRaw: (strings, ...values) => ({ raw: strings.join('?'), values }),
      $transaction: vi.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(txClient))),
      $extends(def) {
        const handler = def.query.$allModels.$allOperations;
        const op = (model, operation) => (args) => handler({ model, operation, args, query: async (a) => { calls.push({ model, operation, args: a }); return a; } });
        return {
          lead: { findMany: op('Lead', 'findMany') },
          tenant: { findMany: op('Tenant', 'findMany') },
          $transaction: async (fn) => fn(txClient),
          $queryRaw: () => 'raw',
        };
      },
      calls,
    };
    const txClient = { $executeRaw: vi.fn(async () => 0), lead: null };
    return { base, txClient };
  }
  const Prisma = { dmmf: { datamodel: { models: [{ name: 'Lead', fields: [] }] } } };

  it('refuses to touch agency data without an agency', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await expect(prisma.lead.findMany({})).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });

  it('sets the agency for the database in the same transaction as the query', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await runWithTenant(A, () => prisma.lead.findMany({}));

    const [setConfig] = base.$transaction.mock.calls[0][0];
    expect(setConfig.sql).toContain("set_config('app.tenant_id', ?, true)");
    expect(setConfig.values).toEqual([A]);
  });

  it('filters the query to the agency', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await runWithTenant(A, () => prisma.lead.findMany({ where: { x: 1 } }));

    expect(base.calls[0].args.where).toEqual({ x: 1, AND: [{ tenantId: A }] });
  });

  it('lets global tables be read without an agency', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await expect(prisma.tenant.findMany({})).resolves.toEqual({});
  });

  it('refuses batch transactions, which cannot carry the agency', () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    expect(() => prisma.$transaction([])).toThrow(BatchTransactionError);
  });

  it('sets the agency once at the start of an interactive transaction', async () => {
    const { base, txClient } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await runWithTenant(A, () => prisma.$transaction(async () => 'done'));

    expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(txClient.$executeRaw.mock.calls[0].slice(1)).toEqual([A]);
  });

  it('refuses an interactive transaction without an agency', () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    expect(() => prisma.$transaction(async () => {})).toThrow(expect.objectContaining({ code: 'TENANT_CONTEXT_MISSING' }));
  });

  it('sets the agency for the database around hand-written SQL', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    const result = await runWithTenant(A, () => prisma.$queryRaw`SELECT 1 WHERE x = ${5}`);

    const [setConfig, query] = base.$transaction.mock.calls[0][0];
    expect(setConfig.values).toEqual([A]);
    expect(query).toEqual({ raw: 'SELECT 1 WHERE x = ?', values: [5] });
    expect(result).toEqual(query);
  });

  it('runs hand-written SQL without an agency unchanged, so it can only see global tables', async () => {
    const { base } = fakeBase();
    const prisma = createTenantPrisma(base, { Prisma });

    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBe('raw');
    expect(base.$transaction).not.toHaveBeenCalled();
  });
});

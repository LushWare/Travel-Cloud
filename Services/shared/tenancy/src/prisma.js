import { getTenantId, isInTenantTransaction, requireTenantId, runInTenantTransaction } from './context.js';

const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'aggregate', 'count', 'groupBy',
]);

const toArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const mapOneOrMany = (value, fn) => (Array.isArray(value) ? value.map(fn) : fn(value));

/** Adds a condition without disturbing the caller's unique fields, so findUnique/update/delete stay valid. */
export const andWhere = (where, condition) => ({ ...(where || {}), AND: [...toArray(where?.AND), condition] });

/** model name → { relation field → target model name }, from the generated client's DMMF. */
export function buildRelations(dmmf) {
  const relations = {};
  for (const model of dmmf.datamodel.models) {
    relations[model.name] = Object.fromEntries(
      model.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type]),
    );
  }
  return relations;
}

/**
 * Rewrites one Prisma call so it can only read and write rows of `tenantId`.
 * Every model is agency-owned unless listed in `globalModels` (fail closed: a forgotten table is filtered).
 */
export function createScoper({ relations, globalModels = [], extraScopes = {} }) {
  const global = new Set(globalModels);
  const owned = (model) => !global.has(model);

  function stamp(model, row, tenantId) {
    if (row.tenantId !== undefined && row.tenantId !== tenantId) {
      throw new Error(`Refusing to write a ${model} row for another agency`);
    }
    return { ...nested(model, row, tenantId), tenantId };
  }

  // Nested writes (e.g. a quotation created with its items) are labelled too, and
  // links to existing rows must point at rows of the same agency.
  function nested(model, data, tenantId) {
    if (!data || typeof data !== 'object') return data;
    const out = { ...data };
    for (const [field, target] of Object.entries(relations[model] || {})) {
      const value = out[field];
      if (!value || typeof value !== 'object' || !owned(target)) continue;
      const write = { ...value };
      const sameAgency = (where) => ({ ...where, tenantId });
      if (write.create) write.create = mapOneOrMany(write.create, (row) => stamp(target, row, tenantId));
      if (write.createMany?.data) {
        write.createMany = { ...write.createMany, data: mapOneOrMany(write.createMany.data, (row) => stamp(target, row, tenantId)) };
      }
      if (write.connectOrCreate) {
        write.connectOrCreate = mapOneOrMany(write.connectOrCreate, (item) => ({
          ...item, where: sameAgency(item.where), create: stamp(target, item.create, tenantId),
        }));
      }
      if (write.connect) write.connect = mapOneOrMany(write.connect, sameAgency);
      if (write.set) write.set = mapOneOrMany(write.set, sameAgency);
      if (write.upsert) {
        write.upsert = mapOneOrMany(write.upsert, (item) => ({
          ...item, create: stamp(target, item.create, tenantId), update: nested(target, item.update, tenantId),
        }));
      }
      if (write.update) {
        write.update = mapOneOrMany(write.update, (item) => (item.data && item.where
          ? { ...item, data: nested(target, item.data, tenantId) }
          : nested(target, item, tenantId)));
      }
      out[field] = write;
    }
    return out;
  }

  return function scope(model, operation, args = {}, tenantId) {
    if (!owned(model)) {
      const extra = extraScopes[model];
      return extra && WHERE_OPS.has(operation) ? { ...args, where: andWhere(args.where, extra(tenantId)) } : args;
    }

    const scoped = { ...args };
    if (WHERE_OPS.has(operation)) scoped.where = andWhere(args.where, { tenantId });

    switch (operation) {
      case 'create':
        scoped.data = stamp(model, args.data || {}, tenantId);
        break;
      case 'createMany':
      case 'createManyAndReturn':
        scoped.data = mapOneOrMany(args.data, (row) => stamp(model, row, tenantId));
        break;
      case 'update':
      case 'updateMany':
        if (args.data?.tenantId !== undefined && args.data.tenantId !== tenantId) {
          throw new Error(`Refusing to move a ${model} row to another agency`);
        }
        scoped.data = nested(model, args.data, tenantId);
        break;
      case 'upsert':
        scoped.create = stamp(model, args.create || {}, tenantId);
        scoped.update = nested(model, args.update, tenantId);
        break;
      default:
    }
    return scoped;
  };
}

export class BatchTransactionError extends Error {
  constructor() {
    super('Batch transactions cannot carry the agency; use prisma.$transaction(async (tx) => { ... }) instead');
    this.name = 'BatchTransactionError';
  }
}

/**
 * The Prisma client every service uses. Each call is limited to the request's agency, and runs in a
 * transaction that also sets app.tenant_id, which the column defaults and row-level security read.
 */
export function createTenantPrisma(base, { Prisma, globalModels = ['User', 'Tenant'], extraScopes = {} }) {
  const scope = createScoper({ relations: buildRelations(Prisma.dmmf), globalModels, extraScopes });
  const needsTenant = (model) => !globalModels.includes(model) || Boolean(extraScopes[model]);

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!needsTenant(model)) return query(args);
          const tenantId = requireTenantId();
          const scoped = scope(model, operation, args, tenantId);
          if (isInTenantTransaction()) return query(scoped);
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
            query(scoped),
          ]);
          return result;
        },
      },
    },
  });

  function $transaction(work, options) {
    if (typeof work !== 'function') throw new BatchTransactionError();
    const tenantId = requireTenantId();
    return extended.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return runInTenantTransaction(() => work(tx));
    }, options);
  }

  // Hand-written SQL names the agency itself; this also sets it for the database (row-level security).
  const RAW = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);
  const rawWithTenant = (prop) => async (...args) => {
    const tenantId = getTenantId();
    if (!tenantId || isInTenantTransaction()) return extended[prop](...args);
    const [, result] = await base.$transaction([
      base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      base[prop](...args),
    ]);
    return result;
  };

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === '$transaction') return $transaction;
      if (RAW.has(prop)) return rawWithTenant(prop);
      return Reflect.get(target, prop, receiver);
    },
  });
}

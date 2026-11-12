import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTenantId = (value) => typeof value === 'string' && UUID.test(value);

export class TenantContextMissingError extends Error {
  constructor() {
    super('No agency (tenant) is set for this database access');
    this.name = 'TenantContextMissingError';
    this.code = 'TENANT_CONTEXT_MISSING';
    this.statusCode = 500;
  }
}

/** Runs `fn` with every database access inside it limited to `tenantId`. */
export function runWithTenant(tenantId, fn, requestId = null) {
  if (!isTenantId(tenantId)) throw new TypeError(`Invalid tenant id: ${tenantId}`);
  return storage.run({ tenantId, requestId, inTransaction: false }, fn);
}

export const getTenantId = () => storage.getStore()?.tenantId ?? null;
export const getRequestId = () => storage.getStore()?.requestId ?? null;

export function requireTenantId() {
  const tenantId = getTenantId();
  if (!tenantId) throw new TenantContextMissingError();
  return tenantId;
}

export const isInTenantTransaction = () => storage.getStore()?.inTransaction === true;

export function runInTenantTransaction(fn) {
  return storage.run({ ...storage.getStore(), inTransaction: true }, fn);
}

/**
 * Express middleware: requests carry the agency the gateway took from the signed login.
 * Requests without one get no agency, so any tenant-owned database access fails closed.
 */
export function tenantMiddleware(req, res, next) {
  const tenantId = req.headers['x-tenant-id'];
  if (!isTenantId(tenantId)) return next();
  req.tenantId = tenantId;
  return runWithTenant(tenantId, next, req.requestId);
}

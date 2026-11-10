import { getTenantId } from './context.js';

const INSTALLED = Symbol.for('travel-crm.tenantFetch');

/** Origins of our own services, from the *_SERVICE_URL settings. Outside companies never get the agency. */
export function internalOrigins(env = process.env) {
  const origins = new Set();
  for (const [key, value] of Object.entries(env)) {
    if (!key.endsWith('_SERVICE_URL') || !value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // A malformed setting is reported where it is used, not here.
    }
  }
  return origins;
}

const urlOf = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url);

/** Adds the current agency to a call when it goes to one of our own services. */
export function withTenantHeader(input, init, { tenantId = getTenantId(), env = process.env } = {}) {
  if (!tenantId) return init;
  let origin;
  try {
    origin = new URL(urlOf(input)).origin;
  } catch {
    return init;
  }
  if (!internalOrigins(env).has(origin)) return init;

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('x-tenant-id')) headers.set('x-tenant-id', tenantId);
  return { ...init, headers };
}

/** Makes every call from this service to another of our services carry the request's agency. */
export function installTenantFetch() {
  if (globalThis.fetch?.[INSTALLED]) return;
  const original = globalThis.fetch;
  const tenantFetch = (input, init) => original(input, withTenantHeader(input, init));
  tenantFetch[INSTALLED] = true;
  globalThis.fetch = tenantFetch;
}

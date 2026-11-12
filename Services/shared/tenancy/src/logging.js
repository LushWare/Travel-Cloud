import { getRequestId, getTenantId, isTenantId } from './context.js';

/**
 * Fields every log line carries while code runs for an agency, for a pino `mixin()`.
 * Empty outside a request (startup, scheduled jobs) and for platform-only work, so those lines
 * are never attributed to an agency by mistake.
 *
 * Imported directly by each service's config/logger.js (not through index.js) so the logger
 * does not load the database helpers.
 */
export function tenantLogFields() {
  const tenantId = getTenantId();
  const requestId = getRequestId();
  return {
    ...(tenantId ? { tenantId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

/** Request-level tenant attribution uses only the gateway-forwarded, UUID-validated header. */
export function tenantRequestLogFields(req) {
  const tenantId = req.headers['x-tenant-id'];
  const requestId = req.requestId || req.id;
  return {
    ...(isTenantId(tenantId) ? { tenantId } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

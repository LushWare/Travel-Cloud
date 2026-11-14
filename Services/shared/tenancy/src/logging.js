import { getRequestId, getTenantId, isTenantId } from './context.js';

export function sanitizeRequestUrl(value) {
  if (typeof value !== 'string') return value;
  const [pathname, ...queryParts] = value.split('?');
  const safePath = pathname
    .replace(/(\/stripe\/payment-links\/)[A-Za-z0-9_-]{40,64}(?=\/|$)/g, '$1[redacted]')
    .replace(/(\/stripe\/checkout-sessions\/)cs_(?:test|live)_[A-Za-z0-9]+(?=\/|$)/g, '$1[redacted]');
  const query = new URLSearchParams(queryParts.join('?'));
  for (const key of ['code', 'state']) {
    if (query.has(key)) query.set(key, '[redacted]');
  }
  const safeQuery = query.toString();
  return safeQuery ? `${safePath}?${safeQuery}` : safePath;
}

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

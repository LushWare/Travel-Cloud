import { getTenantId } from './context.js';

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
  return tenantId ? { tenantId } : {};
}

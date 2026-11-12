import { getTenantId } from './context.js';

const ACTION = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;
// Values under these keys are never stored, even if a caller passes them by mistake.
const SENSITIVE_KEY = /pass(word)?|token|secret|api[_-]?key|account[_-]?number|iban|swift|ifsc|upi|card|cvv/i;
const MAX_DEPTH = 4;

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

export function redactDetails(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactDetails(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redactDetails(v, depth + 1)]));
}

/** Who did it, from the identity the gateway forwarded. */
function actorOf(req) {
  const user = req?.user;
  const header = (name) => req?.headers?.[name];
  return {
    id: user?.id ?? header('x-user-id') ?? null,
    email: user?.email ?? header('x-user-email') ?? null,
    role: user?.role ?? header('x-user-role') ?? null,
  };
}

/**
 * Appends one entry to the current agency's audit log. Recording must never undo or fail the
 * action it describes, so a failed write is logged as an error and swallowed.
 *
 * `db` is the service's tenant-scoped Prisma client (its raw SQL sets the agency for row-level
 * security) or, in auth-service, the admin client.
 */
export async function recordAudit(db, req, { action, targetType, targetId, summary, details }, { logger } = {}) {
  const tenantId = getTenantId();
  try {
    if (!tenantId) throw new Error('no agency set for this audit entry');
    if (!ACTION.test(action || '')) throw new Error(`invalid audit action: ${action}`);
    const actor = actorOf(req);
    const safeDetails = details == null ? null : JSON.stringify(redactDetails(details));
    await db.$executeRaw`
      INSERT INTO crm_platform."AuditLog"
        ("tenantId", "actorId", "actorEmail", "actorRole", "action", "targetType", "targetId",
         "summary", "details", "ipAddress", "requestId")
      VALUES (${tenantId}::uuid, ${clip(actor.id, 64)}, ${clip(actor.email, 254)}, ${clip(actor.role, 32)},
              ${action}, ${clip(targetType, 32)}, ${clip(targetId, 64)}, ${clip(summary || action, 300)},
              ${safeDetails}::jsonb, ${clip(req?.headers?.['x-client-ip'] ?? req?.ip, 64)},
              ${clip(req?.requestId ?? req?.headers?.['x-request-id'], 64)})`;
    return true;
  } catch (err) {
    logger?.error?.({ err: { message: err.message, code: err.code }, action, requestId: req?.requestId }, 'audit log write failed');
    return false;
  }
}

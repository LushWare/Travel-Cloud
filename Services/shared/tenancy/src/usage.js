import { requireTenantId } from './context.js';
import { getCurrentTenantEntitlements } from './entitlements.js';

// Metered sends and the plan limit that caps each one per calendar month (UTC).
export const USAGE_METRICS = Object.freeze({
  emails: 'emails_per_month',
  whatsapp: 'whatsapp_per_month',
});

// Share of the monthly limit at which the agency is warned once.
export const USAGE_WARNING_SHARE = 0.8;

export const USAGE_LIMIT_REACHED = 'USAGE_LIMIT_REACHED';

const METRIC_NOUN = { emails: 'customer emails', whatsapp: 'WhatsApp messages' };

/** What a person is told when a send is refused because the month's allowance is used up. */
export function usageLimitMessage(metric, limit) {
  return `Your agency has used this month's allowance of ${limit} ${METRIC_NOUN[metric] ?? metric}. `
    + 'Sending resumes on the 1st of next month, or ask your agency owner about upgrading.';
}

/** The audit entry recorded once a month when an agency reaches 80% of an allowance. */
export function usageWarningAudit({ metric, limit, used }) {
  return {
    action: 'plan.usage_warning',
    targetType: 'usage',
    targetId: metric,
    summary: `Used ${used} of ${limit} ${METRIC_NOUN[metric] ?? metric} this month`,
    details: { metric, limit, used, period: usagePeriod() },
  };
}

/** The month a send counts towards, as the first day of that month (UTC), e.g. '2026-11-01'. */
export function usagePeriod(now = new Date()) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

function metricLimitKey(metric) {
  const key = USAGE_METRICS[metric];
  if (!key) throw new TypeError(`Unknown usage metric: ${metric}`);
  return key;
}

/**
 * Takes one unit of this month's allowance before a send. The check and the increment are one
 * statement, so two sends racing for the last unit cannot both get it.
 *
 * Returns { allowed: false, limit, used } when the allowance is used up (nothing was counted),
 * or { allowed: true, limit, used, crossedWarning, release } where `release()` gives the unit
 * back if the send then fails. `crossedWarning` is a candidate; its once-per-month claim is made
 * only after a successful send so a failed send cannot consume the warning.
 *
 * `prisma` is the service's tenant-scoped client, whose raw SQL runs with the agency set for
 * row-level security.
 */
export async function reserveUsage(prisma, metric, { now = new Date() } = {}) {
  const limitKey = metricLimitKey(metric);
  const tenantId = requireTenantId();
  const period = usagePeriod(now);
  const { entitlements } = await getCurrentTenantEntitlements(prisma);
  const limit = entitlements[limitKey] ?? null;

  if (limit === 0) return { allowed: false, limit, used: 0 };

  const rows = await prisma.$queryRawUnsafe(
    `INSERT INTO crm_platform."UsageCounter" ("tenantId", "metric", "period", "count")
     VALUES ($1::uuid, $2, $3::date, 1)
     ON CONFLICT ("tenantId", "metric", "period") DO UPDATE
       SET "count" = "UsageCounter"."count" + 1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE $4::int IS NULL OR "UsageCounter"."count" < $4::int
     RETURNING "count", "warnedAt"`,
    tenantId, metric, period, limit,
  );
  if (rows.length === 0) return { allowed: false, limit, used: limit };

  const used = Number(rows[0].count);
  const crossedWarning = limit !== null
    && rows[0].warnedAt == null
    && used >= Math.ceil(limit * USAGE_WARNING_SHARE);

  const release = () => prisma.$executeRawUnsafe(
    `UPDATE crm_platform."UsageCounter" SET "count" = GREATEST("count" - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
     WHERE "tenantId" = $1::uuid AND "metric" = $2 AND "period" = $3::date`,
    tenantId, metric, period,
  );

  return { allowed: true, limit, used, crossedWarning, period, release };
}

async function claimUsageWarning(prisma, metric, limit, period) {
  const tenantId = requireTenantId();
  const rows = await prisma.$queryRawUnsafe(
    `UPDATE crm_platform."UsageCounter" SET "warnedAt" = CURRENT_TIMESTAMP
     WHERE "tenantId" = $1::uuid AND "metric" = $2 AND "period" = $3::date
       AND "warnedAt" IS NULL AND "count" >= $4::int
     RETURNING "count"`,
    tenantId, metric, period, Math.ceil(limit * USAGE_WARNING_SHARE),
  );
  return rows.length > 0 ? Number(rows[0].count) : null;
}

/**
 * Runs `send` against this month's allowance: counts it first, refuses it with `onLimit(...)`'s
 * error when the allowance is used up, and gives the unit back if `send` throws.
 *
 * Counting is bookkeeping, not protection: if the counter cannot be read or written (database
 * blip, migration not yet applied) the send still goes out and the failure is logged as an error.
 * A broken counter must never stop an agency sending its invoices.
 *
 * `onWarning({ metric, limit, used })` runs once per month, after the send that first reaches
 * USAGE_WARNING_SHARE of the limit; its failure is logged and does not affect the send.
 */
export async function meteredSend(prisma, metric, send, { onLimit, onWarning, logger } = {}) {
  let reservation;
  try {
    reservation = await reserveUsage(prisma, metric);
  } catch (err) {
    if (err?.code === 'TENANT_CONTEXT_MISSING' || err instanceof TypeError) throw err;
    logger?.error?.({ err: { message: err.message, code: err.code }, metric }, 'Could not count usage; sending without the monthly limit');
    return send();
  }

  if (!reservation.allowed) {
    throw onLimit ? onLimit({ metric, limit: reservation.limit }) : Object.assign(
      new Error(`Monthly ${metric} allowance used up`), { code: USAGE_LIMIT_REACHED, statusCode: 429 },
    );
  }

  let result;
  try {
    result = await send();
  } catch (err) {
    await reservation.release().catch((releaseErr) =>
      logger?.error?.({ err: { message: releaseErr.message }, metric }, 'Could not give back a usage unit after a failed send'));
    throw err;
  }

  if (reservation.crossedWarning) {
    try {
      const used = await claimUsageWarning(prisma, metric, reservation.limit, reservation.period);
      if (used !== null && onWarning) await onWarning({ metric, limit: reservation.limit, used });
    } catch (err) {
      logger?.error?.({ err: { message: err.message }, metric }, 'Usage warning could not be claimed or delivered');
    }
  }
  return result;
}

/** This month's count for each metric, for the plan summary screens. */
export async function currentUsage(prisma, { now = new Date() } = {}) {
  const tenantId = requireTenantId();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "metric", "count" FROM crm_platform."UsageCounter"
     WHERE "tenantId" = $1::uuid AND "period" = $2::date`,
    tenantId, usagePeriod(now),
  );
  const usage = Object.fromEntries(Object.keys(USAGE_METRICS).map((metric) => [metric, 0]));
  for (const row of rows) if (row.metric in usage) usage[row.metric] = Number(row.count);
  return usage;
}

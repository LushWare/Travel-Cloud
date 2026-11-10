import logger from '../config/logger.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// Hand-written SQL is not filtered automatically: every statement names the agency itself.
const agency = () => requireTenantId();

// ─── Insight lifecycle state ──────────────────────────────────────────────
// Reads and writes the two tables the ranking work needs, with two policies that
// matter more than the queries:
//
//   READ FAILS OPEN. A suppression read that fails must show everything. The
//   failure mode of the alternative is the worst one in this design: an empty
//   panel on a transient database blip, which an operator cannot distinguish
//   from a quiet page. Showing an item they already acknowledged costs a glance.
//
//   WRITES NEVER BREAK THE PRODUCT. Surfacing counters and decision rows are
//   instrumentation. If either write fails the operator still gets their
//   briefing, so both swallow errors and log.
//
// `prisma` is a parameter rather than an import, which is what lets the fail-open
// and swallow behaviours be tested without a database.

/** Drops from the structural layers are counted, not stored per row. */
const STRUCTURAL_LAYERS = new Set(['L0', 'L1', 'L2']);

/**
 * Which decisions are worth a row. A page can produce an insight per record, so
 * storing "no citation" or "malformed" thousands of times per load would bury the
 * decisions that answer "why is this not showing". Structural drops become
 * aggregate counters instead (ranking design, PERF-2/3A).
 */
export function decisionsWorthPersisting(decisions = []) {
  return decisions.filter((entry) => !STRUCTURAL_LAYERS.has(entry.layer));
}

/** Rows keyed by insight key, the shape the gate expects for `priorState`. */
export function statesToMap(rows = []) {
  return new Map(
    rows.map((row) => [
      row.insightKey,
      {
        lastSurfacedAt: row.lastSurfacedAt ?? null,
        acknowledgedAt: row.acknowledgedAt ?? null,
        surfacedCount: row.surfacedCount ?? 0,
        snoozedUntil: row.snoozedUntil ?? null,
        lastMaterialValue: row.lastMaterialValue ?? undefined,
      },
    ]),
  );
}

/** Shape decisions for a bulk insert. Pure, so the mapping is testable. */
export function buildDecisionRows({
  decisions = [],
  requestId = null,
  actorId,
  pageKey,
  scopeFingerprint,
  rankingVersion = null,
  severityByKey = new Map(),
  scoreByKey = new Map(),
} = {}) {
  return decisionsWorthPersisting(decisions).map((entry) => ({
    requestId,
    actorId,
    pageKey,
    scopeFingerprint,
    insightKey: entry.key ?? '',
    ruleId: entry.ruleId ?? null,
    entityKind: entry.entityRef?.kind ?? null,
    entityId: entry.entityRef?.id ?? null,
    severity: entry.severity ?? severityByKey.get(entry.key) ?? 'info',
    rankScore: entry.score ?? scoreByKey.get(entry.key) ?? null,
    decision: entry.decision,
    reason: entry.reason,
    rankingVersion,
  }));
}

/**
 * Prior state for one actor, page and scope. One query, not one per insight.
 * Fails open: an unreadable state means "treat everything as new", which shows
 * more than it should rather than nothing at all.
 */
export async function loadPriorState({ prisma, actorId, pageKey, scopeFingerprint }) {
  if (!prisma?.insightState?.findMany) return new Map();
  try {
    const rows = await prisma.insightState.findMany({ where: { actorId, pageKey, scopeFingerprint } });
    return statesToMap(rows);
  } catch (err) {
    logger.warn(
      { err: err?.message, actorId, pageKey },
      'insight state read failed — showing everything rather than nothing',
    );
    return new Map();
  }
}

/**
 * Count that these insights were shown. Two statements regardless of how many
 * keys, because one upsert per insight is a query storm on a page that can
 * produce hundreds:
 *
 *   1. insert the ones that do not exist yet, ignoring conflicts
 *   2. increment every key in one UPDATE
 *
 * Best-effort: the caller does not await it and a failure is logged, not raised.
 */
export async function markSurfaced({ prisma, actorId, pageKey, scopeFingerprint, keys = [] }) {
  if (!prisma || keys.length === 0) return { written: 0 };
  try {
    await prisma.insightState.createMany({
      data: keys.map((insightKey) => ({ actorId, pageKey, scopeFingerprint, insightKey })),
      skipDuplicates: true,
    });
    await prisma.$executeRaw`
      UPDATE "crm_assistant"."InsightState"
         SET "surfacedCount" = "surfacedCount" + 1, "lastSurfacedAt" = NOW()
       WHERE "tenantId" = ${agency()}::uuid
         AND "actorId" = ${actorId}
         AND "pageKey" = ${pageKey}
         AND "scopeFingerprint" = ${scopeFingerprint}
         AND "insightKey" = ANY(${keys})`;
    return { written: keys.length };
  } catch (err) {
    logger.warn({ err: err?.message, actorId, pageKey }, 'surfacing counters not written');
    return { written: 0, failed: true };
  }
}

/** Bulk-write the decisions. Best-effort for the same reason as the counters. */
export async function recordDecisions({ prisma, rows = [] }) {
  if (!prisma?.insightDecision?.createMany || rows.length === 0) return { written: 0 };
  try {
    const result = await prisma.insightDecision.createMany({ data: rows });
    return { written: result?.count ?? rows.length };
  } catch (err) {
    logger.warn({ err: err?.message, count: rows.length }, 'insight decisions not written');
    return { written: 0, failed: true };
  }
}

/**
 * Mark the surfaced insights as acknowledged. Called from the acknowledgement
 * route, and awaited on purpose there (a failed acknowledgement must be visible,
 * unlike a failed counter) — the caller decides, this function only writes.
 */
export async function acknowledgeKeys({ prisma, actorId, pageKey, scopeFingerprint, keys = [] }) {
  if (!prisma || keys.length === 0) return { written: 0 };
  const result = await prisma.insightState.updateMany({
    where: { actorId, pageKey, scopeFingerprint, insightKey: { in: keys } },
    data: { acknowledgedAt: new Date() },
  });
  return { written: result?.count ?? 0 };
}

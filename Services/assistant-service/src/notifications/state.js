import logger from '../config/logger.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

export function notificationStatesToMap(rows = []) {
  return new Map(rows.map((row) => [row.notificationKey, row]));
}

/** A failed suppression read shows more notifications rather than hiding them. */
export async function loadNotificationState({ prisma, actorId }) {
  try {
    const rows = await prisma.businessNotificationState.findMany({ where: { actorId } });
    return notificationStatesToMap(rows);
  } catch (error) {
    logger.warn({ err: error, actorId }, 'Failed to read business notification state');
    return new Map();
  }
}

/**
 * Persist one notification lifecycle action. These writes are intentionally
 * best-effort: a state write must never make the notification panel unusable.
 */
export async function markNotificationsSeen({
  prisma,
  actorId,
  keys = [],
  action,
  materialValuesByKey = new Map(),
}) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return 0;
  const now = new Date();

  try {
    if (action === 'read') {
      await prisma.businessNotificationState.createMany({
        data: uniqueKeys.map((notificationKey) => ({ actorId, notificationKey })),
        skipDuplicates: true,
      });
      await prisma.businessNotificationState.updateMany({
        where: { actorId, notificationKey: { in: uniqueKeys } },
        data: { lastSeenAt: now, surfacedCount: { increment: 1 } },
      });
      return uniqueKeys.length;
    }

    const field = action === 'dismiss' ? 'dismissedAt' : 'acknowledgedAt';
    await Promise.all(
      uniqueKeys.map((notificationKey) => {
        const materialValue = materialValuesByKey.get(notificationKey) ?? null;
        const lifecycle = action === 'dismiss'
          ? { dismissedAt: now, acknowledgedAt: null }
          : { acknowledgedAt: now, dismissedAt: null };
        return prisma.businessNotificationState.upsert({
          where: { tenantId_actorId_notificationKey: { tenantId: requireTenantId(), actorId, notificationKey } },
          create: {
            actorId,
            notificationKey,
            lastSeenAt: now,
            surfacedCount: 1,
            lastMaterialValue: materialValue,
            ...lifecycle,
          },
          update: {
            lastSeenAt: now,
            lastMaterialValue: materialValue,
            ...lifecycle,
          },
        });
      }),
    );
    return uniqueKeys.length;
  } catch (error) {
    logger.warn({ err: error, actorId, action }, 'Failed to write business notification state');
    return 0;
  }
}

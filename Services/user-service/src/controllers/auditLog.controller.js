import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';

const VISITS_SHOWN = 10;

/**
 * Lushware support visits to this agency (view-only help access opened from the console),
 * newest first. This is the only part of the audit log an agency sees: the rest (its own staff
 * actions, plan changes and Lushware's internal notes) stays recorded but is not shown.
 */
export const listSupportAccess = asyncHandler(async (_req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'platform.help_access_started' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: VISITS_SHOWN,
    select: { id: true, createdAt: true, details: true },
  });

  const visits = rows.map((row) => {
    const details = row.details && typeof row.details === 'object' ? row.details : {};
    return {
      id: row.id,
      startedAt: row.createdAt,
      minutes: Number.isInteger(details.minutes) ? details.minutes : null,
      reason: typeof details.reason === 'string' ? details.reason : null,
    };
  });

  res.json({ status: 'success', data: visits });
});

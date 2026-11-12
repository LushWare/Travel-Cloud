import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { formatZodError } from '../validators/common.js';
import { listAuditLogQuerySchema } from '../validators/auditLog.validator.js';

// A date-only "to" means the whole of that day.
const endOf = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value));

/** The current agency's audit log, newest first, one page at a time. */
export const listAuditLog = asyncHandler(async (req, res) => {
  const parsed = listAuditLogQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  const { action, actorId, from, to, cursor, limit } = parsed.data;

  const where = {
    ...(action && (action.includes('.') ? { action } : { action: { startsWith: `${action}.` } })),
    ...(actorId && { actorId }),
    ...((from || to) && { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: endOf(to) }) } }),
  };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;

  res.json({
    status: 'success',
    data: entries,
    pagination: { limit, nextCursor: hasMore ? entries[entries.length - 1].id : null },
  });
});

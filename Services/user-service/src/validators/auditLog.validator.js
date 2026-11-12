import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'));

export const listAuditLogQuerySchema = z
  .object({
    // A full action ("staff.removed") or a group ("staff").
    action: z.string().regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)?$/, 'action must look like "staff" or "staff.removed"').optional(),
    actorId: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

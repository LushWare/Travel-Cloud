import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import { getCurrentTenantEntitlements, getTenantId } from '../../../shared/tenancy/src/index.js';

const STAFF_ROLES = ['superAdmin', 'admin', 'salesRep', 'vendor'];

export async function withStaffSeat(operation) {
  const tenantId = getTenantId();
  // A login with no agency cannot add anyone; say so plainly instead of failing as a server error.
  if (!tenantId) throw new AppError('Your session has expired. Please sign in again.', 401);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 601)`;
    const resolved = await getCurrentTenantEntitlements(tx);
    const limit = resolved.entitlements.staff_seats;

    if (limit !== null) {
      const used = await tx.membership.count({
        where: { role: { in: STAFF_ROLES }, status: { in: ['active', 'invited'] } },
      });
      if (used >= limit) {
        throw new AppError('Your agency has reached its staff-seat limit. Contact your platform administrator to change the plan.', 403, { code: 'PLAN_LIMIT_REACHED' });
      }
    }

    return operation(tx);
  });
}
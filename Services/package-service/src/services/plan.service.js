import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import { getCurrentTenantEntitlements, requireTenantId } from '../../../shared/tenancy/src/index.js';

export function createPackageWithinPlanLimit(data, options = {}) {
  const tenantId = requireTenantId();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 602)`;
    const resolved = await getCurrentTenantEntitlements(tx);
    const limit = resolved.entitlements.packages;

    if (limit !== null) {
      const used = await tx.package.count();
      if (used >= limit) {
        throw new AppError('Your agency has reached its package limit. Contact your platform administrator to change the plan.', 403, { code: 'PLAN_LIMIT_REACHED' });
      }
    }

    return tx.package.create({ data, ...options });
  });
}

export function requirePlanFeature(key) {
  return async (req, res, next) => {
    try {
      const resolved = await getCurrentTenantEntitlements(prisma);
      if (resolved.entitlements.features[key] !== true) {
        return next(new AppError('This feature is not included in your agency plan. Contact your platform administrator.', 403, { code: 'FEATURE_NOT_INCLUDED' }));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
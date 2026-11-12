import prisma from '../db/client.js';
import logger from '../config/logger.js';
import AppError from '../utils/appError.js';
import {
  FEATURE_NOT_IN_PLAN, FEATURE_NOT_IN_PLAN_MESSAGE, USAGE_LIMIT_REACHED,
  hasPlanFeature, meteredSend, recordAudit, sendUsageWarningEmail, usageLimitMessage, usageWarningAudit,
} from '../../../shared/tenancy/src/index.js';

/** Refuses an action whose module the agency's plan leaves out (read live from the plan). */
export async function assertPlanFeature(key) {
  if (await hasPlanFeature(prisma, key)) return;
  throw new AppError(FEATURE_NOT_IN_PLAN_MESSAGE, 403, { code: FEATURE_NOT_IN_PLAN });
}

/** Sends one customer message against the agency's monthly allowance; see billing-service's twin. */
export function metered(metric, send) {
  return meteredSend(prisma, metric, send, {
    logger,
    onLimit: ({ limit }) => new AppError(usageLimitMessage(metric, limit), 429, { code: USAGE_LIMIT_REACHED }),
    onWarning: async (usage) => {
      logger.warn({ ...usage }, 'Agency reached 80% of a monthly sending allowance');
      await recordAudit(prisma, null, usageWarningAudit(usage), { logger });
      await sendUsageWarningEmail(prisma, usage);
    },
  });
}

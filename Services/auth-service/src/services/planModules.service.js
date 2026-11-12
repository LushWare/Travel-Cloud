import prisma from '../db/client.js';
import logger from '../config/logger.js';
import {
  getCurrentTenantEntitlements, runWithTenant, switchedOffModules,
} from '../../../shared/tenancy/src/index.js';

/**
 * The plan modules an agency does not have, for the staff login token's `off` claim.
 *
 * A failure to read the plan must not stop anyone signing in: plans decide what is sold, not
 * who may see what (that is the agency, role and row-level security). So a lookup error is
 * logged and the login carries no list, which the gateway reads as "nothing switched off".
 * The services still check the modules themselves for the actions that matter most.
 */
export async function modulesSwitchedOffFor(tenantId) {
  if (!tenantId) return [];
  try {
    const { entitlements } = await runWithTenant(tenantId, () => getCurrentTenantEntitlements(prisma));
    return switchedOffModules(entitlements);
  } catch (err) {
    logger.error({ err, tenantId }, 'Could not read the agency plan; signing in without module limits');
    return [];
  }
}

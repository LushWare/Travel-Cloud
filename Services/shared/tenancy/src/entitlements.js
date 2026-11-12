import { requireTenantId } from './context.js';

export const FEATURE_ENTITLEMENTS = Object.freeze({
  ai_itinerary_builder: 'AI itinerary builder',
});

export const LIMIT_ENTITLEMENTS = Object.freeze({
  staff_seats: 'Staff seats',
  packages: 'Packages',
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function normalizePlanEntitlements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Plan entitlements must be an object');
  }

  for (const key of Object.keys(value)) {
    if (key !== 'features' && !hasOwn(LIMIT_ENTITLEMENTS, key)) {
      throw new TypeError(`Unsupported entitlement: ${key}`);
    }
  }

  const limits = {};
  for (const key of Object.keys(LIMIT_ENTITLEMENTS)) {
    const limit = value[key] ?? null;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new TypeError(`${key} must be a non-negative integer or null`);
    }
    limits[key] = limit;
  }

  const suppliedFeatures = value.features ?? {};
  if (!suppliedFeatures || typeof suppliedFeatures !== 'object' || Array.isArray(suppliedFeatures)) {
    throw new TypeError('Feature entitlements must be an object');
  }
  for (const key of Object.keys(suppliedFeatures)) {
    if (!hasOwn(FEATURE_ENTITLEMENTS, key)) throw new TypeError(`Unsupported feature: ${key}`);
    if (typeof suppliedFeatures[key] !== 'boolean') throw new TypeError(`features.${key} must be a boolean`);
  }

  return {
    ...limits,
    features: Object.fromEntries(
      Object.keys(FEATURE_ENTITLEMENTS).map((key) => [key, suppliedFeatures[key] ?? false]),
    ),
  };
}

export function resolveEntitlements({ planVersion = null, overrides = [] } = {}) {
  const planValues = planVersion ? normalizePlanEntitlements(planVersion.entitlements) : null;
  const entitlements = planValues ?? {
    staff_seats: null,
    packages: null,
    features: Object.fromEntries(Object.keys(FEATURE_ENTITLEMENTS).map((key) => [key, true])),
  };
  const source = Object.fromEntries([
    ...Object.keys(LIMIT_ENTITLEMENTS),
    ...Object.keys(FEATURE_ENTITLEMENTS).map((key) => `features.${key}`),
  ].map((key) => [key, planVersion ? 'plan' : 'default']));

  for (const override of overrides) {
    const { entitlementKey, value } = override;
    if (hasOwn(LIMIT_ENTITLEMENTS, entitlementKey)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid override for ${entitlementKey}`);
      entitlements[entitlementKey] = value;
    } else if (entitlementKey.startsWith('features.') && hasOwn(FEATURE_ENTITLEMENTS, entitlementKey.slice(9))) {
      if (typeof value !== 'boolean') throw new TypeError(`Invalid override for ${entitlementKey}`);
      entitlements.features[entitlementKey.slice(9)] = value;
    } else {
      throw new TypeError(`Unsupported entitlement override: ${entitlementKey}`);
    }
    source[entitlementKey] = 'override';
  }

  return {
    plan: planVersion ? {
      id: planVersion.plan?.id ?? planVersion.planId,
      key: planVersion.plan?.key ?? null,
      versionId: planVersion.id,
      version: planVersion.version,
      name: planVersion.name,
      description: planVersion.description ?? null,
      priceMinorUnits: planVersion.priceMinorUnits ?? null,
      currency: planVersion.currency ?? 'USD',
      billingInterval: planVersion.billingInterval ?? null,
    } : null,
    entitlements,
    source,
  };
}

export async function getCurrentTenantEntitlements(prisma) {
  const tenantId = requireTenantId();
  const [assignment] = await prisma.$queryRawUnsafe(
    `SELECT pv."id", pv."planId", pv."version", pv."name", pv."description",
            pv."priceMinorUnits", pv."currency", pv."billingInterval", pv."entitlements",
            p."id" AS "catalogPlanId", p."key" AS "planKey"
     FROM crm_platform."TenantPlan" tp
     JOIN crm_platform."PlanVersion" pv ON pv."id" = tp."planVersionId"
     JOIN crm_platform."Plan" p ON p."id" = pv."planId"
     WHERE tp."tenantId" = $1::uuid
     LIMIT 1`,
    tenantId,
  );
  const overrides = await prisma.$queryRawUnsafe(
    `SELECT "entitlementKey", "value"
     FROM crm_platform."PlanEntitlementOverride"
     WHERE "tenantId" = $1::uuid`,
    tenantId,
  );

  const planVersion = assignment ? {
    ...assignment,
    plan: { id: assignment.catalogPlanId, key: assignment.planKey },
  } : null;
  return resolveEntitlements({ planVersion, overrides });
}
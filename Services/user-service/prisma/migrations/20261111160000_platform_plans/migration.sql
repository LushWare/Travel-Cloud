CREATE TABLE "crm_platform"."Plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Plan_key_format" CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);
CREATE UNIQUE INDEX "Plan_key_key" ON "crm_platform"."Plan"("key");

CREATE TABLE "crm_platform"."PlanVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "planId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "priceMinorUnits" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "billingInterval" VARCHAR(16),
  "entitlements" JSONB NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "crm_platform"."Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlanVersion_version_positive" CHECK ("version" > 0),
  CONSTRAINT "PlanVersion_price_nonnegative" CHECK ("priceMinorUnits" IS NULL OR "priceMinorUnits" >= 0),
  CONSTRAINT "PlanVersion_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "PlanVersion_billing_interval" CHECK ("billingInterval" IS NULL OR "billingInterval" IN ('monthly', 'annual')),
  CONSTRAINT "PlanVersion_entitlements_object" CHECK (jsonb_typeof("entitlements") = 'object')
);
CREATE UNIQUE INDEX "PlanVersion_planId_version_key" ON "crm_platform"."PlanVersion"("planId", "version");
CREATE UNIQUE INDEX "PlanVersion_one_current_per_plan" ON "crm_platform"."PlanVersion"("planId") WHERE "isCurrent";
CREATE INDEX "PlanVersion_planId_isCurrent_idx" ON "crm_platform"."PlanVersion"("planId", "isCurrent");

CREATE TABLE "crm_platform"."TenantPlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "planVersionId" UUID NOT NULL,
  "priceMinorUnits" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'USD',
  "assignedById" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "crm_platform"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TenantPlan_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "crm_platform"."PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TenantPlan_price_nonnegative" CHECK ("priceMinorUnits" IS NULL OR "priceMinorUnits" >= 0),
  CONSTRAINT "TenantPlan_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "TenantPlan_tenantId_key" ON "crm_platform"."TenantPlan"("tenantId");
CREATE INDEX "TenantPlan_planVersionId_idx" ON "crm_platform"."TenantPlan"("planVersionId");

CREATE TABLE "crm_platform"."PlanEntitlementOverride" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "entitlementKey" VARCHAR(64) NOT NULL,
  "value" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "changedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanEntitlementOverride_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanEntitlementOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "crm_platform"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PlanEntitlementOverride_reason_nonempty" CHECK (length(trim("reason")) >= 5),
  CONSTRAINT "PlanEntitlementOverride_scalar_value" CHECK (jsonb_typeof("value") IN ('number', 'boolean'))
);
CREATE UNIQUE INDEX "PlanEntitlementOverride_tenantId_entitlementKey_key" ON "crm_platform"."PlanEntitlementOverride"("tenantId", "entitlementKey");
CREATE INDEX "PlanEntitlementOverride_tenantId_idx" ON "crm_platform"."PlanEntitlementOverride"("tenantId");

ALTER TABLE "crm_platform"."Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."Plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Plan_catalog_read" ON "crm_platform"."Plan" FOR SELECT USING (true);
ALTER TABLE "crm_platform"."PlanVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlanVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PlanVersion_catalog_read" ON "crm_platform"."PlanVersion" FOR SELECT USING (true);
ALTER TABLE "crm_platform"."TenantPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."TenantPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantPlan_read_own_tenant" ON "crm_platform"."TenantPlan" FOR SELECT
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);
ALTER TABLE "crm_platform"."PlanEntitlementOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlanEntitlementOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PlanEntitlementOverride_read_own_tenant" ON "crm_platform"."PlanEntitlementOverride" FOR SELECT
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT ON "crm_platform"."Plan", "crm_platform"."PlanVersion",
      "crm_platform"."TenantPlan", "crm_platform"."PlanEntitlementOverride" TO crm_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "crm_platform"."Plan", "crm_platform"."PlanVersion",
      "crm_platform"."TenantPlan", "crm_platform"."PlanEntitlementOverride" FROM crm_app;
  END IF;
END $$;

-- Monthly usage per agency for metered sends (customer emails and WhatsApp messages).
-- One row per agency, metric and calendar month (UTC). Services reserve a unit before sending
-- and give it back if the send fails, so the count is what actually went out.
CREATE TABLE IF NOT EXISTS "crm_platform"."UsageCounter" (
  "tenantId" UUID NOT NULL,
  "metric" VARCHAR(32) NOT NULL,
  "period" DATE NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  -- Set once, when the agency first passes 80% of its limit in this month.
  "warnedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("tenantId", "metric", "period"),
  CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "crm_platform"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UsageCounter_metric_known" CHECK ("metric" IN ('emails', 'whatsapp')),
  CONSTRAINT "UsageCounter_period_month_start" CHECK (EXTRACT(DAY FROM "period") = 1),
  CONSTRAINT "UsageCounter_count_nonnegative" CHECK ("count" >= 0)
);

-- An agency reads and changes only its own counters, and never deletes them.
ALTER TABLE "crm_platform"."UsageCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."UsageCounter" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "UsageCounter_read_own_tenant" ON "crm_platform"."UsageCounter";
CREATE POLICY "UsageCounter_read_own_tenant" ON "crm_platform"."UsageCounter" FOR SELECT
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS "UsageCounter_insert_own_tenant" ON "crm_platform"."UsageCounter";
CREATE POLICY "UsageCounter_insert_own_tenant" ON "crm_platform"."UsageCounter" FOR INSERT
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS "UsageCounter_update_own_tenant" ON "crm_platform"."UsageCounter";
CREATE POLICY "UsageCounter_update_own_tenant" ON "crm_platform"."UsageCounter" FOR UPDATE
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "crm_platform"."UsageCounter" TO crm_app;
    REVOKE DELETE, TRUNCATE ON "crm_platform"."UsageCounter" FROM crm_app;
  END IF;
END $$;

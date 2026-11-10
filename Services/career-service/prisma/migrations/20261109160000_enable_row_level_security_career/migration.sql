-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_careers"."Career" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_careers"."Career" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_careers"."Career";
CREATE POLICY tenant_isolation ON "crm_careers"."Career"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_careers"."Vacancy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_careers"."Vacancy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_careers"."Vacancy";
CREATE POLICY tenant_isolation ON "crm_careers"."Vacancy"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

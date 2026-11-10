-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_users"."VendorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_users"."VendorProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_users"."VendorProfile";
CREATE POLICY tenant_isolation ON "crm_users"."VendorProfile"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_users"."OrganizationSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_users"."OrganizationSettings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_users"."OrganizationSettings";
CREATE POLICY tenant_isolation ON "crm_users"."OrganizationSettings"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_users"."PolicyDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_users"."PolicyDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_users"."PolicyDocument";
CREATE POLICY tenant_isolation ON "crm_users"."PolicyDocument"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_users"."Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_users"."Membership" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_users"."Membership";
CREATE POLICY tenant_isolation ON "crm_users"."Membership"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

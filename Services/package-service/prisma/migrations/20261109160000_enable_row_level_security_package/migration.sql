-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_packages"."Package" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Package" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Package";
CREATE POLICY tenant_isolation ON "crm_packages"."Package"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Package_Image" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Package_Image" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Package_Image";
CREATE POLICY tenant_isolation ON "crm_packages"."Package_Image"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Itinerary_Day" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Itinerary_Day" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Itinerary_Day";
CREATE POLICY tenant_isolation ON "crm_packages"."Itinerary_Day"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Place" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Place" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Place";
CREATE POLICY tenant_isolation ON "crm_packages"."Place"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Package_Day_Place" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Package_Day_Place" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Package_Day_Place";
CREATE POLICY tenant_isolation ON "crm_packages"."Package_Day_Place"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Activity_Catalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Activity_Catalog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Activity_Catalog";
CREATE POLICY tenant_isolation ON "crm_packages"."Activity_Catalog"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Package_Day_Activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Package_Day_Activity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Package_Day_Activity";
CREATE POLICY tenant_isolation ON "crm_packages"."Package_Day_Activity"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Package_Day_Transport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Package_Day_Transport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Package_Day_Transport";
CREATE POLICY tenant_isolation ON "crm_packages"."Package_Day_Transport"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."Review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."Review" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."Review";
CREATE POLICY tenant_isolation ON "crm_packages"."Review"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_packages"."HotelBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_packages"."HotelBooking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_packages"."HotelBooking";
CREATE POLICY tenant_isolation ON "crm_packages"."HotelBooking"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

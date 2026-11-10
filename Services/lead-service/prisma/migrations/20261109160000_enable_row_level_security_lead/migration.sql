-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_leads"."Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."Lead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."Lead";
CREATE POLICY tenant_isolation ON "crm_leads"."Lead"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."CustomizedPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."CustomizedPackage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."CustomizedPackage";
CREATE POLICY tenant_isolation ON "crm_leads"."CustomizedPackage"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."ManualItinerary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."ManualItinerary" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."ManualItinerary";
CREATE POLICY tenant_isolation ON "crm_leads"."ManualItinerary"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadPackageSelection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadPackageSelection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadPackageSelection";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadPackageSelection"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadRemark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadRemark" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadRemark";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadRemark"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadStatusHistory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadStatusHistory";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadStatusHistory"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadCommunicationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadCommunicationLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadCommunicationLog";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadCommunicationLog"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadInternalEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadInternalEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadInternalEvent";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadInternalEvent"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadPricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadPricing" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadPricing";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadPricing"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadCostLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadCostLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadCostLine";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadCostLine"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadItineraryDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadItineraryDay" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadItineraryDay";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadItineraryDay"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadDayPlace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadDayPlace" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadDayPlace";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadDayPlace"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadDayActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadDayActivity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadDayActivity";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadDayActivity"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadDayImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadDayImage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadDayImage";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadDayImage"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadDayTransport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadDayTransport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadDayTransport";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadDayTransport"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."LeadOptionalFlight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."LeadOptionalFlight" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."LeadOptionalFlight";
CREATE POLICY tenant_isolation ON "crm_leads"."LeadOptionalFlight"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_leads"."Settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_leads"."Settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_leads"."Settings";
CREATE POLICY tenant_isolation ON "crm_leads"."Settings"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

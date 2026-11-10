-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_leads"."Lead" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."Lead" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Lead_tenantId_idx" ON "crm_leads"."Lead"("tenantId");

ALTER TABLE "crm_leads"."CustomizedPackage" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."CustomizedPackage" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."CustomizedPackage" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "CustomizedPackage_tenantId_idx" ON "crm_leads"."CustomizedPackage"("tenantId");

ALTER TABLE "crm_leads"."ManualItinerary" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."ManualItinerary" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."ManualItinerary" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "ManualItinerary_tenantId_idx" ON "crm_leads"."ManualItinerary"("tenantId");

ALTER TABLE "crm_leads"."LeadPackageSelection" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadPackageSelection" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadPackageSelection" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadPackageSelection_tenantId_idx" ON "crm_leads"."LeadPackageSelection"("tenantId");

ALTER TABLE "crm_leads"."LeadRemark" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadRemark" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadRemark" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadRemark_tenantId_idx" ON "crm_leads"."LeadRemark"("tenantId");

ALTER TABLE "crm_leads"."LeadStatusHistory" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadStatusHistory" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadStatusHistory" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadStatusHistory_tenantId_idx" ON "crm_leads"."LeadStatusHistory"("tenantId");

ALTER TABLE "crm_leads"."LeadCommunicationLog" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadCommunicationLog" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadCommunicationLog" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadCommunicationLog_tenantId_idx" ON "crm_leads"."LeadCommunicationLog"("tenantId");

ALTER TABLE "crm_leads"."LeadInternalEvent" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadInternalEvent" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadInternalEvent" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadInternalEvent_tenantId_idx" ON "crm_leads"."LeadInternalEvent"("tenantId");

ALTER TABLE "crm_leads"."LeadPricing" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadPricing" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadPricing" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadPricing_tenantId_idx" ON "crm_leads"."LeadPricing"("tenantId");

ALTER TABLE "crm_leads"."LeadCostLine" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadCostLine" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadCostLine" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadCostLine_tenantId_idx" ON "crm_leads"."LeadCostLine"("tenantId");

ALTER TABLE "crm_leads"."LeadItineraryDay" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadItineraryDay" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadItineraryDay" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadItineraryDay_tenantId_idx" ON "crm_leads"."LeadItineraryDay"("tenantId");

ALTER TABLE "crm_leads"."LeadDayPlace" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadDayPlace" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadDayPlace" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadDayPlace_tenantId_idx" ON "crm_leads"."LeadDayPlace"("tenantId");

ALTER TABLE "crm_leads"."LeadDayActivity" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadDayActivity" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadDayActivity" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadDayActivity_tenantId_idx" ON "crm_leads"."LeadDayActivity"("tenantId");

ALTER TABLE "crm_leads"."LeadDayImage" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadDayImage" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadDayImage" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadDayImage_tenantId_idx" ON "crm_leads"."LeadDayImage"("tenantId");

ALTER TABLE "crm_leads"."LeadDayTransport" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadDayTransport" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadDayTransport" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadDayTransport_tenantId_idx" ON "crm_leads"."LeadDayTransport"("tenantId");

ALTER TABLE "crm_leads"."LeadOptionalFlight" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."LeadOptionalFlight" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."LeadOptionalFlight" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "LeadOptionalFlight_tenantId_idx" ON "crm_leads"."LeadOptionalFlight"("tenantId");

ALTER TABLE "crm_leads"."Settings" ADD COLUMN "tenantId" UUID;
UPDATE "crm_leads"."Settings" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_leads"."Settings" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Settings_tenantId_idx" ON "crm_leads"."Settings"("tenantId");

-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_packages"."Package" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Package" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Package" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Package_tenantId_idx" ON "crm_packages"."Package"("tenantId");

ALTER TABLE "crm_packages"."Package_Image" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Package_Image" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Package_Image" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Package_Image_tenantId_idx" ON "crm_packages"."Package_Image"("tenantId");

ALTER TABLE "crm_packages"."Itinerary_Day" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Itinerary_Day" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Itinerary_Day" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Itinerary_Day_tenantId_idx" ON "crm_packages"."Itinerary_Day"("tenantId");

ALTER TABLE "crm_packages"."Place" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Place" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Place" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Place_tenantId_idx" ON "crm_packages"."Place"("tenantId");

ALTER TABLE "crm_packages"."Package_Day_Place" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Package_Day_Place" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Package_Day_Place" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Package_Day_Place_tenantId_idx" ON "crm_packages"."Package_Day_Place"("tenantId");

ALTER TABLE "crm_packages"."Activity_Catalog" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Activity_Catalog" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Activity_Catalog" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Activity_Catalog_tenantId_idx" ON "crm_packages"."Activity_Catalog"("tenantId");

ALTER TABLE "crm_packages"."Package_Day_Activity" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Package_Day_Activity" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Package_Day_Activity" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Package_Day_Activity_tenantId_idx" ON "crm_packages"."Package_Day_Activity"("tenantId");

ALTER TABLE "crm_packages"."Package_Day_Transport" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Package_Day_Transport" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Package_Day_Transport" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Package_Day_Transport_tenantId_idx" ON "crm_packages"."Package_Day_Transport"("tenantId");

ALTER TABLE "crm_packages"."Review" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."Review" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."Review" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Review_tenantId_idx" ON "crm_packages"."Review"("tenantId");

ALTER TABLE "crm_packages"."HotelBooking" ADD COLUMN "tenantId" UUID;
UPDATE "crm_packages"."HotelBooking" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_packages"."HotelBooking" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "HotelBooking_tenantId_idx" ON "crm_packages"."HotelBooking"("tenantId");

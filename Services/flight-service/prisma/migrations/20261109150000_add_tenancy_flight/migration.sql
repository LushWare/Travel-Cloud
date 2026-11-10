-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_flights"."FlightBooking" ADD COLUMN "tenantId" UUID;
UPDATE "crm_flights"."FlightBooking" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_flights"."FlightBooking" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "FlightBooking_tenantId_idx" ON "crm_flights"."FlightBooking"("tenantId");

ALTER TABLE "crm_flights"."FlightSegment" ADD COLUMN "tenantId" UUID;
UPDATE "crm_flights"."FlightSegment" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_flights"."FlightSegment" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "FlightSegment_tenantId_idx" ON "crm_flights"."FlightSegment"("tenantId");

ALTER TABLE "crm_flights"."FlightTraveler" ADD COLUMN "tenantId" UUID;
UPDATE "crm_flights"."FlightTraveler" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_flights"."FlightTraveler" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "FlightTraveler_tenantId_idx" ON "crm_flights"."FlightTraveler"("tenantId");

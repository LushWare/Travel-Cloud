-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_bookings"."Booking" ADD COLUMN "tenantId" UUID;
UPDATE "crm_bookings"."Booking" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_bookings"."Booking" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Booking_tenantId_idx" ON "crm_bookings"."Booking"("tenantId");

ALTER TABLE "crm_bookings"."BookingTraveler" ADD COLUMN "tenantId" UUID;
UPDATE "crm_bookings"."BookingTraveler" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_bookings"."BookingTraveler" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "BookingTraveler_tenantId_idx" ON "crm_bookings"."BookingTraveler"("tenantId");

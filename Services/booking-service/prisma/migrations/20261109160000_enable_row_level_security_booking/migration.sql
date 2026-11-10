-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_bookings"."Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_bookings"."Booking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_bookings"."Booking";
CREATE POLICY tenant_isolation ON "crm_bookings"."Booking"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_bookings"."BookingTraveler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_bookings"."BookingTraveler" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_bookings"."BookingTraveler";
CREATE POLICY tenant_isolation ON "crm_bookings"."BookingTraveler"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

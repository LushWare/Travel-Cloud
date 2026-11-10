-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_flights"."FlightBooking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_flights"."FlightBooking" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_flights"."FlightBooking";
CREATE POLICY tenant_isolation ON "crm_flights"."FlightBooking"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_flights"."FlightSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_flights"."FlightSegment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_flights"."FlightSegment";
CREATE POLICY tenant_isolation ON "crm_flights"."FlightSegment"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_flights"."FlightTraveler" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_flights"."FlightTraveler" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_flights"."FlightTraveler";
CREATE POLICY tenant_isolation ON "crm_flights"."FlightTraveler"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

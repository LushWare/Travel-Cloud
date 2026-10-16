ALTER TABLE "crm_flights"."FlightBooking" ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "crm_flights"."FlightBookingStatus" RENAME TO "FlightBookingStatus_old";

CREATE TYPE "crm_flights"."FlightBookingStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'failed');

ALTER TABLE "crm_flights"."FlightBooking"
  ALTER COLUMN "status" TYPE "crm_flights"."FlightBookingStatus"
  USING (
    CASE "status"::text
      WHEN 'quoted' THEN 'pending'
      WHEN 'ticketed' THEN 'confirmed'
      ELSE "status"::text
    END
  )::"crm_flights"."FlightBookingStatus";

ALTER TABLE "crm_flights"."FlightBooking"
  ALTER COLUMN "status" SET DEFAULT 'pending';

DROP TYPE "crm_flights"."FlightBookingStatus_old";
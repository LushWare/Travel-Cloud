-- Refund amount on cancelled bookings, the booking rep's email, and airline-initiated changes.
ALTER TABLE "crm_flights"."FlightBooking"
  ADD COLUMN IF NOT EXISTS "refundAmount" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "refundCurrency" TEXT,
  ADD COLUMN IF NOT EXISTS "refundTo" TEXT,
  ADD COLUMN IF NOT EXISTS "bookedByEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "airlineChangeAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "airlineChangeKind" TEXT;

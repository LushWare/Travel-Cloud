-- A day's own price for each meal. Null = the Settings price for that meal
-- (or the day's older single meal_price_override, which stays as a fallback).
ALTER TABLE "crm_packages"."Itinerary_Day"
  ADD COLUMN "breakfast_price_override" DECIMAL(10,2),
  ADD COLUMN "lunch_price_override" DECIMAL(10,2),
  ADD COLUMN "dinner_price_override" DECIMAL(10,2);

-- Same per-meal day prices as package days, so a copied itinerary keeps them.
ALTER TABLE "crm_leads"."LeadItineraryDay"
  ADD COLUMN "breakfastPriceOverride" DECIMAL(12,2),
  ADD COLUMN "lunchPriceOverride" DECIMAL(12,2),
  ADD COLUMN "dinnerPriceOverride" DECIMAL(12,2);

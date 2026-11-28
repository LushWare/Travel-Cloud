-- A package's own tax rate on a lead. Null = follow the Settings default tax rate.
ALTER TABLE "crm_leads"."LeadPricing" ADD COLUMN "taxRate" DECIMAL(5,2);

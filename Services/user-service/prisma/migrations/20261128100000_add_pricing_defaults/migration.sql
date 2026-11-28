-- Agency-wide starting costs (meal prices, margin, transport rates). Nullable:
-- until an admin saves them, pricing keeps its built-in defaults.
ALTER TABLE "crm_users"."OrganizationSettings" ADD COLUMN "pricingDefaults" JSONB;

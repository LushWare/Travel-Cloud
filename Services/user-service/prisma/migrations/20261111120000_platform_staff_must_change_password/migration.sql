-- A generated (temporary) console password must be replaced by the person's own at first sign-in.
ALTER TABLE "crm_platform"."PlatformUser" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "crm_platform"."PlatformUser" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

-- Accounts created before these columns existed only ever had a generated password.
UPDATE "crm_platform"."PlatformUser" SET "mustChangePassword" = true WHERE "passwordChangedAt" IS NULL;

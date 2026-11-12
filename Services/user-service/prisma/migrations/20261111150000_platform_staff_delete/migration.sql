ALTER TABLE "crm_platform"."HelpAccessGrant"
  ALTER COLUMN "platformUserId" DROP NOT NULL;

ALTER TABLE "crm_platform"."HelpAccessGrant"
  DROP CONSTRAINT IF EXISTS "HelpAccessGrant_platformUserId_fkey";

ALTER TABLE "crm_platform"."HelpAccessGrant"
  ADD CONSTRAINT "HelpAccessGrant_platformUserId_fkey"
  FOREIGN KEY ("platformUserId") REFERENCES "crm_platform"."PlatformUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
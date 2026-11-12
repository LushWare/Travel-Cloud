ALTER TABLE "crm_platform"."PlatformUser"
  ADD COLUMN IF NOT EXISTS "authenticatorSetupRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "setupTokenHash" CHAR(64),
  ADD COLUMN IF NOT EXISTS "setupTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "setupPurpose" VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformUser_setupTokenHash_key"
  ON "crm_platform"."PlatformUser"("setupTokenHash");

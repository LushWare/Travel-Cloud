-- Time-limited, view-only "help" access to an agency by Lushware staff. Written by platform-service,
-- redeemed and ended by auth-service; both use the admin connection. The agency services' user gets nothing.
CREATE TABLE IF NOT EXISTS "crm_platform"."HelpAccessGrant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platformUserId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "handoffCodeHash" CHAR(64) NOT NULL,
    "handoffExpiresAt" TIMESTAMP(3) NOT NULL,
    "handoffUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "HelpAccessGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HelpAccessGrant_platformUserId_fkey" FOREIGN KEY ("platformUserId")
      REFERENCES "crm_platform"."PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HelpAccessGrant_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "crm_platform"."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Never longer than 30 minutes.
    CONSTRAINT "HelpAccessGrant_max_30_minutes" CHECK ("expiresAt" <= "createdAt" + INTERVAL '30 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS "HelpAccessGrant_handoffCodeHash_key" ON "crm_platform"."HelpAccessGrant"("handoffCodeHash");
CREATE INDEX IF NOT EXISTS "HelpAccessGrant_tenantId_idx" ON "crm_platform"."HelpAccessGrant"("tenantId");
CREATE INDEX IF NOT EXISTS "HelpAccessGrant_platformUserId_idx" ON "crm_platform"."HelpAccessGrant"("platformUserId");

ALTER TABLE "crm_platform"."HelpAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."HelpAccessGrant" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE ALL ON "crm_platform"."HelpAccessGrant" FROM crm_app;
  END IF;
END $$;

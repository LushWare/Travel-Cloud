-- Lushware platform staff and their console sessions. Only platform-service (admin connection) uses
-- these; the agency services' database user gets no access at all.
DO $$ BEGIN
  CREATE TYPE "crm_platform"."PlatformRole" AS ENUM ('platform_admin', 'support');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "crm_platform"."PlatformUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "crm_platform"."PlatformRole" NOT NULL DEFAULT 'support',
    "totpSecret" TEXT NOT NULL,
    "lastTotpStep" BIGINT NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformUser_email_key" ON "crm_platform"."PlatformUser"("email");

CREATE TABLE IF NOT EXISTS "crm_platform"."PlatformSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platformUserId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformSession_platformUserId_fkey" FOREIGN KEY ("platformUserId")
      REFERENCES "crm_platform"."PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlatformSession_tokenHash_key" ON "crm_platform"."PlatformSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "PlatformSession_platformUserId_idx" ON "crm_platform"."PlatformSession"("platformUserId");

-- Locked for everyone except the admin connection: row-level security with no policies hides every
-- row from any role that cannot bypass it, and the agency services' user is refused outright.
ALTER TABLE "crm_platform"."PlatformUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlatformUser" FORCE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlatformSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlatformSession" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE ALL ON "crm_platform"."PlatformUser" FROM crm_app;
    REVOKE ALL ON "crm_platform"."PlatformSession" FROM crm_app;
  END IF;
END $$;

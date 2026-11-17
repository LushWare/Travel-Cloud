-- Optional approval of self-signups. While "require_signup_approval" is on, a new agency starts as
-- 'pending_approval' and nobody can sign in to it until Lushware approves it in the Console.
ALTER TYPE "crm_platform"."TenantStatus" ADD VALUE IF NOT EXISTS 'pending_approval';

-- Lushware-wide switches set from the Console. Only the admin connection (auth-service,
-- platform-service) reads or writes them; the agency services' user is refused.
CREATE TABLE IF NOT EXISTS "crm_platform"."PlatformSetting" (
  "key" VARCHAR(64) NOT NULL,
  "value" JSONB NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "PlatformSetting_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$')
);

ALTER TABLE "crm_platform"."PlatformSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."PlatformSetting" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE ALL ON "crm_platform"."PlatformSetting" FROM crm_app;
  END IF;
END $$;

-- Off by default: open sign-up.
INSERT INTO "crm_platform"."PlatformSetting" ("key", "value")
VALUES ('require_signup_approval', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;

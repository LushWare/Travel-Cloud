-- Append-only audit log of privileged actions, one stream per agency.
CREATE TABLE IF NOT EXISTS "crm_platform"."AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID,
    "actorId" TEXT,
    "actorEmail" VARCHAR(254),
    "actorRole" VARCHAR(32),
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32),
    "targetId" VARCHAR(64),
    "summary" VARCHAR(300) NOT NULL,
    "details" JSONB,
    "ipAddress" VARCHAR(64),
    "requestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_createdAt_idx" ON "crm_platform"."AuditLog"("tenantId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_action_idx" ON "crm_platform"."AuditLog"("tenantId", "action");

-- Nobody edits or deletes history, whatever their database rights.
CREATE OR REPLACE FUNCTION "crm_platform".audit_log_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END $$;

DROP TRIGGER IF EXISTS audit_log_append_only ON "crm_platform"."AuditLog";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "crm_platform"."AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "crm_platform".audit_log_is_append_only();

-- An agency reads and writes only its own entries. There is no update or delete policy.
ALTER TABLE "crm_platform"."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_platform"."AuditLog" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_read_own_agency ON "crm_platform"."AuditLog";
CREATE POLICY audit_read_own_agency ON "crm_platform"."AuditLog" FOR SELECT
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS audit_write_own_agency ON "crm_platform"."AuditLog";
CREATE POLICY audit_write_own_agency ON "crm_platform"."AuditLog" FOR INSERT
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

-- The services' user (created by setup-db-roles.mjs) may only add and read entries.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT INSERT, SELECT ON "crm_platform"."AuditLog" TO crm_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "crm_platform"."AuditLog" FROM crm_app;
  END IF;
END $$;

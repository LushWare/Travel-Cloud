-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'ManagementLastSeen_actorId_pageKey_scopeFingerprint_key' AND connamespace = 'crm_assistant'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'ManagementLastSeen_actorId_pageKey_scopeFingerprint_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_assistant"."ManagementLastSeen_actorId_pageKey_scopeFingerprint_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'InsightState_actorId_pageKey_scopeFingerprint_insightKey_key' AND connamespace = 'crm_assistant'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'InsightState_actorId_pageKey_scopeFingerprint_insightKey_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_assistant"."InsightState_actorId_pageKey_scopeFingerprint_insightKey_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'BusinessNotificationState_actorId_notificationKey_key' AND connamespace = 'crm_assistant'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'BusinessNotificationState_actorId_notificationKey_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_assistant"."BusinessNotificationState_actorId_notificationKey_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ManagementLastSeen_tenantId_actorId_pageKey_scopeFingerprin_key" ON "crm_assistant"."ManagementLastSeen"("tenantId", "actorId", "pageKey", "scopeFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InsightState_tenantId_actorId_pageKey_scopeFingerprint_insi_key" ON "crm_assistant"."InsightState"("tenantId", "actorId", "pageKey", "scopeFingerprint", "insightKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessNotificationState_tenantId_actorId_notificationKey_key" ON "crm_assistant"."BusinessNotificationState"("tenantId", "actorId", "notificationKey");


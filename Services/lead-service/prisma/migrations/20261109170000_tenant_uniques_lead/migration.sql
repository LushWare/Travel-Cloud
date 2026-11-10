-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Lead_intakeChannel_intakeSessionId_key' AND connamespace = 'crm_leads'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Lead_intakeChannel_intakeSessionId_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_leads"."Lead_intakeChannel_intakeSessionId_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Settings_singletonKey_key' AND connamespace = 'crm_leads'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Settings_singletonKey_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_leads"."Settings_singletonKey_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_tenantId_intakeChannel_intakeSessionId_key" ON "crm_leads"."Lead"("tenantId", "intakeChannel", "intakeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Settings_tenantId_singletonKey_key" ON "crm_leads"."Settings"("tenantId", "singletonKey");


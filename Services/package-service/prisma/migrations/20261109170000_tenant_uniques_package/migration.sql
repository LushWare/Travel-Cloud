-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Package_slug_key' AND connamespace = 'crm_packages'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Package_slug_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_packages"."Package_slug_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Place_name_key' AND connamespace = 'crm_packages'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Place_name_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_packages"."Place_name_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Activity_Catalog_name_key' AND connamespace = 'crm_packages'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Activity_Catalog_name_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_packages"."Activity_Catalog_name_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Package_tenantId_slug_key" ON "crm_packages"."Package"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Place_tenantId_name_key" ON "crm_packages"."Place"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Activity_Catalog_tenantId_name_key" ON "crm_packages"."Activity_Catalog"("tenantId", "name");


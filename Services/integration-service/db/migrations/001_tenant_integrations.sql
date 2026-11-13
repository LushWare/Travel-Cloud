CREATE SCHEMA IF NOT EXISTS crm_integrations;

CREATE TABLE IF NOT EXISTS crm_integrations."TenantIntegration" (
  id UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES crm_platform."Tenant"(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  label VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  "secretCiphertext" BYTEA,
  "wrappedDek" BYTEA,
  "secretIv" BYTEA,
  "secretTag" BYTEA,
  "kekVersion" TEXT,
  "secretFingerprint" VARCHAR(64),
  "lastFour" VARCHAR(4),
  "lastTestedAt" TIMESTAMP(3),
  "lastError" VARCHAR(300),
  "connectedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantIntegration_tenant_provider_label_key" UNIQUE ("tenantId", provider, label),
  CONSTRAINT "TenantIntegration_status_check" CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  CONSTRAINT "TenantIntegration_secret_check" CHECK (
    status IN ('pending', 'revoked') OR
    ("secretCiphertext" IS NOT NULL AND "wrappedDek" IS NOT NULL AND "secretIv" IS NOT NULL AND "secretTag" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "TenantIntegration_tenant_provider_idx"
  ON crm_integrations."TenantIntegration" ("tenantId", provider);

ALTER TABLE crm_integrations."TenantIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."TenantIntegration" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."TenantIntegration";
CREATE POLICY tenant_isolation ON crm_integrations."TenantIntegration"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT USAGE ON SCHEMA crm_integrations TO crm_app;
    GRANT SELECT, INSERT, UPDATE ON crm_integrations."TenantIntegration" TO crm_app;
    REVOKE DELETE, TRUNCATE ON crm_integrations."TenantIntegration" FROM crm_app;
  END IF;
END $$;

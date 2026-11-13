CREATE TABLE IF NOT EXISTS crm_integrations."OAuthState" (
  "stateHash" CHAR(64) PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES crm_platform."Tenant"(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  "initiatedById" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE crm_integrations."OAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."OAuthState" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."OAuthState";
CREATE POLICY tenant_isolation ON crm_integrations."OAuthState"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

CREATE INDEX IF NOT EXISTS "OAuthState_tenant_expiry_idx"
  ON crm_integrations."OAuthState" ("tenantId", "expiresAt");

CREATE TABLE IF NOT EXISTS crm_integrations."FacebookPageRoute" (
  "pageId" VARCHAR(30) PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES crm_platform."Tenant"(id) ON DELETE CASCADE,
  "integrationId" UUID NOT NULL REFERENCES crm_integrations."TenantIntegration"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE crm_integrations."FacebookPageRoute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."FacebookPageRoute" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."FacebookPageRoute";
CREATE POLICY tenant_isolation ON crm_integrations."FacebookPageRoute"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

CREATE OR REPLACE FUNCTION crm_integrations.resolve_facebook_page(p_page_id TEXT)
RETURNS TABLE ("tenantId" UUID, "integrationId" UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, crm_integrations
AS $$
  SELECT route."tenantId", route."integrationId"
    FROM crm_integrations."FacebookPageRoute" AS route
    JOIN crm_integrations."TenantIntegration" AS integration
      ON integration.id = route."integrationId"
     AND integration."tenantId" = route."tenantId"
   WHERE route."pageId" = p_page_id
     AND integration.provider = 'facebook'
     AND integration.label = 'lead_ads'
     AND integration.status = 'connected'
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION crm_integrations.resolve_facebook_page(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, DELETE ON crm_integrations."OAuthState" TO crm_app;
    GRANT SELECT, INSERT, DELETE ON crm_integrations."FacebookPageRoute" TO crm_app;
    GRANT EXECUTE ON FUNCTION crm_integrations.resolve_facebook_page(TEXT) TO crm_app;
  END IF;
END $$;

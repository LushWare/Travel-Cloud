CREATE TABLE IF NOT EXISTS crm_integrations."WhatsappPhoneRoute" (
  "phoneNumberId" VARCHAR(30) PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES crm_platform."Tenant"(id) ON DELETE CASCADE,
  "integrationId" UUID NOT NULL REFERENCES crm_integrations."TenantIntegration"(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE crm_integrations."WhatsappPhoneRoute" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."WhatsappPhoneRoute" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."WhatsappPhoneRoute";
CREATE POLICY tenant_isolation ON crm_integrations."WhatsappPhoneRoute"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

CREATE OR REPLACE FUNCTION crm_integrations.resolve_whatsapp_phone(p_phone_number_id TEXT)
RETURNS TABLE ("tenantId" UUID, "integrationId" UUID)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, crm_integrations
AS $$
  SELECT route."tenantId", route."integrationId"
    FROM crm_integrations."WhatsappPhoneRoute" AS route
    JOIN crm_integrations."TenantIntegration" AS integration
      ON integration.id = route."integrationId"
     AND integration."tenantId" = route."tenantId"
   WHERE route."phoneNumberId" = p_phone_number_id
     AND integration.provider = 'whatsapp'
     AND integration.label = 'business'
     AND integration.status = 'connected'
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION crm_integrations.resolve_whatsapp_phone(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, DELETE ON crm_integrations."WhatsappPhoneRoute" TO crm_app;
    GRANT EXECUTE ON FUNCTION crm_integrations.resolve_whatsapp_phone(TEXT) TO crm_app;
  END IF;
END $$;
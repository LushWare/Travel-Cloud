CREATE TABLE IF NOT EXISTS crm_integrations."StripePaymentLink" (
  id UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES crm_platform."Tenant"(id) ON DELETE CASCADE,
  "integrationId" UUID NOT NULL REFERENCES crm_integrations."TenantIntegration"(id) ON DELETE CASCADE,
  "accountId" VARCHAR(255) NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "StripePaymentLink_status_check" CHECK (status IN ('active', 'paid', 'revoked')),
  CONSTRAINT "StripePaymentLink_id_tenant_key" UNIQUE (id, "tenantId")
);

CREATE INDEX IF NOT EXISTS "StripePaymentLink_tenant_invoice_idx"
  ON crm_integrations."StripePaymentLink" ("tenantId", "invoiceId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS crm_integrations."StripeCheckoutSession" (
  id UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "paymentLinkId" UUID NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "sessionId" VARCHAR(255) NOT NULL UNIQUE,
  "accountId" VARCHAR(255) NOT NULL,
  "paymentIntentId" VARCHAR(255),
  "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0),
  currency VARCHAR(3) NOT NULL,
  "checkoutUrl" TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "StripeCheckoutSession_status_check" CHECK (status IN ('open', 'paid', 'expired', 'failed')),
  CONSTRAINT "StripeCheckoutSession_link_tenant_fkey"
    FOREIGN KEY ("paymentLinkId", "tenantId")
    REFERENCES crm_integrations."StripePaymentLink"(id, "tenantId") ON DELETE CASCADE,
  CONSTRAINT "StripeCheckoutSession_id_tenant_key" UNIQUE (id, "tenantId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckoutSession_one_open_per_invoice_key"
  ON crm_integrations."StripeCheckoutSession" ("tenantId", "invoiceId")
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS "StripeCheckoutSession_tenant_status_idx"
  ON crm_integrations."StripeCheckoutSession" ("tenantId", status);

ALTER TABLE crm_integrations."StripePaymentLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."StripePaymentLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."StripeCheckoutSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations."StripeCheckoutSession" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."StripePaymentLink";
CREATE POLICY tenant_isolation ON crm_integrations."StripePaymentLink"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

DROP POLICY IF EXISTS tenant_isolation ON crm_integrations."StripeCheckoutSession";
CREATE POLICY tenant_isolation ON crm_integrations."StripeCheckoutSession"
  FOR ALL
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

CREATE OR REPLACE FUNCTION crm_integrations.resolve_stripe_payment_link(p_token_hash TEXT)
RETURNS TABLE ("tenantId" UUID, "paymentLinkId" UUID, "invoiceId" TEXT, "integrationId" UUID, "accountId" TEXT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, crm_integrations
AS $$
  SELECT link."tenantId", link.id, link."invoiceId", integration.id,
         link."accountId"
    FROM crm_integrations."StripePaymentLink" AS link
    JOIN crm_integrations."TenantIntegration" AS integration
      ON integration.id = link."integrationId"
     AND integration."tenantId" = link."tenantId"
   WHERE link."tokenHash" = p_token_hash
     AND link.status = 'active'
     AND integration.provider = 'stripe'
     AND integration.label = 'payments'
     AND integration.status = 'connected'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION crm_integrations.resolve_stripe_checkout_session(p_session_id TEXT)
RETURNS TABLE (
  "tenantId" UUID,
  "paymentLinkId" UUID,
  "invoiceId" TEXT,
  "accountId" TEXT,
  "amountMinor" BIGINT,
  currency VARCHAR(3),
  status VARCHAR(16),
  "linkStatus" VARCHAR(16)
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, crm_integrations
AS $$
  SELECT session."tenantId", session."paymentLinkId", link."invoiceId",
         session."accountId", session."amountMinor", session.currency,
         session.status, link.status
    FROM crm_integrations."StripeCheckoutSession" AS session
    JOIN crm_integrations."StripePaymentLink" AS link
      ON link.id = session."paymentLinkId"
     AND link."tenantId" = session."tenantId"
   WHERE session."sessionId" = p_session_id
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION crm_integrations.resolve_stripe_payment_link(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm_integrations.resolve_stripe_checkout_session(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_integrations."StripePaymentLink" TO crm_app;
    GRANT SELECT, INSERT, UPDATE ON crm_integrations."StripeCheckoutSession" TO crm_app;
    GRANT EXECUTE ON FUNCTION crm_integrations.resolve_stripe_payment_link(TEXT) TO crm_app;
    GRANT EXECUTE ON FUNCTION crm_integrations.resolve_stripe_checkout_session(TEXT) TO crm_app;
  END IF;
END $$;

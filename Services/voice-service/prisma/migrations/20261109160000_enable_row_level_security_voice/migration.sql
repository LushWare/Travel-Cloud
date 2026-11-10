-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_voice"."VoiceNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_voice"."VoiceNumber" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_voice"."VoiceNumber";
CREATE POLICY tenant_isolation ON "crm_voice"."VoiceNumber"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_voice"."VoiceCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_voice"."VoiceCall" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_voice"."VoiceCall";
CREATE POLICY tenant_isolation ON "crm_voice"."VoiceCall"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_voice"."VoiceCallEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_voice"."VoiceCallEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_voice"."VoiceCallEvent";
CREATE POLICY tenant_isolation ON "crm_voice"."VoiceCallEvent"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

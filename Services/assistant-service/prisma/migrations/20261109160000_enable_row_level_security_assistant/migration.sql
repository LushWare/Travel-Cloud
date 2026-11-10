-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_assistant"."AssistantEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."AssistantEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."AssistantEvent";
CREATE POLICY tenant_isolation ON "crm_assistant"."AssistantEvent"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."ManagementLastSeen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."ManagementLastSeen" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."ManagementLastSeen";
CREATE POLICY tenant_isolation ON "crm_assistant"."ManagementLastSeen"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."InsightState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."InsightState" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."InsightState";
CREATE POLICY tenant_isolation ON "crm_assistant"."InsightState"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."BusinessNotificationState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."BusinessNotificationState" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."BusinessNotificationState";
CREATE POLICY tenant_isolation ON "crm_assistant"."BusinessNotificationState"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."InsightDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."InsightDecision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."InsightDecision";
CREATE POLICY tenant_isolation ON "crm_assistant"."InsightDecision"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."AssistantSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."AssistantSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."AssistantSession";
CREATE POLICY tenant_isolation ON "crm_assistant"."AssistantSession"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_assistant"."AssistantMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_assistant"."AssistantMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_assistant"."AssistantMessage";
CREATE POLICY tenant_isolation ON "crm_assistant"."AssistantMessage"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_assistant"."AssistantEvent" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."AssistantEvent" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."AssistantEvent" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "AssistantEvent_tenantId_idx" ON "crm_assistant"."AssistantEvent"("tenantId");

ALTER TABLE "crm_assistant"."ManagementLastSeen" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."ManagementLastSeen" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."ManagementLastSeen" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "ManagementLastSeen_tenantId_idx" ON "crm_assistant"."ManagementLastSeen"("tenantId");

ALTER TABLE "crm_assistant"."InsightState" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."InsightState" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."InsightState" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "InsightState_tenantId_idx" ON "crm_assistant"."InsightState"("tenantId");

ALTER TABLE "crm_assistant"."BusinessNotificationState" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."BusinessNotificationState" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."BusinessNotificationState" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "BusinessNotificationState_tenantId_idx" ON "crm_assistant"."BusinessNotificationState"("tenantId");

ALTER TABLE "crm_assistant"."InsightDecision" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."InsightDecision" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."InsightDecision" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "InsightDecision_tenantId_idx" ON "crm_assistant"."InsightDecision"("tenantId");

ALTER TABLE "crm_assistant"."AssistantSession" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."AssistantSession" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."AssistantSession" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "AssistantSession_tenantId_idx" ON "crm_assistant"."AssistantSession"("tenantId");

ALTER TABLE "crm_assistant"."AssistantMessage" ADD COLUMN "tenantId" UUID;
UPDATE "crm_assistant"."AssistantMessage" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_assistant"."AssistantMessage" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "AssistantMessage_tenantId_idx" ON "crm_assistant"."AssistantMessage"("tenantId");

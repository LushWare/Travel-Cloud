-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_voice"."VoiceNumber" ADD COLUMN "tenantId" UUID;
UPDATE "crm_voice"."VoiceNumber" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_voice"."VoiceNumber" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoiceNumber_tenantId_idx" ON "crm_voice"."VoiceNumber"("tenantId");

ALTER TABLE "crm_voice"."VoiceCall" ADD COLUMN "tenantId" UUID;
UPDATE "crm_voice"."VoiceCall" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_voice"."VoiceCall" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoiceCall_tenantId_idx" ON "crm_voice"."VoiceCall"("tenantId");

ALTER TABLE "crm_voice"."VoiceCallEvent" ADD COLUMN "tenantId" UUID;
UPDATE "crm_voice"."VoiceCallEvent" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_voice"."VoiceCallEvent" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoiceCallEvent_tenantId_idx" ON "crm_voice"."VoiceCallEvent"("tenantId");

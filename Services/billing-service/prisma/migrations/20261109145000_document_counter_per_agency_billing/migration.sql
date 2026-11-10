-- Counters become per agency: each agency numbers its own documents from 00001.
-- Counters that existed before agencies belong to lush-demo.
ALTER TABLE "crm_billing"."DocumentCounter" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."DocumentCounter" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."DocumentCounter" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
ALTER TABLE "crm_billing"."DocumentCounter" DROP CONSTRAINT "DocumentCounter_pkey";
ALTER TABLE "crm_billing"."DocumentCounter" ADD CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("tenantId", "key");

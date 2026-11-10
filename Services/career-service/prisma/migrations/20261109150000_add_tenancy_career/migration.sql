-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_careers"."Career" ADD COLUMN "tenantId" UUID;
UPDATE "crm_careers"."Career" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_careers"."Career" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Career_tenantId_idx" ON "crm_careers"."Career"("tenantId");

ALTER TABLE "crm_careers"."Vacancy" ADD COLUMN "tenantId" UUID;
UPDATE "crm_careers"."Vacancy" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_careers"."Vacancy" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Vacancy_tenantId_idx" ON "crm_careers"."Vacancy"("tenantId");

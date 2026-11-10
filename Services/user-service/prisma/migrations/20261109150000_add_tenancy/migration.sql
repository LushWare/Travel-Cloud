-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_users"."VendorProfile" ADD COLUMN "tenantId" UUID;
UPDATE "crm_users"."VendorProfile" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_users"."VendorProfile" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VendorProfile_tenantId_idx" ON "crm_users"."VendorProfile"("tenantId");

ALTER TABLE "crm_users"."OrganizationSettings" ADD COLUMN "tenantId" UUID;
UPDATE "crm_users"."OrganizationSettings" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_users"."OrganizationSettings" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "OrganizationSettings_tenantId_idx" ON "crm_users"."OrganizationSettings"("tenantId");

ALTER TABLE "crm_users"."PolicyDocument" ADD COLUMN "tenantId" UUID;
UPDATE "crm_users"."PolicyDocument" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_users"."PolicyDocument" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "PolicyDocument_tenantId_idx" ON "crm_users"."PolicyDocument"("tenantId");

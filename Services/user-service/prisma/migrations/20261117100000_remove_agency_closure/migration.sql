-- Owner self-service agency closure was removed before it was used. Drop its columns.
-- Agencies are closed or deleted by Lushware instead (Console), so nothing here held data.
DROP INDEX IF EXISTS "crm_platform"."Tenant_closureRestoreTokenHash_key";
DROP INDEX IF EXISTS "crm_platform"."Tenant_deletionScheduledFor_idx";

ALTER TABLE "crm_platform"."Tenant"
  DROP COLUMN IF EXISTS "deletionRequestedAt",
  DROP COLUMN IF EXISTS "deletionScheduledFor",
  DROP COLUMN IF EXISTS "deletionRequestedById",
  DROP COLUMN IF EXISTS "statusBeforeDeletion",
  DROP COLUMN IF EXISTS "closureRestoreTokenHash";

-- An owner can close their agency. It waits 30 days as 'pending_deletion' (restorable from the
-- emailed link), then a scheduled job deletes its data and keeps only an anonymous tombstone row.
ALTER TABLE "crm_platform"."Tenant"
  ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionScheduledFor" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletionRequestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "statusBeforeDeletion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "closureRestoreTokenHash" CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_closureRestoreTokenHash_key"
  ON "crm_platform"."Tenant"("closureRestoreTokenHash");
CREATE INDEX IF NOT EXISTS "Tenant_deletionScheduledFor_idx"
  ON "crm_platform"."Tenant"("deletionScheduledFor") WHERE status = 'pending_deletion';

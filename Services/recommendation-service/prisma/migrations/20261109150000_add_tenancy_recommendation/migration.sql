-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_recommendations"."Recommendation" ADD COLUMN "tenantId" UUID;
UPDATE "crm_recommendations"."Recommendation" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_recommendations"."Recommendation" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Recommendation_tenantId_idx" ON "crm_recommendations"."Recommendation"("tenantId");

ALTER TABLE "crm_recommendations"."RecommendationFeedback" ADD COLUMN "tenantId" UUID;
UPDATE "crm_recommendations"."RecommendationFeedback" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_recommendations"."RecommendationFeedback" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "RecommendationFeedback_tenantId_idx" ON "crm_recommendations"."RecommendationFeedback"("tenantId");
-- RecommendationRun is keyed by scope; each agency keeps its own run per scope.
ALTER TABLE "crm_recommendations"."RecommendationRun" ADD COLUMN "tenantId" UUID;
UPDATE "crm_recommendations"."RecommendationRun" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_recommendations"."RecommendationRun" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
ALTER TABLE "crm_recommendations"."RecommendationRun" DROP CONSTRAINT "RecommendationRun_pkey";
ALTER TABLE "crm_recommendations"."RecommendationRun" ADD CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("tenantId", "scopeKey");

-- Recommendations are unique per agency and scope; two agencies may share a scope key.
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Recommendation_scopeKey_key_key' AND connamespace = 'crm_recommendations'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Recommendation_scopeKey_key_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_recommendations"."Recommendation_scopeKey_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Recommendation_tenantId_scopeKey_key_key" ON "crm_recommendations"."Recommendation"("tenantId", "scopeKey", "key");

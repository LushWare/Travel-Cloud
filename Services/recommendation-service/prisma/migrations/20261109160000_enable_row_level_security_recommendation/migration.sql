-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_recommendations"."Recommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_recommendations"."Recommendation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_recommendations"."Recommendation";
CREATE POLICY tenant_isolation ON "crm_recommendations"."Recommendation"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_recommendations"."RecommendationFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_recommendations"."RecommendationFeedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_recommendations"."RecommendationFeedback";
CREATE POLICY tenant_isolation ON "crm_recommendations"."RecommendationFeedback"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_recommendations"."RecommendationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_recommendations"."RecommendationRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_recommendations"."RecommendationRun";
CREATE POLICY tenant_isolation ON "crm_recommendations"."RecommendationRun"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

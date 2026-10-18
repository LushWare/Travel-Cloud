CREATE SCHEMA IF NOT EXISTS "crm_recommendations";

CREATE TABLE "crm_recommendations"."Recommendation" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "aiExplanation" TEXT,
    "evidence" JSONB NOT NULL,
    "relatedRecordIds" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "sourceAsOf" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_recommendations"."RecommendationFeedback" (
    "recommendationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("recommendationId", "actorId"),
    CONSTRAINT "RecommendationFeedback_recommendationId_fkey"
      FOREIGN KEY ("recommendationId") REFERENCES "crm_recommendations"."Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "crm_recommendations"."RecommendationRun" (
    "scopeKey" TEXT NOT NULL,
    "sourceAsOf" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("scopeKey")
);

CREATE UNIQUE INDEX "Recommendation_scopeKey_key_key" ON "crm_recommendations"."Recommendation"("scopeKey", "key");
CREATE INDEX "Recommendation_scopeKey_module_active_idx" ON "crm_recommendations"."Recommendation"("scopeKey", "module", "active");
CREATE INDEX "RecommendationFeedback_actorId_status_idx" ON "crm_recommendations"."RecommendationFeedback"("actorId", "status");
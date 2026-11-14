ALTER TABLE "crm_platform"."Tenant"
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "postTrialPlanVersionId" UUID;

ALTER TABLE "crm_platform"."Tenant"
  ADD CONSTRAINT "Tenant_postTrialPlanVersionId_fkey"
  FOREIGN KEY ("postTrialPlanVersionId")
  REFERENCES "crm_platform"."PlanVersion"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "Tenant_postTrialPlanVersionId_idx"
  ON "crm_platform"."Tenant"("postTrialPlanVersionId");

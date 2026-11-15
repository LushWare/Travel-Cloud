ALTER TABLE crm_platform."Tenant"
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripeCheckoutSessionId" TEXT,
  ADD COLUMN "stripeCheckoutPlanVersionId" UUID,
  ADD COLUMN "stripeCheckoutGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "pastDueAt" TIMESTAMP(3),
  ADD COLUMN "pastDueReminderLevel" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "billingSuspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key"
  ON crm_platform."Tenant"("stripeCustomerId");

CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key"
  ON crm_platform."Tenant"("stripeSubscriptionId");

CREATE UNIQUE INDEX "Tenant_stripeCheckoutSessionId_key"
  ON crm_platform."Tenant"("stripeCheckoutSessionId");

ALTER TABLE crm_platform."Tenant"
  ADD CONSTRAINT "Tenant_stripeCheckoutPlanVersionId_fkey"
  FOREIGN KEY ("stripeCheckoutPlanVersionId")
  REFERENCES crm_platform."PlanVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Tenant_stripeCheckoutPlanVersionId_idx"
  ON crm_platform."Tenant"("stripeCheckoutPlanVersionId");

CREATE TABLE crm_platform."StripePlanPrice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "planVersionId" UUID NOT NULL,
  "stripeProductId" TEXT NOT NULL,
  "stripePriceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripePlanPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StripePlanPrice_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES crm_platform."PlanVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StripePlanPrice_planVersionId_key"
  ON crm_platform."StripePlanPrice"("planVersionId");
CREATE UNIQUE INDEX "StripePlanPrice_stripePriceId_key"
  ON crm_platform."StripePlanPrice"("stripePriceId");

CREATE TABLE crm_platform."StripeWebhookEvent" (
  id VARCHAR(255) NOT NULL,
  type VARCHAR(255) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY (id)
);


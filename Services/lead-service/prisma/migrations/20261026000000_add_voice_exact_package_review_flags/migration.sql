ALTER TABLE "crm_leads"."Lead"
  ADD COLUMN "voiceExactPackageMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voicePriceChanged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voiceNeedsRepReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voiceReviewReason" TEXT,
  ADD COLUMN "voiceAiBookingAllowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "voiceCustomerIdentityConfirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Lead_voiceNeedsRepReview_idx"
  ON "crm_leads"."Lead"("voiceNeedsRepReview");

CREATE INDEX "Lead_voiceAiBookingAllowed_idx"
  ON "crm_leads"."Lead"("voiceAiBookingAllowed");

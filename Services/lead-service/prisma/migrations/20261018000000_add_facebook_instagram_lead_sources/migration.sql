CREATE TYPE "crm_leads"."LeadSource_new" AS ENUM (
  'manual',
  'website',
  'booking',
  'facebook',
  'instagram',
  'phone-call',
  'email',
  'referral',
  'walk-in',
  'other',
  'chatbot',
  'voice-agent'
);

ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "crm_leads"."Lead"
  ALTER COLUMN "source" TYPE "crm_leads"."LeadSource_new"
  USING (
    CASE
      WHEN "source"::text = 'social-media' AND "tags" @> ARRAY['instagram-lead']::text[] THEN 'instagram'
      WHEN "source"::text = 'social-media' AND "tags" @> ARRAY['facebook-lead']::text[] THEN 'facebook'
      WHEN "source"::text = 'social-media' THEN 'other'
      ELSE "source"::text
    END
  )::"crm_leads"."LeadSource_new";
ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "source" SET DEFAULT 'manual';

DROP TYPE "crm_leads"."LeadSource";
ALTER TYPE "crm_leads"."LeadSource_new" RENAME TO "LeadSource";

CREATE TYPE "crm_leads"."LeadPlatform_new" AS ENUM (
  'Manual Entry',
  'Website Form',
  'Paid Package',
  'Facebook',
  'Instagram',
  'Phone Call',
  'Email',
  'Referral',
  'Walk-in',
  'Chatbot Wizard',
  'Voice Agent'
);

ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "crm_leads"."Lead"
  ALTER COLUMN "platform" TYPE "crm_leads"."LeadPlatform_new"
  USING (
    CASE
      WHEN "platform"::text = 'Social Media' AND "tags" @> ARRAY['instagram-lead']::text[] THEN 'Instagram'
      WHEN "platform"::text = 'Social Media' AND "tags" @> ARRAY['facebook-lead']::text[] THEN 'Facebook'
      WHEN "platform"::text = 'Social Media' THEN 'Manual Entry'
      ELSE "platform"::text
    END
  )::"crm_leads"."LeadPlatform_new";
ALTER TABLE "crm_leads"."Lead" ALTER COLUMN "platform" SET DEFAULT 'Manual Entry';

DROP TYPE "crm_leads"."LeadPlatform";
ALTER TYPE "crm_leads"."LeadPlatform_new" RENAME TO "LeadPlatform";
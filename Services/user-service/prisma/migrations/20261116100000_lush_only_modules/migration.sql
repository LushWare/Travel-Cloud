-- AI insights, the voice agent and the public website run on Lushware's own accounts, so they
-- are now opt-in plan modules: a plan version that does not name them leaves them off. Lushware's
-- own "internal" plan keeps them by naming them here. Every other plan version is left untouched
-- (absent = off). Only adds keys; never changes a value a version already has.
UPDATE "crm_platform"."PlanVersion" pv
SET "entitlements" = jsonb_set(
  pv."entitlements",
  '{features}',
  jsonb_build_object('ai_copilot', true, 'voice_agent', true, 'public_website', true)
    || COALESCE(pv."entitlements"->'features', '{}'::jsonb)
)
FROM "crm_platform"."Plan" p
WHERE p."id" = pv."planId" AND p."key" = 'internal';

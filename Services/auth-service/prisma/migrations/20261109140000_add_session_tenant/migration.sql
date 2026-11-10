-- Sessions opened before agencies existed have no agency and must sign in again.
ALTER TABLE "crm_auth"."RefreshSession" ADD COLUMN "tenantId" UUID;

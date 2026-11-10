ALTER TABLE "crm_users"."User" ADD COLUMN "commissionRate" DECIMAL(5,2);

UPDATE "crm_users"."User" SET "commissionRate" = 10 WHERE "role" = 'salesRep' AND "commissionRate" IS NULL;

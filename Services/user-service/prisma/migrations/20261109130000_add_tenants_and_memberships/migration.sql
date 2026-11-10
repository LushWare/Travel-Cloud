-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "crm_platform";

-- CreateEnum
CREATE TYPE "crm_platform"."TenantStatus" AS ENUM ('trial', 'active', 'past_due', 'suspended', 'pending_deletion', 'deleted');

-- CreateEnum
CREATE TYPE "crm_users"."MembershipStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateTable
CREATE TABLE "crm_platform"."Tenant" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "crm_platform"."TenantStatus" NOT NULL DEFAULT 'trial',
    "region" VARCHAR(32) NOT NULL DEFAULT 'ap-southeast-1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_users"."Membership" (
    "id" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "crm_users"."UserRole" NOT NULL,
    "permissions" TEXT[],
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" "crm_users"."MembershipStatus" NOT NULL DEFAULT 'invited',
    "invitedById" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "crm_platform"."Tenant"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "crm_users"."Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_tenantId_userId_key" ON "crm_users"."Membership"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "crm_users"."Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "crm_platform"."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_users"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "crm_users"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The existing data becomes the first agency, "lush-demo". Its id is fixed so every
-- service's tenancy migration can label existing rows with it.
INSERT INTO "crm_platform"."Tenant" ("id", "slug", "name", "status", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'lush-demo', 'Lush Demo', 'active', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Every existing staff account (website customers are not agency members) keeps its
-- role in lush-demo. Super admins become owners; deactivated accounts are suspended.
INSERT INTO "crm_users"."Membership"
  ("id", "tenantId", "userId", "role", "permissions", "isOwner", "status", "joinedAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  '00000000-0000-4000-8000-000000000001',
  u."id",
  u."role",
  u."permissions",
  (u."isSuperAdmin" OR u."role" = 'superAdmin'),
  CASE WHEN u."isActive" THEN 'active'::"crm_users"."MembershipStatus" ELSE 'suspended'::"crm_users"."MembershipStatus" END,
  u."lastLogin",
  CURRENT_TIMESTAMP
FROM "crm_users"."User" u
WHERE u."role" <> 'customer'
ON CONFLICT ("tenantId", "userId") DO NOTHING;

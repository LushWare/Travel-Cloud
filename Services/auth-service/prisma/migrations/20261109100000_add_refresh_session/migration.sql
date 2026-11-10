CREATE TABLE "crm_auth"."RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "crm_auth"."RefreshSession"("tokenHash");

CREATE INDEX "RefreshSession_userId_idx" ON "crm_auth"."RefreshSession"("userId");

CREATE INDEX "RefreshSession_familyId_idx" ON "crm_auth"."RefreshSession"("familyId");

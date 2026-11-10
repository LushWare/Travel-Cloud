-- DropIndex
DROP INDEX "crm_users"."VendorProfile_businessRegistrationNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "VendorProfile_tenantId_businessRegistrationNumber_key" ON "crm_users"."VendorProfile"("tenantId", "businessRegistrationNumber");

-- CreateIndex
-- One settings row per agency. Should an accidental duplicate exist, keep the oldest (the one first created).
DELETE FROM "crm_users"."OrganizationSettings" dup
USING "crm_users"."OrganizationSettings" keep
WHERE dup."tenantId" = keep."tenantId"
  AND (dup."createdAt", dup.id) > (keep."createdAt", keep.id);

CREATE UNIQUE INDEX "OrganizationSettings_tenantId_key" ON "crm_users"."OrganizationSettings"("tenantId");


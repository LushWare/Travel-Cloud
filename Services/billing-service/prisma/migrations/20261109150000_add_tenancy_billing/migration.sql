-- Phase 1: every row belongs to an agency. Rows that existed before agencies belong to lush-demo.
-- New rows take the agency from the transaction's app.tenant_id; with no agency set, inserts fail.

ALTER TABLE "crm_billing"."Invoice" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."Invoice" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."Invoice" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Invoice_tenantId_idx" ON "crm_billing"."Invoice"("tenantId");

ALTER TABLE "crm_billing"."InvoiceItem" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."InvoiceItem" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."InvoiceItem" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "InvoiceItem_tenantId_idx" ON "crm_billing"."InvoiceItem"("tenantId");

ALTER TABLE "crm_billing"."Quotation" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."Quotation" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."Quotation" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Quotation_tenantId_idx" ON "crm_billing"."Quotation"("tenantId");

ALTER TABLE "crm_billing"."QuotationItem" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."QuotationItem" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."QuotationItem" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "QuotationItem_tenantId_idx" ON "crm_billing"."QuotationItem"("tenantId");

ALTER TABLE "crm_billing"."QuotationImage" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."QuotationImage" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."QuotationImage" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "QuotationImage_tenantId_idx" ON "crm_billing"."QuotationImage"("tenantId");

ALTER TABLE "crm_billing"."QuotationRevision" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."QuotationRevision" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."QuotationRevision" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "QuotationRevision_tenantId_idx" ON "crm_billing"."QuotationRevision"("tenantId");

ALTER TABLE "crm_billing"."PaymentReceipt" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."PaymentReceipt" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."PaymentReceipt" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "PaymentReceipt_tenantId_idx" ON "crm_billing"."PaymentReceipt"("tenantId");

ALTER TABLE "crm_billing"."PaymentHistory" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."PaymentHistory" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."PaymentHistory" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "PaymentHistory_tenantId_idx" ON "crm_billing"."PaymentHistory"("tenantId");

ALTER TABLE "crm_billing"."CreditNote" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."CreditNote" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."CreditNote" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "CreditNote_tenantId_idx" ON "crm_billing"."CreditNote"("tenantId");

ALTER TABLE "crm_billing"."CreditNoteItem" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."CreditNoteItem" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."CreditNoteItem" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "CreditNoteItem_tenantId_idx" ON "crm_billing"."CreditNoteItem"("tenantId");

ALTER TABLE "crm_billing"."Voucher" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."Voucher" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."Voucher" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "Voucher_tenantId_idx" ON "crm_billing"."Voucher"("tenantId");

ALTER TABLE "crm_billing"."VoucherLocationDate" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."VoucherLocationDate" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."VoucherLocationDate" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoucherLocationDate_tenantId_idx" ON "crm_billing"."VoucherLocationDate"("tenantId");

ALTER TABLE "crm_billing"."VoucherMealPlan" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."VoucherMealPlan" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."VoucherMealPlan" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoucherMealPlan_tenantId_idx" ON "crm_billing"."VoucherMealPlan"("tenantId");

ALTER TABLE "crm_billing"."VoucherItinerarySummary" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."VoucherItinerarySummary" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."VoucherItinerarySummary" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoucherItinerarySummary_tenantId_idx" ON "crm_billing"."VoucherItinerarySummary"("tenantId");

ALTER TABLE "crm_billing"."VoucherFlightSegment" ADD COLUMN "tenantId" UUID;
UPDATE "crm_billing"."VoucherFlightSegment" SET "tenantId" = '00000000-0000-4000-8000-000000000001' WHERE "tenantId" IS NULL;
ALTER TABLE "crm_billing"."VoucherFlightSegment" ALTER COLUMN "tenantId" SET NOT NULL, ALTER COLUMN "tenantId" SET DEFAULT (nullif(current_setting('app.tenant_id', true), ''))::uuid;
CREATE INDEX "VoucherFlightSegment_tenantId_idx" ON "crm_billing"."VoucherFlightSegment"("tenantId");

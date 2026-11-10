-- Phase 1: the database itself keeps each agency to its own rows (row-level security).

ALTER TABLE "crm_billing"."Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."Invoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."Invoice";
CREATE POLICY tenant_isolation ON "crm_billing"."Invoice"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."InvoiceItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."InvoiceItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."InvoiceItem";
CREATE POLICY tenant_isolation ON "crm_billing"."InvoiceItem"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."Quotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."Quotation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."Quotation";
CREATE POLICY tenant_isolation ON "crm_billing"."Quotation"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."QuotationItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."QuotationItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."QuotationItem";
CREATE POLICY tenant_isolation ON "crm_billing"."QuotationItem"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."QuotationImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."QuotationImage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."QuotationImage";
CREATE POLICY tenant_isolation ON "crm_billing"."QuotationImage"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."QuotationRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."QuotationRevision" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."QuotationRevision";
CREATE POLICY tenant_isolation ON "crm_billing"."QuotationRevision"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."PaymentReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."PaymentReceipt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."PaymentReceipt";
CREATE POLICY tenant_isolation ON "crm_billing"."PaymentReceipt"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."PaymentHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."PaymentHistory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."PaymentHistory";
CREATE POLICY tenant_isolation ON "crm_billing"."PaymentHistory"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."CreditNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."CreditNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."CreditNote";
CREATE POLICY tenant_isolation ON "crm_billing"."CreditNote"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."CreditNoteItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."CreditNoteItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."CreditNoteItem";
CREATE POLICY tenant_isolation ON "crm_billing"."CreditNoteItem"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."Voucher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."Voucher" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."Voucher";
CREATE POLICY tenant_isolation ON "crm_billing"."Voucher"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."VoucherLocationDate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."VoucherLocationDate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."VoucherLocationDate";
CREATE POLICY tenant_isolation ON "crm_billing"."VoucherLocationDate"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."VoucherMealPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."VoucherMealPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."VoucherMealPlan";
CREATE POLICY tenant_isolation ON "crm_billing"."VoucherMealPlan"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."VoucherItinerarySummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."VoucherItinerarySummary" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."VoucherItinerarySummary";
CREATE POLICY tenant_isolation ON "crm_billing"."VoucherItinerarySummary"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."VoucherFlightSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."VoucherFlightSegment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."VoucherFlightSegment";
CREATE POLICY tenant_isolation ON "crm_billing"."VoucherFlightSegment"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE "crm_billing"."DocumentCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "crm_billing"."DocumentCounter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "crm_billing"."DocumentCounter";
CREATE POLICY tenant_isolation ON "crm_billing"."DocumentCounter"
  USING ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);

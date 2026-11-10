-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Invoice_invoiceNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Invoice_invoiceNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."Invoice_invoiceNumber_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Quotation_quotationNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Quotation_quotationNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."Quotation_quotationNumber_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'PaymentReceipt_receiptNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'PaymentReceipt_receiptNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."PaymentReceipt_receiptNumber_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'PaymentHistory_paymentHistoryNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'PaymentHistory_paymentHistoryNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."PaymentHistory_paymentHistoryNumber_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'CreditNote_creditNoteNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'CreditNote_creditNoteNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."CreditNote_creditNoteNumber_key";

-- DropIndex
-- The old rule may be a constraint or a bare index, depending on how it was first created.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conrelid::regclass AS tbl FROM pg_constraint
           WHERE conname = 'Voucher_voucherNumber_key' AND connamespace = 'crm_billing'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, 'Voucher_voucherNumber_key');
  END LOOP;
END $$;
DROP INDEX IF EXISTS "crm_billing"."Voucher_voucherNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_invoiceNumber_key" ON "crm_billing"."Invoice"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_tenantId_quotationNumber_key" ON "crm_billing"."Quotation"("tenantId", "quotationNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReceipt_tenantId_receiptNumber_key" ON "crm_billing"."PaymentReceipt"("tenantId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentHistory_tenantId_paymentHistoryNumber_key" ON "crm_billing"."PaymentHistory"("tenantId", "paymentHistoryNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreditNote_tenantId_creditNoteNumber_key" ON "crm_billing"."CreditNote"("tenantId", "creditNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Voucher_tenantId_voucherNumber_key" ON "crm_billing"."Voucher"("tenantId", "voucherNumber");


import prisma from '../db/client.js';
import { getOrgSettings } from '../config/orgSettings.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// Hand-written SQL is not filtered automatically: every statement names the agency itself.
const agency = () => requireTenantId();

const pad = (n, len = 5) => String(n).padStart(len, '0');
const yyyymm = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Falls back per-key so an admin can override just one document type.
const DEFAULT_PREFIXES = {
  quotation: 'QUO', invoice: 'INV', receipt: 'REC',
  payment: 'PAY', creditNote: 'CN', voucher: 'VOU',
};

const SOURCES = {
  quotation: { model: 'quotation', field: 'quotationNumber' },
  invoice: { model: 'invoice', field: 'invoiceNumber' },
  receipt: { model: 'paymentReceipt', field: 'receiptNumber' },
  payment: { model: 'paymentHistory', field: 'paymentHistoryNumber' },
  creditNote: { model: 'creditNote', field: 'creditNoteNumber' },
  voucher: { model: 'voucher', field: 'voucherNumber' },
};

async function prefixFor(docType) {
  const settings = await getOrgSettings();
  return settings.docNumberPrefixes?.[docType] || DEFAULT_PREFIXES[docType];
}

async function bumpCounter(key) {
  const rows = await prisma.$queryRaw`
    UPDATE "crm_billing"."DocumentCounter" SET "value" = "value" + 1
    WHERE "key" = ${key} AND "tenantId" = ${agency()}::uuid
    RETURNING "value"`;
  return rows[0]?.value;
}

async function startCounter(key, { model, field }) {
  const last = await prisma[model].findFirst({
    where: { [field]: { startsWith: key } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });
  const seed = (last ? parseInt(last[field].slice(key.length), 10) || 0 : 0) + 1;
  const rows = await prisma.$queryRaw`
    INSERT INTO "crm_billing"."DocumentCounter" ("tenantId", "key", "value") VALUES (${agency()}::uuid, ${key}, ${seed})
    ON CONFLICT ("tenantId", "key") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
    RETURNING "value"`;
  return rows[0].value;
}

async function nextNumber(docType) {
  const key = `${await prefixFor(docType)}-${yyyymm()}-`;
  const seq = (await bumpCounter(key)) ?? (await startCounter(key, SOURCES[docType]));
  return `${key}${pad(seq)}`;
}

export const nextQuotationNumber = () => nextNumber('quotation');
export const nextInvoiceNumber = () => nextNumber('invoice');
export const nextReceiptNumber = () => nextNumber('receipt');
export const nextPaymentHistoryNumber = () => nextNumber('payment');
export const nextCreditNoteNumber = () => nextNumber('creditNote');
export const nextVoucherNumber = () => nextNumber('voucher');

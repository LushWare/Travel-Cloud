import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { db, counters, mockGetOrgSettings } = vi.hoisted(() => {
  const counters = new Map();
  const findFirst = () => vi.fn().mockResolvedValue(null);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const db = {
    quotation: { findFirst: findFirst() },
    invoice: { findFirst: findFirst() },
    paymentReceipt: { findFirst: findFirst() },
    paymentHistory: { findFirst: findFirst() },
    creditNote: { findFirst: findFirst() },
    voucher: { findFirst: findFirst() },
    $queryRaw: vi.fn(async (strings, ...values) => {
      await tick();
      const sql = strings.join('?');
      // UPDATE … WHERE key = ? AND tenantId = ?   |   INSERT … VALUES (tenantId, key, seed)
      const isUpdate = sql.includes('UPDATE "crm_billing"."DocumentCounter"');
      const [tenant, rawKey, seed] = isUpdate ? [values[1], values[0]] : values;
      const key = `${tenant}|${rawKey}`;
      if (isUpdate) {
        if (!counters.has(key)) return [];
        counters.set(key, counters.get(key) + 1);
        return [{ value: counters.get(key) }];
      }
      counters.set(key, counters.has(key) ? counters.get(key) + 1 : seed);
      return [{ value: counters.get(key) }];
    }),
  };
  return { db, counters, mockGetOrgSettings: vi.fn() };
});

vi.mock('../../db/client.js', () => ({ default: db }));
vi.mock('../../config/orgSettings.js', () => ({ getOrgSettings: mockGetOrgSettings }));

import * as docNumber from '../docNumber.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const AGENCY = '11111111-1111-4111-8111-111111111111';
const OTHER_AGENCY = '22222222-2222-4222-8222-222222222222';
const inAgency = (fn, tenant = AGENCY) => (...args) => runWithTenant(tenant, () => fn(...args));
const nextQuotationNumber = inAgency(docNumber.nextQuotationNumber);
const nextInvoiceNumber = inAgency(docNumber.nextInvoiceNumber);
const nextReceiptNumber = inAgency(docNumber.nextReceiptNumber);
const nextPaymentHistoryNumber = inAgency(docNumber.nextPaymentHistoryNumber);
const nextCreditNoteNumber = inAgency(docNumber.nextCreditNoteNumber);
const nextVoucherNumber = inAgency(docNumber.nextVoucherNumber);

beforeEach(() => {
  vi.clearAllMocks();
  counters.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-15T10:00:00'));
  mockGetOrgSettings.mockResolvedValue({});
  for (const model of ['quotation', 'invoice', 'paymentReceipt', 'paymentHistory', 'creditNote', 'voucher']) {
    db[model].findFirst.mockResolvedValue(null);
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('document numbering', () => {
  it('starts at 00001 when the month has no documents yet', async () => {
    expect(await nextInvoiceNumber()).toBe('INV-202611-00001');
  });

  it('continues from the highest existing number the first time a month is used', async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: 'INV-202611-00041' });

    expect(await nextInvoiceNumber()).toBe('INV-202611-00042');
  });

  it('counts up from the stored counter on later calls', async () => {
    await nextInvoiceNumber();

    expect(await nextInvoiceNumber()).toBe('INV-202611-00002');
  });

  it('reads the documents table only when the counter does not exist yet', async () => {
    await nextInvoiceNumber();
    await nextInvoiceNumber();

    expect(db.invoice.findFirst).toHaveBeenCalledTimes(1);
  });

  it('gives every document a different number when many are created at once', async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: 'INV-202611-00041' });

    const numbers = await Promise.all(Array.from({ length: 20 }, () => nextInvoiceNumber()));

    expect(new Set(numbers).size).toBe(20);
    expect(numbers.toSorted()).toEqual(Array.from({ length: 20 }, (_, i) => `INV-202611-${String(42 + i).padStart(5, '0')}`));
  });

  it('keeps a separate counter for each document type', async () => {
    await nextInvoiceNumber();

    expect(await nextQuotationNumber()).toBe('QUO-202611-00001');
  });

  it('starts a new sequence in a new month', async () => {
    await nextInvoiceNumber();
    vi.setSystemTime(new Date('2026-12-01T10:00:00'));

    expect(await nextInvoiceNumber()).toBe('INV-202612-00001');
  });

  it('uses the prefix configured in organisation settings', async () => {
    mockGetOrgSettings.mockResolvedValue({ docNumberPrefixes: { invoice: 'TAX-INV' } });

    expect(await nextInvoiceNumber()).toBe('TAX-INV-202611-00001');
  });

  it('continues correctly when the configured prefix itself contains a dash', async () => {
    mockGetOrgSettings.mockResolvedValue({ docNumberPrefixes: { invoice: 'TAX-INV' } });
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: 'TAX-INV-202611-00007' });

    expect(await nextInvoiceNumber()).toBe('TAX-INV-202611-00008');
  });

  it('starts at 00001 when the existing number has no readable sequence', async () => {
    db.invoice.findFirst.mockResolvedValue({ invoiceNumber: 'INV-202611-abc' });

    expect(await nextInvoiceNumber()).toBe('INV-202611-00001');
  });

  it.each([
    [nextQuotationNumber, 'quotation', 'quotationNumber', 'QUO'],
    [nextInvoiceNumber, 'invoice', 'invoiceNumber', 'INV'],
    [nextReceiptNumber, 'paymentReceipt', 'receiptNumber', 'REC'],
    [nextPaymentHistoryNumber, 'paymentHistory', 'paymentHistoryNumber', 'PAY'],
    [nextCreditNoteNumber, 'creditNote', 'creditNoteNumber', 'CN'],
    [nextVoucherNumber, 'voucher', 'voucherNumber', 'VOU'],
  ])('seeds the %#th type from its own table (%s)', async (next, model, field, prefix) => {
    db[model].findFirst.mockResolvedValue({ [field]: `${prefix}-202611-00009` });

    expect(await next()).toBe(`${prefix}-202611-00010`);
  });
});

describe('numbering per agency', () => {
  it('starts each agency at 00001 for the same prefix', async () => {
    await nextInvoiceNumber();
    await nextInvoiceNumber();

    expect(await inAgency(docNumber.nextInvoiceNumber, OTHER_AGENCY)()).toBe('INV-202611-00001');
  });

  it('refuses to number a document without an agency', async () => {
    await expect(docNumber.nextInvoiceNumber()).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });
});

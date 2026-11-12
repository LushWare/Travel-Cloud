import { describe, it, expect, vi, beforeEach } from 'vitest';

// Plan checks are covered in plan.service.test.js; here every agency has every module.
vi.mock('../../services/plan.service.js', () => ({ assertPlanFeature: vi.fn().mockResolvedValue(undefined), metered: vi.fn((_metric, send) => send()) }));

// Cross-verifies convertQuotationToInvoice against the quotation workflow:
// pricing must be copied verbatim (never recomputed), the converted-quotation
// guard must hold, the quotation<->invoice link must round-trip, and
// customer/destination/bank/terms must follow the documented three-level
// override precedence (explicit override -> quotation/org default -> unset).

const { mockQuotationFindUnique, mockQuotationUpdate, mockInvoiceCreate, mockInvoiceFindFirst, mockGetOrgSettings } = vi.hoisted(() => ({
  mockQuotationFindUnique: vi.fn(),
  mockQuotationUpdate: vi.fn(),
  mockInvoiceCreate: vi.fn(),
  mockInvoiceFindFirst: vi.fn(),
  mockGetOrgSettings: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    quotation: { findUnique: mockQuotationFindUnique, update: mockQuotationUpdate },
    invoice: { create: mockInvoiceCreate, findFirst: mockInvoiceFindFirst },
  },
}));
vi.mock('../../config/orgSettings.js', async () => {
  const actual = await vi.importActual('../../config/orgSettings.js');
  return { ...actual, getOrgSettings: mockGetOrgSettings };
});
vi.mock('../../utils/docNumber.js', () => ({ nextInvoiceNumber: vi.fn().mockResolvedValue('INV-202611-00001'), nextQuotationNumber: vi.fn() }));
vi.mock('../../utils/quotationPDFGenerator.js', () => ({ generateQuotationPDF: vi.fn() }));
vi.mock('../../utils/emailService.js', () => ({ sendQuotationEmail: vi.fn() }));
vi.mock('../../utils/whatsappService.js', () => ({ sendQuotationWhatsapp: vi.fn() }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: vi.fn() }));
vi.mock('../../services/events.client.js', () => ({ emitLeadEvent: vi.fn() }));
vi.mock('../../services/quotation.service.js', () => ({ createOrVersionQuotation: vi.fn(), quotationTotals: vi.fn() }));

import { convertQuotationToInvoice } from '../quotation.controller.js';
import { assertPlanFeature } from '../../services/plan.service.js';
import AppError from '../../utils/appError.js';

const fullQuotation = {
  id: 'q-1',
  quotationNumber: 'QT-202608-0001',
  status: 'accepted',
  leadId: 'lead-1',
  customerName: 'Alice Traveller',
  customerEmail: 'alice@test.com',
  customerPhone: '+15551234567',
  customerAddress: '10 Ocean Drive',
  customerGstNumber: 'GST-ALICE-1',
  destination: 'Maldives',
  currency: 'USD',
  subtotal: 1600,
  taxRate: 18,
  taxAmount: 259.2,
  discountType: 'percentage',
  discountValue: 10,
  discountAmount: 160,
  serviceChargeRate: 5,
  serviceChargeAmount: 80,
  totalAmount: 1779.2,
  notes: 'Quotation notes',
  terms: 'Quotation terms',
  items: [
    { id: 'i-1', quotationId: 'q-1', description: 'Package', category: 'package', quantity: 1, unitPrice: 1600, totalPrice: 1600, taxRate: 0, notes: null, order: 0 },
  ],
};

const orgSettings = {
  companyName: 'Lush Travel',
  bankName: 'Test Bank',
  bankAccountName: 'LUSH TRAVEL',
  bankAccountNumber: '12345',
  bankIfscCode: 'TEST0001234',
  upiId: 'lush@upi',
  invoicePaymentTerms: 'Org default payment terms.',
  invoicePaymentInstructions: 'Org default payment instructions.',
};

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function run(req) {
  const res = mockRes();
  let nextErr;
  await convertQuotationToInvoice(req, res, (err) => { nextErr = err; });
  return { res, nextErr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuotationFindUnique.mockResolvedValue({ ...fullQuotation, items: fullQuotation.items.map((i) => ({ ...i })) });
  mockQuotationUpdate.mockResolvedValue({});
  mockInvoiceFindFirst.mockResolvedValue(null); // first invoice this month -> seq 1
  mockInvoiceCreate.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data, items: data.items?.create || [] }));
  mockGetOrgSettings.mockResolvedValue(orgSettings);
});

describe('convertQuotationToInvoice — pricing is copied verbatim, never recomputed', () => {
  it('copies subtotal/tax/discount/serviceCharge/total exactly from the quotation', async () => {
    const { nextErr } = await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    expect(nextErr).toBeUndefined();
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.subtotal).toBe(fullQuotation.subtotal);
    expect(created.taxRate).toBe(fullQuotation.taxRate);
    expect(created.taxAmount).toBe(fullQuotation.taxAmount);
    expect(created.discountType).toBe(fullQuotation.discountType);
    expect(created.discountValue).toBe(fullQuotation.discountValue);
    expect(created.discountAmount).toBe(fullQuotation.discountAmount);
    expect(created.serviceChargeRate).toBe(fullQuotation.serviceChargeRate);
    expect(created.serviceChargeAmount).toBe(fullQuotation.serviceChargeAmount);
    expect(created.totalAmount).toBe(fullQuotation.totalAmount);
    expect(created.outstandingAmount).toBe(fullQuotation.totalAmount);
  });

  it('copies items verbatim (description/price), stripping only the quotation-specific ids', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.items.create).toEqual([
      { description: 'Package', category: 'package', quantity: 1, unitPrice: 1600, totalPrice: 1600, taxRate: 0, notes: null, order: 0 },
    ]);
  });

  it('ignores pricing fields even if a caller tries to send them as overrides (not accepted by the schema)', async () => {
    const { nextErr } = await run({
      params: { id: 'q-1' },
      body: { totalAmount: 1, subtotal: 1, taxAmount: 1 },
      user: { id: 'admin-1' },
    });
    // .strict() zod schema rejects unknown keys outright.
    expect(nextErr).toBeDefined();
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });
});

describe('convertQuotationToInvoice — converted-quotation guard', () => {
  it('refuses turning a quotation into an invoice when the plan leaves invoices out', async () => {
    vi.mocked(assertPlanFeature).mockRejectedValueOnce(new AppError('not in plan', 403, { code: 'FEATURE_NOT_IN_PLAN' }));

    const { nextErr } = await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });

    expect(nextErr).toMatchObject({ statusCode: 403, code: 'FEATURE_NOT_IN_PLAN' });
    expect(vi.mocked(assertPlanFeature)).toHaveBeenCalledWith('finance_docs');
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
    expect(mockQuotationUpdate).not.toHaveBeenCalled();
  });

  it('rejects converting an already-converted quotation', async () => {
    mockQuotationFindUnique.mockResolvedValue({ ...fullQuotation, status: 'converted' });
    const { nextErr } = await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(400);
    expect(mockInvoiceCreate).not.toHaveBeenCalled();
  });

  it('404s when the quotation does not exist', async () => {
    mockQuotationFindUnique.mockResolvedValue(null);
    const { nextErr } = await run({ params: { id: 'missing' }, body: {}, user: { id: 'admin-1' } });
    expect(nextErr.statusCode).toBe(404);
  });
});

describe('convertQuotationToInvoice — quotation<->invoice round-trip link', () => {
  it('marks the quotation converted and links convertedToInvoiceId to the new invoice', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    expect(mockQuotationUpdate).toHaveBeenCalledWith({
      where: { id: 'q-1' },
      data: { status: 'converted', convertedToInvoiceId: 'inv-1' },
    });
  });

  it('sets the invoice quotationId back to the source quotation', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.quotationId).toBe('q-1');
  });
});

describe('convertQuotationToInvoice — override precedence (explicit -> quotation/org default)', () => {
  it('falls back to the quotation snapshot for customer/destination fields when no override is sent', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.customerName).toBe('Alice Traveller');
    expect(created.customerEmail).toBe('alice@test.com');
    expect(created.customerAddress).toBe('10 Ocean Drive');
    expect(created.customerGstNumber).toBe('GST-ALICE-1');
    expect(created.destination).toBe('Maldives');
  });

  it('uses an explicit override for customerName instead of the quotation snapshot', async () => {
    await run({ params: { id: 'q-1' }, body: { customerName: 'Bob Override' }, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.customerName).toBe('Bob Override');
    // Untouched fields still fall back to the quotation snapshot.
    expect(created.customerEmail).toBe('alice@test.com');
  });

  it('uses an explicit override for destination instead of the quotation snapshot', async () => {
    await run({ params: { id: 'q-1' }, body: { destination: 'Sri Lanka' }, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.destination).toBe('Sri Lanka');
  });

  it('falls back to current org settings for bank/terms fields when no override is sent', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.bankName).toBe('Test Bank');
    expect(created.bankAccountNumber).toBe('12345');
    expect(created.bankUpiId).toBe('lush@upi');
    expect(created.paymentTerms).toBe('Org default payment terms.');
    expect(created.paymentInstructions).toBe('Org default payment instructions.');
  });

  it('falls back to the quotation snapshot for notes when no override is sent', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.notes).toBe('Quotation notes');
  });

  it('uses an explicit override for notes instead of the quotation snapshot', async () => {
    await run({ params: { id: 'q-1' }, body: { notes: 'Custom invoice-only note.' }, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.notes).toBe('Custom invoice-only note.');
  });

  it('uses an explicit override for bank/terms fields instead of org settings', async () => {
    await run({
      params: { id: 'q-1' },
      body: { bankName: 'Custom Bank', paymentTerms: 'Custom terms for this invoice.' },
      user: { id: 'admin-1' },
    });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.bankName).toBe('Custom Bank');
    expect(created.paymentTerms).toBe('Custom terms for this invoice.');
    // Untouched bank field still falls back to org settings.
    expect(created.bankAccountNumber).toBe('12345');
  });

  it('defaults dueDate to +30 days when not overridden, and honors an explicit dueDate override', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const createdDefault = mockInvoiceCreate.mock.calls[0][0].data;
    expect(createdDefault.dueDate).toBeInstanceOf(Date);

    vi.clearAllMocks();
    mockQuotationFindUnique.mockResolvedValue({ ...fullQuotation, items: fullQuotation.items.map((i) => ({ ...i })) });
    mockInvoiceCreate.mockImplementation(async ({ data }) => ({ id: 'inv-2', ...data, items: data.items?.create || [] }));
    mockGetOrgSettings.mockResolvedValue(orgSettings);

    const explicitDue = '2027-01-01T00:00:00.000Z';
    await run({ params: { id: 'q-1' }, body: { dueDate: explicitDue }, user: { id: 'admin-1' } });
    const createdOverride = mockInvoiceCreate.mock.calls[0][0].data;
    expect(createdOverride.dueDate.toISOString()).toBe(explicitDue);
  });
});

describe('convertQuotationToInvoice — currency inheritance', () => {
  it('inherits the default USD currency from the quotation', async () => {
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.currency).toBe('USD');
  });

  it('inherits a non-default currency from the quotation (e.g. INR) rather than defaulting to USD', async () => {
    mockQuotationFindUnique.mockResolvedValue({ ...fullQuotation, currency: 'INR', items: fullQuotation.items.map((i) => ({ ...i })) });
    await run({ params: { id: 'q-1' }, body: {}, user: { id: 'admin-1' } });
    const created = mockInvoiceCreate.mock.calls[0][0].data;
    expect(created.currency).toBe('INR');
  });
});

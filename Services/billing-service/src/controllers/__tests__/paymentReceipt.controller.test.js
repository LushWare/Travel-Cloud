import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReceiptFindUnique, mockReceiptUpdate, mockReceiptCreate,
  mockInvoiceFindUnique, mockInvoiceUpdate, mockTransaction,
  mockGeneratePDF, mockSendEmail, mockSendWhatsapp, mockUpload, mockLogLeadCommunication,
} = vi.hoisted(() => ({
  mockReceiptFindUnique: vi.fn(),
  mockReceiptUpdate: vi.fn(),
  mockReceiptCreate: vi.fn(),
  mockInvoiceFindUnique: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGeneratePDF: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendWhatsapp: vi.fn(),
  mockUpload: vi.fn(),
  mockLogLeadCommunication: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    paymentReceipt: { findUnique: mockReceiptFindUnique, update: mockReceiptUpdate, create: mockReceiptCreate },
    invoice: { findUnique: mockInvoiceFindUnique, update: mockInvoiceUpdate },
    $transaction: mockTransaction,
  },
}));
vi.mock('../../utils/paymentReceiptPDFGenerator.js', () => ({ generatePaymentReceiptPDF: mockGeneratePDF }));
vi.mock('../../utils/emailService.js', () => ({ sendReceiptEmail: mockSendEmail }));
vi.mock('../../utils/whatsappService.js', () => ({ sendReceiptWhatsapp: mockSendWhatsapp }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: mockUpload }));
vi.mock('../../utils/docNumber.js', () => ({
  nextReceiptNumber: vi.fn().mockResolvedValue('REC-202608-00001'),
  nextPaymentHistoryNumber: vi.fn().mockResolvedValue('PAY-202608-00001'),
}));
vi.mock('../../services/events.client.js', () => ({ emitLeadEvent: vi.fn(), logLeadCommunication: mockLogLeadCommunication }));

import { createPaymentReceipt, downloadPaymentReceiptPDF, sendPaymentReceipt } from '../paymentReceipt.controller.js';
import AppError from '../../utils/appError.js';

const invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-202608-00001',
  status: 'sent',
  leadId: 'lead-1',
  customerName: 'Alice',
  customerEmail: 'alice@test.com',
  customerPhone: '+15551234567',
  customerAddress: '221B Baker Street',
  totalAmount: 1000,
  paidAmount: 0,
  outstandingAmount: 1000,
};

const receipt = {
  id: 'rec-1',
  receiptNumber: 'REC-202608-00001',
  invoiceId: 'inv-1',
  customerName: 'Alice',
  customerEmail: 'alice@test.com',
  customerPhone: '+15551234567',
  amount: 400,
  currency: 'USD',
  invoice,
};

function mockRes() {
  return { json: vi.fn(), setHeader: vi.fn(), send: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function run(handler, req) {
  const res = mockRes();
  let nextErr;
  const fullReq = { user: { id: 'user-1' }, log: { error: vi.fn() }, ...req };
  await handler(fullReq, res, (err) => { nextErr = err; });
  return { res, nextErr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceFindUnique.mockResolvedValue({ ...invoice });
  mockInvoiceUpdate.mockImplementation(async ({ data }) => ({ ...invoice, ...data }));
  mockReceiptCreate.mockImplementation(async ({ data }) => ({ id: 'rec-1', ...data }));
  mockTransaction.mockImplementation(async (cb) => cb({
    paymentReceipt: { create: mockReceiptCreate },
    invoice: { update: mockInvoiceUpdate },
  }));
  mockReceiptFindUnique.mockResolvedValue({ ...receipt });
  mockReceiptUpdate.mockImplementation(async ({ data }) => ({ ...receipt, ...data }));
  mockGeneratePDF.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockSendEmail.mockResolvedValue({ messageId: 'm-1' });
  mockSendWhatsapp.mockResolvedValue({ sid: 'SM1' });
  mockUpload.mockResolvedValue('https://cdn.example.com/receipts/rec.pdf');
  mockLogLeadCommunication.mockResolvedValue({ matched: true });
});

describe('createPaymentReceipt', () => {
  it('records a partial payment: creates the receipt and atomically updates the invoice', async () => {
    const { res, nextErr } = await run(createPaymentReceipt, {
      body: { invoiceId: 'inv-1', amount: 400, paymentMethod: 'cash' },
    });

    expect(nextErr).toBeUndefined();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-1' },
      data: { paidAmount: 400, outstandingAmount: 600, paymentStatus: 'partial' },
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('marks the invoice paid once the payment covers the full outstanding balance', async () => {
    await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 1000, paymentMethod: 'cash' } });
    expect(mockInvoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { paidAmount: 1000, outstandingAmount: 0, paymentStatus: 'paid' },
    }));
  });

  it('maps a hyphenated UI payment method to the underscore Prisma enum value', async () => {
    await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 100, paymentMethod: 'bank-transfer' } });
    expect(mockReceiptCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentMethod: 'bank_transfer' }),
    }));
  });

  it('flattens paymentDetails into the top-level bank/card/upi columns the schema actually has', async () => {
    await run(createPaymentReceipt, {
      body: {
        invoiceId: 'inv-1', amount: 100, paymentMethod: 'upi',
        paymentDetails: { upiId: 'alice@upi', upiTransactionId: 'UPI123' },
      },
    });
    expect(mockReceiptCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ upiId: 'alice@upi', upiTransactionId: 'UPI123' }),
    }));
  });

  it('falls back to the invoice snapshot for customer contact fields when not provided', async () => {
    await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 100, paymentMethod: 'cash' } });
    expect(mockReceiptCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customerName: 'Alice', customerEmail: 'alice@test.com', leadId: 'lead-1' }),
    }));
  });

  it('rejects a payment against a draft invoice', async () => {
    mockInvoiceFindUnique.mockResolvedValue({ ...invoice, status: 'draft' });
    const { nextErr } = await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 100, paymentMethod: 'cash' } });
    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(400);
    expect(nextErr.message).toMatch(/draft/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a payment against a cancelled invoice', async () => {
    mockInvoiceFindUnique.mockResolvedValue({ ...invoice, status: 'cancelled' });
    const { nextErr } = await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 100, paymentMethod: 'cash' } });
    expect(nextErr.statusCode).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects an amount greater than the outstanding balance', async () => {
    const { nextErr } = await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 1500, paymentMethod: 'cash' } });
    expect(nextErr.statusCode).toBe(400);
    expect(nextErr.message).toMatch(/outstanding balance/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects a zero or negative amount', async () => {
    const { nextErr } = await run(createPaymentReceipt, { body: { invoiceId: 'inv-1', amount: 0, paymentMethod: 'cash' } });
    expect(nextErr).toBeDefined();
  });

  it('404s when the invoice does not exist', async () => {
    mockInvoiceFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(createPaymentReceipt, { body: { invoiceId: 'missing', amount: 100, paymentMethod: 'cash' } });
    expect(nextErr.statusCode).toBe(404);
  });
});

describe('downloadPaymentReceiptPDF', () => {
  it('streams the generated PDF with the correct headers and status', async () => {
    const { res, nextErr } = await run(downloadPaymentReceiptPDF, { params: { id: 'rec-1' } });

    expect(nextErr).toBeUndefined();
    expect(mockGeneratePDF).toHaveBeenCalledWith(receipt);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('receipt-REC-202608-00001.pdf'));
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('404s when the receipt does not exist', async () => {
    mockReceiptFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(downloadPaymentReceiptPDF, { params: { id: 'missing' } });
    expect(nextErr.statusCode).toBe(404);
    expect(mockGeneratePDF).not.toHaveBeenCalled();
  });

  it('propagates a 422 with a descriptive message when org settings are incomplete', async () => {
    mockGeneratePDF.mockRejectedValue(new AppError('Cannot generate payment receipt: organization settings are incomplete (missing: companyAddress).', 422));
    const { nextErr } = await run(downloadPaymentReceiptPDF, { params: { id: 'rec-1' } });
    expect(nextErr.statusCode).toBe(422);
    expect(nextErr.message).toMatch(/organization settings are incomplete/i);
  });
});

describe('sendPaymentReceipt', () => {
  it('emails the receipt with the generated PDF and marks it sent', async () => {
    const { res, nextErr } = await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeUndefined();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'alice@test.com',
      pdfBuffer: expect.any(Buffer),
    }));
    expect(mockReceiptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ emailSent: true }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('uses the body email override instead of the customer snapshot', async () => {
    await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'email', email: 'override@test.com' } });
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'override@test.com' }));
  });

  it('uploads the PDF and sends over WhatsApp with the media URL', async () => {
    const { res } = await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'whatsapp' } });

    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockSendWhatsapp).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15551234567',
      mediaUrl: 'https://cdn.example.com/receipts/rec.pdf',
    }));
    expect(mockReceiptUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ whatsappSent: true, whatsappSentAt: expect.any(Date), pdfUrl: 'https://cdn.example.com/receipts/rec.pdf' }),
    }));
    expect(res.json).toHaveBeenCalled();
  });

  it('returns a 400 (not a crash) when the channel is not configured', async () => {
    mockSendEmail.mockRejectedValue(new Error('Email is not configured (set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD)'));

    const { nextErr } = await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(400);
    // The transport names EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD; none of that may
    // reach the caller.
    expect(nextErr.message).toBe("We couldn't send that receipt. Please try again.");
    expect(nextErr.message).not.toMatch(/EMAIL_HOST|EMAIL_USER|EMAIL_PASSWORD|not configured/i);
    expect(mockReceiptUpdate).not.toHaveBeenCalled();
  });

  it('404s when the receipt does not exist', async () => {
    mockReceiptFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(sendPaymentReceipt, { params: { id: 'missing' }, body: { channel: 'email' } });
    expect(nextErr.statusCode).toBe(404);
  });

  it('rejects an invalid channel via the Zod schema', async () => {
    const { nextErr } = await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'carrier-pigeon' } });
    expect(nextErr).toBeDefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('400s on a WhatsApp send when no phone is available anywhere', async () => {
    mockReceiptFindUnique.mockResolvedValue({ ...receipt, customerPhone: null });
    const { nextErr } = await run(sendPaymentReceipt, { params: { id: 'rec-1' }, body: { channel: 'whatsapp' } });
    expect(nextErr.statusCode).toBe(400);
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
  });
});

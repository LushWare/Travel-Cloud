import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindUnique, mockFindMany, mockCount, mockAggregate, mockQueryRaw, mockUpdate,
  mockGeneratePDF, mockSendEmail, mockSendWhatsapp, mockUpload, mockLogLeadCommunication,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockAggregate: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockUpdate: vi.fn(),
  mockGeneratePDF: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendWhatsapp: vi.fn(),
  mockUpload: vi.fn(),
  mockLogLeadCommunication: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    invoice: { findUnique: mockFindUnique, findMany: mockFindMany, count: mockCount, aggregate: mockAggregate, update: mockUpdate },
    $queryRaw: mockQueryRaw,
  },
}));
vi.mock('../../utils/invoicePDFGenerator.js', () => ({ generateInvoicePDF: mockGeneratePDF }));
vi.mock('../../utils/emailService.js', () => ({ sendInvoiceEmail: mockSendEmail }));
vi.mock('../../utils/whatsappService.js', () => ({ sendInvoiceWhatsapp: mockSendWhatsapp }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: mockUpload }));
vi.mock('../../services/events.client.js', () => ({ logLeadCommunication: mockLogLeadCommunication }));

import { downloadInvoicePDF, getAllInvoices, getInvoiceStats, sendInvoice } from '../invoice.controller.js';
import AppError from '../../utils/appError.js';

const invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-202608-00001',
  customerEmail: 'alice@test.com',
  customerPhone: '+15551234567',
  currency: 'USD',
  totalAmount: 1200,
  items: [],
};

function mockRes() {
  return { json: vi.fn(), setHeader: vi.fn(), send: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function run(handler, req) {
  const res = mockRes();
  req.log = req.log || { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  let nextErr;
  await handler(req, res, (err) => { nextErr = err; });
  return { res, nextErr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue({ ...invoice });
  mockUpdate.mockImplementation(async ({ data }) => ({ ...invoice, ...data }));
  mockGeneratePDF.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockSendEmail.mockResolvedValue({ messageId: 'm-1' });
  mockSendWhatsapp.mockResolvedValue({ sid: 'SM1' });
  mockUpload.mockResolvedValue('https://cdn.example.com/invoices/inv.pdf');
  mockLogLeadCommunication.mockResolvedValue({ matched: true });
});

describe('getAllInvoices', () => {
  it('combines the actor ownership filter with a bounded comma-separated id set', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const { nextErr } = await run(getAllInvoices, {
      query: { ids: 'invoice-1,invoice-2,,invoice-3' },
      user: { id: 'admin-1', role: 'admin', isSuperAdmin: false },
    });

    expect(nextErr).toBeUndefined();
    expect(mockFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ['invoice-1', 'invoice-2', 'invoice-3'] },
    });
  });
});

describe('getInvoiceStats', () => {
  it('returns the outstanding balance for all open invoices', async () => {
    mockCount.mockResolvedValue(0);
    mockAggregate
      .mockResolvedValueOnce({ _sum: { totalAmount: 0 } })
      .mockResolvedValueOnce({ _sum: { paidAmount: 0 } })
      .mockResolvedValueOnce({ _sum: { outstandingAmount: 4800 } });

    const { res, nextErr } = await run(getInvoiceStats, {
      query: {},
      user: { id: 'admin-1', role: 'admin', isSuperAdmin: false },
    });

    expect(nextErr).toBeUndefined();
    expect(res.json.mock.calls[0][0].data.totalOutstanding).toBe(4800);
    expect(mockAggregate.mock.calls[2][0].where.status.in).toEqual(['sent', 'viewed', 'partial', 'overdue']);
  });

  it('limits a sales rep outstanding total to invoices for their assigned leads', async () => {
    mockQueryRaw.mockResolvedValue([{ id: 'lead-7' }]);
    mockCount.mockResolvedValue(0);
    mockAggregate.mockResolvedValue({ _sum: { totalAmount: 0, paidAmount: 0, outstandingAmount: 0 } });

    await run(getInvoiceStats, {
      query: {},
      user: { id: 'rep-7', role: 'salesRep', isSuperAdmin: false },
    });

    expect(mockAggregate.mock.calls[2][0].where.leadId).toEqual({ in: ['lead-7'] });
  });
});

describe('downloadInvoicePDF', () => {
  it('streams the generated PDF with the correct headers and status', async () => {
    mockGeneratePDF.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
    const { res, nextErr } = await run(downloadInvoicePDF, { params: { id: 'inv-1' } });

    expect(nextErr).toBeUndefined();
    expect(mockGeneratePDF).toHaveBeenCalledWith(invoice);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('invoice-INV-202608-00001.pdf'));
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('404s when the invoice does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(downloadInvoicePDF, { params: { id: 'missing' } });
    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(404);
    expect(mockGeneratePDF).not.toHaveBeenCalled();
  });

  it('propagates a 422 with a descriptive message when org settings are incomplete', async () => {
    mockGeneratePDF.mockRejectedValue(new AppError('Cannot generate invoice: organization settings are incomplete (missing: companyAddress).', 422));
    const { nextErr } = await run(downloadInvoicePDF, { params: { id: 'inv-1' } });
    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(422);
    expect(nextErr.message).toMatch(/organization settings are incomplete/i);
  });
});

describe('sendInvoice', () => {
  it('emails the invoice with the generated PDF and marks it sent', async () => {
    const { res, nextErr } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeUndefined();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'alice@test.com',
      pdfBuffer: expect.any(Buffer),
    }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', emailSent: true }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('uses the body email override instead of the customer snapshot', async () => {
    await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'email', email: 'override@test.com' } });
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'override@test.com' }));
  });

  it('uploads the PDF and sends over WhatsApp with the media URL', async () => {
    const { res } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'whatsapp' } });

    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer), 'invoice-INV-202608-00001');
    expect(mockSendWhatsapp).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15551234567',
      mediaUrl: 'https://cdn.example.com/invoices/inv.pdf',
    }));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', whatsappSent: true, pdfUrl: 'https://cdn.example.com/invoices/inv.pdf' }),
    }));
    expect(mockLogLeadCommunication).toHaveBeenCalledWith(expect.objectContaining({ type: 'whatsapp' }));
    expect(res.json).toHaveBeenCalled();
  });

  it('still marks the invoice sent when logging to the lead timeline fails', async () => {
    mockLogLeadCommunication.mockRejectedValue(new Error('lead-service unreachable'));

    const { res, nextErr } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'whatsapp' } });

    expect(nextErr).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('returns a 400 (not a crash) when the channel is not configured', async () => {
    mockSendEmail.mockRejectedValue(new Error('Email is not configured (set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD)'));

    const { nextErr } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(400);
    // The transport names EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD; none of that may
    // reach the caller.
    expect(nextErr.message).toBe("We couldn't send that invoice. Please try again.");
    expect(nextErr.message).not.toMatch(/EMAIL_HOST|EMAIL_USER|EMAIL_PASSWORD|not configured/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the invoice does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(sendInvoice, { params: { id: 'missing' }, body: { channel: 'email' } });
    expect(nextErr.statusCode).toBe(404);
  });

  it('rejects an invalid channel via the Zod schema', async () => {
    const { nextErr } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'carrier-pigeon' } });
    expect(nextErr).toBeDefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('400s on a WhatsApp send when no phone is available anywhere', async () => {
    mockFindUnique.mockResolvedValue({ ...invoice, customerPhone: null });
    const { nextErr } = await run(sendInvoice, { params: { id: 'inv-1' }, body: { channel: 'whatsapp' } });
    expect(nextErr.statusCode).toBe(400);
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
  });
});

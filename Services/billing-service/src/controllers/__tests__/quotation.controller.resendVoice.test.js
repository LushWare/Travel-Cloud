import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFindUnique, mockUpdate,
  mockGeneratePDF, mockSendEmail, mockSendWhatsapp, mockUpload,
  mockLogLeadCommunication,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockGeneratePDF: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendWhatsapp: vi.fn(),
  mockUpload: vi.fn(),
  mockLogLeadCommunication: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: { quotation: { findUnique: mockFindUnique, update: mockUpdate } },
}));
vi.mock('../../utils/quotationPDFGenerator.js', () => ({ generateQuotationPDF: mockGeneratePDF }));
vi.mock('../../utils/emailService.js', () => ({ sendQuotationEmail: mockSendEmail }));
vi.mock('../../utils/whatsappService.js', () => ({ sendQuotationWhatsapp: mockSendWhatsapp }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: mockUpload }));
vi.mock('../../services/events.client.js', () => ({ emitLeadEvent: vi.fn(), logLeadCommunication: mockLogLeadCommunication }));
vi.mock('../../services/quotation.service.js', () => ({ createOrVersionQuotation: vi.fn(), quotationTotals: vi.fn() }));

import { resendQuotationForVoice } from '../quotation.controller.js';

const sentQuotation = (over = {}) => ({
  id: 'q-1', leadId: 'lead-1', quotationNumber: 'QT-202608-0001',
  customerEmail: 'alice@test.com', customerPhone: '+15551234567',
  sentAt: new Date('2026-08-01T00:00:00.000Z'), currency: 'USD', totalAmount: 1779.2, items: [],
  ...over,
});

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function run(req) {
  const res = mockRes();
  req.log = req.log || { error: vi.fn() };
  req.params = req.params || { id: 'q-1' };
  let nextErr;
  await resendQuotationForVoice(req, res, (err) => { nextErr = err; });
  return { res, nextErr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(sentQuotation());
  mockUpdate.mockImplementation(async ({ data }) => ({ ...sentQuotation(), ...data }));
  mockGeneratePDF.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockSendEmail.mockResolvedValue({ success: true });
  mockSendWhatsapp.mockResolvedValue({ success: true });
  mockUpload.mockResolvedValue('https://cdn.test/quote.pdf');
  mockLogLeadCommunication.mockResolvedValue({});
});

describe('resendQuotationForVoice', () => {
  it('refuses to resend a quotation that has never been sent', async () => {
    mockFindUnique.mockResolvedValue(sentQuotation({ sentAt: null }));
    const { nextErr } = await run({});
    expect(nextErr.statusCode).toBe(409);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
  });

  it('returns 404 for a quotation that does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { nextErr } = await run({});
    expect(nextErr.statusCode).toBe(404);
  });

  it('sends to both email and WhatsApp when the customer has both on file', async () => {
    const { res } = await run({});
    expect(mockSendEmail).toHaveBeenCalled();
    expect(mockSendWhatsapp).toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual({ email: 'sent', whatsapp: 'sent' });
  });

  it('sends only to email when no phone is on file', async () => {
    mockFindUnique.mockResolvedValue(sentQuotation({ customerPhone: null }));
    const { res } = await run({});
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual({ email: 'sent', whatsapp: null });
  });

  it('sends only to WhatsApp when no email is on file', async () => {
    mockFindUnique.mockResolvedValue(sentQuotation({ customerEmail: null }));
    const { res } = await run({});
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual({ email: null, whatsapp: 'sent' });
  });

  it('sends WhatsApp a freshly uploaded link instead of a previously stored one', async () => {
    mockFindUnique.mockResolvedValue(sentQuotation({ pdfUrl: 'https://old.example/expired.pdf' }));

    await run({});

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockSendWhatsapp).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: 'https://cdn.test/quote.pdf' }));
  });

  it('reports one channel failed without failing the other', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    const { res } = await run({});
    expect(res.json.mock.calls[0][0].data).toEqual({ email: 'failed', whatsapp: 'sent' });
  });

  it('does not throw the webhook into an error state when both channels fail', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    mockSendWhatsapp.mockRejectedValue(new Error('whatsapp down'));
    const { res, nextErr } = await run({});
    expect(nextErr).toBeUndefined();
    expect(res.json.mock.calls[0][0].data).toEqual({ email: 'failed', whatsapp: 'failed' });
  });

  it('logs the resend once on the lead timeline when at least one channel succeeds', async () => {
    await run({});
    expect(mockLogLeadCommunication).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', type: 'message' }));
  });

  it('does not log to the lead timeline when every channel fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    mockSendWhatsapp.mockRejectedValue(new Error('whatsapp down'));
    await run({});
    expect(mockLogLeadCommunication).not.toHaveBeenCalled();
  });

  it('never creates a fresh quotation — only resends the existing PDF', async () => {
    await run({});
    expect(mockGeneratePDF).toHaveBeenCalledTimes(1);
    expect(mockGeneratePDF).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1' }));
  });
});

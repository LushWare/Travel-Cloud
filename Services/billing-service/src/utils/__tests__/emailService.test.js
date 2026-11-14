import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendViaNotificationService, mockGetOrgSettings } = vi.hoisted(() => ({
  mockSendViaNotificationService: vi.fn(),
  mockGetOrgSettings: vi.fn(),
}));

vi.mock('../../services/email.client.js', () => ({ sendEmail: mockSendViaNotificationService }));

vi.mock('../../config/orgSettings.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getOrgSettings: mockGetOrgSettings };
});

const { sendQuotationEmail, sendInvoiceEmail, sendReceiptEmail, sendVoucherEmail } = await import('../emailService.js');

const SETTINGS = {
  companyName: 'Lush Travel',
  tagline: 'Your Travel Partner',
  contactEmail: 'hi@lush.test',
  contactPhone: '+1-800-000-0000',
};

const QUOTATION = { id: 'q-1', quotationNumber: 'QUO-001', customerName: 'Jane Doe', totalAmount: 1500, currency: 'USD', validUntil: '2026-12-31' };

beforeEach(() => {
  mockSendViaNotificationService.mockReset();
  mockGetOrgSettings.mockReset();
  mockGetOrgSettings.mockResolvedValue(SETTINGS);
  mockSendViaNotificationService.mockResolvedValue({ success: true });
});

describe('sendQuotationEmail', () => {
  it('throws when recipientEmail is missing', async () => {
    await expect(sendQuotationEmail({ quotation: QUOTATION, recipientEmail: '', pdfBuffer: null }))
      .rejects.toThrow('No recipient email provided');
    expect(mockSendViaNotificationService).not.toHaveBeenCalled();
  });

  it('base64-encodes the PDF buffer into a single attachment', async () => {
    const pdfBuffer = Buffer.from('pdf-bytes');
    await sendQuotationEmail({ quotation: QUOTATION, recipientEmail: 'jane@test.com', pdfBuffer });

    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].contentType).toBe('application/pdf');
    expect(Buffer.from(call.attachments[0].contentBase64, 'base64').toString()).toBe('pdf-bytes');
  });

  it('wraps the branded content in a full HTML document with a preheader', async () => {
    await sendQuotationEmail({ quotation: QUOTATION, recipientEmail: 'jane@test.com', pdfBuffer: null });

    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.html).toContain('<!DOCTYPE html>');
    expect(call.html).toContain('mso-hide:all');
    expect(call.html).toContain('QUO-001');
    expect(call.text).toContain('Jane Doe');
  });

  it('sends no attachments array entries when pdfBuffer is not provided', async () => {
    await sendQuotationEmail({ quotation: QUOTATION, recipientEmail: 'jane@test.com', pdfBuffer: null });
    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.attachments).toEqual([]);
  });

  it('uses the agency contact as Reply-To without overriding the platform sender', async () => {
    await sendQuotationEmail({ quotation: QUOTATION, recipientEmail: 'jane@test.com', pdfBuffer: null });

    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.replyTo).toBe('hi@lush.test');
    expect(call).not.toHaveProperty('from');
  });

  it('prefers the agency sales email as Reply-To when configured', async () => {
    mockGetOrgSettings.mockResolvedValue({ ...SETTINGS, salesEmail: 'sales@lush.test' });

    await sendInvoiceEmail({ invoice: { id: 'i-1' }, recipientEmail: 'jane@test.com', pdfBuffer: null });

    expect(mockSendViaNotificationService.mock.calls[0][0].replyTo).toBe('sales@lush.test');
  });

  it('propagates a rejection from notification-service to the caller', async () => {
    mockSendViaNotificationService.mockRejectedValue(new Error('Failed to send email via notification-service (status 503)'));
    await expect(sendQuotationEmail({ quotation: QUOTATION, recipientEmail: 'jane@test.com', pdfBuffer: null }))
      .rejects.toThrow('status 503');
  });
});

describe('sendInvoiceEmail / sendReceiptEmail / sendVoucherEmail', () => {
  it('includes the Stripe payment link in the invoice email and escapes its HTML attribute', async () => {
    await sendInvoiceEmail({
      invoice: { id: 'i-1', invoiceNumber: 'INV-001', customerName: 'Jane', totalAmount: 100, currency: 'USD' },
      recipientEmail: 'jane@test.com',
      pdfBuffer: null,
      paymentUrl: 'https://client.test/pay/invoice/token?a=1&b=2',
    });

    const email = mockSendViaNotificationService.mock.calls[0][0];
    expect(email.html).toContain('href="https://client.test/pay/invoice/token?a=1&amp;b=2"');
    expect(email.html).toMatch(/choose to pay the full balance or a partial amount securely through Stripe/i);
    expect(email.text).toContain('https://client.test/pay/invoice/token?a=1&b=2');
  });

  it('sendInvoiceEmail throws when recipientEmail is missing', async () => {
    await expect(sendInvoiceEmail({ invoice: { id: 'i-1' }, recipientEmail: '', pdfBuffer: null }))
      .rejects.toThrow('No recipient email provided');
  });

  it('sendReceiptEmail wraps content in a full HTML document', async () => {
    await sendReceiptEmail({ receipt: { id: 'r-1', receiptNumber: 'REC-001', amount: 500, currency: 'USD' }, recipientEmail: 'jane@test.com', pdfBuffer: null });
    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.html).toContain('<!DOCTYPE html>');
    expect(call.html).toContain('REC-001');
  });

  it('sendVoucherEmail includes the PDF attachment when a buffer is provided', async () => {
    const pdfBuffer = Buffer.from('voucher-pdf');
    await sendVoucherEmail({ voucher: { id: 'v-1', voucherNumber: 'VOU-001' }, recipientEmail: 'jane@test.com', pdfBuffer });
    const call = mockSendViaNotificationService.mock.calls[0][0];
    expect(call.attachments[0].filename).toBe('voucher-VOU-001.pdf');
  });
});

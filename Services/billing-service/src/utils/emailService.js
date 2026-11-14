import { getOrgSettings, toBrandingShape } from '../config/orgSettings.js';
import { sendEmail as sendViaNotificationService } from '../services/email.client.js';
import { wrapBillingEmail } from './emailWrap.js';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: '₹', AUD: 'A$', LKR: 'Rs ' };

const formatMoney = (amount, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${(Number(amount) || 0).toFixed(2)}`;
};

const formatDate = (date) => (date ? new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const toAttachment = (filename, pdfBuffer) =>
  pdfBuffer ? [{ filename, contentType: 'application/pdf', contentBase64: pdfBuffer.toString('base64') }] : [];

const getReplyTo = (branding) => branding.contact.salesEmail || branding.contact.email;

function quotationEmailHtml(quotation, branding) {
  const customerName = quotation.customerName || 'Customer';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${branding.company.name}</h1>
      <p style="color:#E0F2F1;margin:6px 0 0;font-size:13px;">${branding.company.tagline}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
      <h2 style="font-size:20px;margin:0 0 8px;">Your Quotation 📋</h2>
      <p style="color:#64748B;line-height:1.6;">Dear ${customerName},</p>
      <p style="color:#64748B;line-height:1.6;">Thank you for considering ${branding.company.name}. Please find your quotation
        <strong>${quotation.quotationNumber || ''}</strong> attached as a PDF. A summary is below.</p>
      <div style="background:#F1F5F9;border-radius:10px;padding:20px;margin:20px 0;">
        <div style="color:#0F766E;font-size:13px;">Total Amount</div>
        <div style="font-size:28px;font-weight:700;">${formatMoney(quotation.totalAmount, quotation.currency)}</div>
        <div style="color:#64748B;font-size:13px;margin-top:10px;">Valid until: ${formatDate(quotation.validUntil)}</div>
      </div>
      <p style="color:#64748B;line-height:1.6;">If you have any questions or would like to proceed, simply reply to this email.</p>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px;">${branding.company.name} · ${branding.contact.email} · ${branding.contact.phone}</p>
    </div>
  </div>`;
}

/**
 * Send a quotation email with the PDF attached.
 * @param {object} params
 * @param {object} params.quotation - the quotation snapshot
 * @param {string} params.recipientEmail
 * @param {Buffer} params.pdfBuffer
 * @throws {Error} when recipientEmail is missing, or notification-service rejects the send
 */
export async function sendQuotationEmail({ quotation, recipientEmail, pdfBuffer }) {
  if (!recipientEmail) throw new Error('No recipient email provided');

  const branding = toBrandingShape(await getOrgSettings());

  const subject = quotation.quotationNumber
    ? `${branding.company.name} Quotation - ${quotation.quotationNumber}`
    : `${branding.company.name} Quotation`;

  return sendViaNotificationService({
    replyTo: getReplyTo(branding),
    to: recipientEmail,
    subject,
    html: wrapBillingEmail({
      branding,
      title: subject,
      preheader: `Your ${branding.company.name} quotation${quotation.quotationNumber ? ` ${quotation.quotationNumber}` : ''} is ready.`,
      innerHtml: quotationEmailHtml(quotation, branding),
    }),
    text: `Dear ${quotation.customerName || 'Customer'},\n\nPlease find your quotation attached.\nTotal: ${formatMoney(quotation.totalAmount, quotation.currency)}\nValid until: ${formatDate(quotation.validUntil)}\n`,
    attachments: toAttachment(`quotation-${quotation.quotationNumber || quotation.id}.pdf`, pdfBuffer),
    meta: { sourceService: 'billing-service', kind: 'quotation' },
  });
}

function invoiceEmailHtml(invoice, branding, paymentUrl) {
  const customerName = invoice.customerName || 'Customer';
  const safePaymentUrl = paymentUrl ? escapeHtml(paymentUrl) : null;
  const paymentSection = safePaymentUrl
    ? `<div style="text-align:center;margin:24px 0;">
        <a href="${safePaymentUrl}" style="display:inline-block;background:#0F766E;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:700;">
          Pay online
        </a>
        <p style="color:#64748B;font-size:13px;margin-top:10px;">Choose to pay the full balance or a partial amount securely through Stripe.</p>
      </div>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${branding.company.name}</h1>
      <p style="color:#E0F2F1;margin:6px 0 0;font-size:13px;">${branding.company.tagline}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
      <h2 style="font-size:20px;margin:0 0 8px;">Your Invoice 🧾</h2>
      <p style="color:#64748B;line-height:1.6;">Dear ${customerName},</p>
      <p style="color:#64748B;line-height:1.6;">Thank you for booking with ${branding.company.name}. Please find your invoice
        <strong>${invoice.invoiceNumber || ''}</strong> attached as a PDF. A summary is below.</p>
      <div style="background:#F1F5F9;border-radius:10px;padding:20px;margin:20px 0;">
        <div style="color:#0F766E;font-size:13px;">Total Amount</div>
        <div style="font-size:28px;font-weight:700;">${formatMoney(invoice.totalAmount, invoice.currency)}</div>
        <div style="color:#64748B;font-size:13px;margin-top:10px;">Due date: ${formatDate(invoice.dueDate)}</div>
      </div>
      ${paymentSection}
      <p style="color:#64748B;line-height:1.6;">If you have any questions about this invoice, simply reply to this email.</p>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px;">${branding.company.name} · ${branding.contact.email} · ${branding.contact.phone}</p>
    </div>
  </div>`;
}

/**
 * Send an invoice email with the PDF attached.
 * @param {object} params
 * @param {object} params.invoice - the invoice snapshot
 * @param {string} params.recipientEmail
 * @param {Buffer} params.pdfBuffer
 * @throws {Error} when recipientEmail is missing, or notification-service rejects the send
 */
export async function sendInvoiceEmail({ invoice, recipientEmail, pdfBuffer, paymentUrl = null }) {
  if (!recipientEmail) throw new Error('No recipient email provided');

  const branding = toBrandingShape(await getOrgSettings());

  const subject = invoice.invoiceNumber
    ? `${branding.company.name} Invoice - ${invoice.invoiceNumber}`
    : `${branding.company.name} Invoice`;

  return sendViaNotificationService({
    replyTo: getReplyTo(branding),
    to: recipientEmail,
    subject,
    html: wrapBillingEmail({
      branding,
      title: subject,
      preheader: `Your ${branding.company.name} invoice${invoice.invoiceNumber ? ` ${invoice.invoiceNumber}` : ''} is ready.`,
      innerHtml: invoiceEmailHtml(invoice, branding, paymentUrl),
    }),
    text: `Dear ${invoice.customerName || 'Customer'},\n\nPlease find your invoice attached.\nTotal: ${formatMoney(invoice.totalAmount, invoice.currency)}\nDue date: ${formatDate(invoice.dueDate)}\n${paymentUrl ? `Pay the full balance or choose a partial amount securely: ${paymentUrl}\n` : ''}`,
    attachments: toAttachment(`invoice-${invoice.invoiceNumber || invoice.id}.pdf`, pdfBuffer),
    meta: { sourceService: 'billing-service', kind: 'invoice' },
  });
}

function receiptEmailHtml(receipt, branding) {
  const customerName = receipt.customerName || 'Customer';
  const invoiceLine = receipt.invoice?.invoiceNumber
    ? `<div style="color:#64748B;font-size:13px;margin-top:10px;">Against invoice: ${receipt.invoice.invoiceNumber}</div>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${branding.company.name}</h1>
      <p style="color:#E0F2F1;margin:6px 0 0;font-size:13px;">${branding.company.tagline}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
      <h2 style="font-size:20px;margin:0 0 8px;">Your Payment Receipt ✅</h2>
      <p style="color:#64748B;line-height:1.6;">Dear ${customerName},</p>
      <p style="color:#64748B;line-height:1.6;">Thank you for your payment to ${branding.company.name}. Please find your receipt
        <strong>${receipt.receiptNumber || ''}</strong> attached as a PDF. A summary is below.</p>
      <div style="background:#F1F5F9;border-radius:10px;padding:20px;margin:20px 0;">
        <div style="color:#0F766E;font-size:13px;">Amount Received</div>
        <div style="font-size:28px;font-weight:700;">${formatMoney(receipt.amount, receipt.currency)}</div>
        ${invoiceLine}
      </div>
      <p style="color:#64748B;line-height:1.6;">If you have any questions about this payment, simply reply to this email.</p>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px;">${branding.company.name} · ${branding.contact.email} · ${branding.contact.phone}</p>
    </div>
  </div>`;
}

/**
 * Send a payment receipt email with the PDF attached.
 * @param {object} params
 * @param {object} params.receipt - the payment receipt snapshot
 * @param {string} params.recipientEmail
 * @param {Buffer} params.pdfBuffer
 * @throws {Error} when recipientEmail is missing, or notification-service rejects the send
 */
export async function sendReceiptEmail({ receipt, recipientEmail, pdfBuffer }) {
  if (!recipientEmail) throw new Error('No recipient email provided');

  const branding = toBrandingShape(await getOrgSettings());

  const subject = receipt.receiptNumber
    ? `${branding.company.name} Payment Receipt - ${receipt.receiptNumber}`
    : `${branding.company.name} Payment Receipt`;

  return sendViaNotificationService({
    replyTo: getReplyTo(branding),
    to: recipientEmail,
    subject,
    html: wrapBillingEmail({
      branding,
      title: subject,
      preheader: `Your ${branding.company.name} payment receipt${receipt.receiptNumber ? ` ${receipt.receiptNumber}` : ''} is ready.`,
      innerHtml: receiptEmailHtml(receipt, branding),
    }),
    text: `Dear ${receipt.customerName || 'Customer'},\n\nPlease find your payment receipt attached.\nAmount received: ${formatMoney(receipt.amount, receipt.currency)}\n`,
    attachments: toAttachment(`receipt-${receipt.receiptNumber || receipt.id}.pdf`, pdfBuffer),
    meta: { sourceService: 'billing-service', kind: 'receipt' },
  });
}

function voucherEmailHtml(voucher, branding) {
  const customerName = voucher.customerName || 'Customer';
  const datesLine = voucher.travelStartDate
    ? `<div style="color:#64748B;font-size:13px;margin-top:10px;">Travel dates: ${formatDate(voucher.travelStartDate)} – ${formatDate(voucher.travelEndDate)}</div>`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0F172A;">
    <div style="background:linear-gradient(135deg,#0F766E,#14B8A6);padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:22px;">${branding.company.name}</h1>
      <p style="color:#E0F2F1;margin:6px 0 0;font-size:13px;">${branding.company.tagline}</p>
    </div>
    <div style="border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
      <h2 style="font-size:20px;margin:0 0 8px;">Your Travel Voucher ✈️</h2>
      <p style="color:#64748B;line-height:1.6;">Dear ${customerName},</p>
      <p style="color:#64748B;line-height:1.6;">Thank you for booking with ${branding.company.name}. Please find your travel voucher
        <strong>${voucher.voucherNumber || ''}</strong> attached as a PDF.</p>
      <div style="background:#F1F5F9;border-radius:10px;padding:20px;margin:20px 0;">
        <div style="color:#0F766E;font-size:13px;">Voucher Number</div>
        <div style="font-size:22px;font-weight:700;">${voucher.voucherNumber || ''}</div>
        ${datesLine}
      </div>
      <p style="color:#64748B;line-height:1.6;">If you have any questions about your trip, simply reply to this email.</p>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px;">${branding.company.name} · ${branding.contact.email} · ${branding.contact.phone}</p>
    </div>
  </div>`;
}

/**
 * Send a travel voucher email with the PDF attached.
 * @param {object} params
 * @param {object} params.voucher - the voucher snapshot
 * @param {string} params.recipientEmail
 * @param {Buffer} params.pdfBuffer
 * @throws {Error} when recipientEmail is missing, or notification-service rejects the send
 */
export async function sendVoucherEmail({ voucher, recipientEmail, pdfBuffer }) {
  if (!recipientEmail) throw new Error('No recipient email provided');

  const branding = toBrandingShape(await getOrgSettings());

  const subject = voucher.voucherNumber
    ? `${branding.company.name} Travel Voucher - ${voucher.voucherNumber}`
    : `${branding.company.name} Travel Voucher`;

  return sendViaNotificationService({
    replyTo: getReplyTo(branding),
    to: recipientEmail,
    subject,
    html: wrapBillingEmail({
      branding,
      title: subject,
      preheader: `Your ${branding.company.name} travel voucher${voucher.voucherNumber ? ` ${voucher.voucherNumber}` : ''} is ready.`,
      innerHtml: voucherEmailHtml(voucher, branding),
    }),
    text: `Dear ${voucher.customerName || 'Customer'},\n\nPlease find your travel voucher attached.\nVoucher: ${voucher.voucherNumber || ''}\n`,
    attachments: toAttachment(`voucher-${voucher.voucherNumber || voucher.id}.pdf`, pdfBuffer),
    meta: { sourceService: 'billing-service', kind: 'voucher' },
  });
}

export default { sendQuotationEmail, sendInvoiceEmail, sendReceiptEmail, sendVoucherEmail };

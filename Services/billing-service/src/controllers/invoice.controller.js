import { z } from 'zod';
import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { assertPlanFeature } from '../services/plan.service.js';
import logger from '../config/logger.js';
import { nextInvoiceNumber, nextPaymentHistoryNumber, nextReceiptNumber } from '../utils/docNumber.js';
import { generateInvoicePDF } from '../utils/invoicePDFGenerator.js';
import { sendInvoiceEmail } from '../utils/emailService.js';
import { sendInvoiceWhatsapp } from '../utils/whatsappService.js';
import { uploadPdfBuffer } from '../utils/cloudinary.js';
import { sendInvoiceSchema } from '../validators/invoice.validator.js';
import { logLeadCommunication } from '../services/events.client.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';
import { createStripeInvoicePaymentLink } from '../services/stripePayment.client.js';

// Hand-written SQL is not filtered automatically: every statement names the agency itself.
const agency = () => requireTenantId();

const invoiceInclude = {
  items: { orderBy: { order: 'asc' } },
  payments: true,
  creditNotes: true,
};

const buildLeadFilter = async (user) => {
  if (user.role === 'salesRep' && !user.isSuperAdmin) {
    const leads = await prisma.$queryRaw`
      SELECT id FROM crm_leads."Lead" WHERE "assignedToId" = ${user.id} AND "tenantId" = ${agency()}::uuid
    `;
    return { leadId: { in: leads.map((l) => l.id) } };
  }
  return {};
};

export const getAllInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, ids, status, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const leadFilter = await buildLeadFilter(req.user);

  const where = {
    ...leadFilter,
    ...(status && { status }),
    ...(ids && { id: { in: ids.split(',').filter(Boolean).slice(0, 200) } }),
    ...(startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) }),
          },
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({ where, include: invoiceInclude, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
    prisma.invoice.count({ where }),
  ]);
  res.json({ success: true, count: data.length, total, data });
});

export const getInvoiceById = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) throw new AppError('Invoice not found', 404);
  res.json({ success: true, data: invoice });
});

export const getInvoiceByLeadId = asyncHandler(async (req, res) => {
  const data = await prisma.invoice.findMany({
    where: { leadId: req.params.leadId },
    include: invoiceInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

export const createInvoice = asyncHandler(async (req, res) => {
  const { items = [], ...body } = req.body;
  const invoiceNumber = await nextInvoiceNumber();

  const subtotal = items.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
  const taxAmount = subtotal * ((body.taxRate || 0) / 100);
  const serviceChargeAmount = subtotal * ((body.serviceChargeRate || 0) / 100);
  const discountAmount = body.discountType === 'percentage'
    ? subtotal * ((body.discountValue || 0) / 100)
    : (body.discountValue || 0);
  const totalAmount = subtotal + taxAmount + serviceChargeAmount - discountAmount;

  const invoice = await prisma.invoice.create({
    data: {
      ...body,
      invoiceNumber,
      subtotal,
      taxAmount,
      serviceChargeAmount,
      discountAmount,
      totalAmount,
      outstandingAmount: totalAmount,
      createdById: req.user.id,
      items: { create: items.map((item, idx) => ({ ...item, totalPrice: item.unitPrice * item.quantity, order: idx })) },
    },
    include: invoiceInclude,
  });
  res.status(201).json({ success: true, data: invoice });
});

export const updateInvoice = asyncHandler(async (req, res) => {
  const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Invoice not found', 404);
  if (existing.status === 'cancelled') throw new AppError('Cannot update a cancelled invoice', 400);

  const {
    items, lead: _lead, quotation: _quot, payments: _pay,
    creditNotes: _cn, createdBy: _cb, lastModifiedBy: _lmb,
    ...body
  } = req.body;
  const data = { ...body, lastModifiedById: req.user.id };

  if (items) {
    const subtotal = items.reduce((s, i) => s + (i.unitPrice * i.quantity), 0);
    const taxRate = body.taxRate ?? existing.taxRate;
    const serviceChargeRate = body.serviceChargeRate ?? existing.serviceChargeRate;
    const discountType = body.discountType ?? existing.discountType;
    const discountValue = body.discountValue ?? existing.discountValue;
    data.subtotal = subtotal;
    data.taxAmount = subtotal * (taxRate / 100);
    data.serviceChargeAmount = subtotal * (serviceChargeRate / 100);
    data.discountAmount = discountType === 'percentage' ? subtotal * (discountValue / 100) : discountValue;
    data.totalAmount = data.subtotal + data.taxAmount + data.serviceChargeAmount - data.discountAmount;
    data.outstandingAmount = data.totalAmount - existing.paidAmount;

    await prisma.invoiceItem.deleteMany({ where: { invoiceId: req.params.id } });
    data.items = { create: items.map((item, idx) => ({ ...item, totalPrice: item.unitPrice * item.quantity, order: idx })) };
  }

  const invoice = await prisma.invoice.update({ where: { id: req.params.id }, data, include: invoiceInclude });
  res.json({ success: true, data: invoice });
});

export const cancelInvoice = asyncHandler(async (req, res) => {
  const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Invoice not found', 404);
  if (existing.status === 'cancelled') throw new AppError('Invoice is already cancelled', 400);

  const invoice = await prisma.invoice.update({
    where: { id: req.params.id },
    data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: req.body.reason, cancelledById: req.user.id },
    include: invoiceInclude,
  });
  res.json({ success: true, data: invoice });
});

export const sendInvoice = asyncHandler(async (req, res) => {
  const { channel, email, phone } = sendInvoiceSchema.parse(req.body || {});

  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) throw new AppError('Invoice not found', 404);

  const pdf = await generateInvoicePDF(invoice);
  const now = new Date();
  let paymentUrl = null;
  let paymentLinkWarning = null;

  try {
    if (channel === 'whatsapp') {
      await assertPlanFeature('whatsapp'); // before the PDF is uploaded anywhere
      const recipient = phone || invoice.customerPhone;
      if (!recipient) throw new AppError('No phone number available for this invoice', 400);
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendInvoiceWhatsapp({ invoice, phone: recipient, mediaUrl });
      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'sent', sentAt: now, whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl },
      });
      try {
        await logLeadCommunication({
          leadId: invoice.leadId, type: 'whatsapp', notes: `WhatsApp: Invoice ${invoice.invoiceNumber} sent`,
        });
      } catch (err) {
        req.log.error({ err, leadId: invoice.leadId }, 'Failed to log WhatsApp send on lead timeline');
      }
      return res.json({ success: true, message: 'Invoice sent via WhatsApp', data: updated });
    }

    const recipient = email || invoice.customerEmail;
    if (!recipient) throw new AppError('No email address available for this invoice', 400);
    if (invoice.status !== 'cancelled' && invoice.outstandingAmount > 0) {
      try {
        const paymentLink = await createStripeInvoicePaymentLink({
          invoiceId: invoice.id,
          tenantId: agency(),
        });
        if (paymentLink?.available) paymentUrl = paymentLink.url;
        else paymentLinkWarning = 'Stripe online payment is not available for this invoice or agency.';
      } catch (error) {
        req.log.warn({ err: error, tenantId: agency(), invoiceId: invoice.id }, 'Stripe invoice payment link could not be added');
        paymentLinkWarning = 'Invoice email was sent without a Stripe payment link. Generate one from the invoice screen or check the Stripe setup.';
      }
    }
    await sendInvoiceEmail({ invoice, recipientEmail: recipient, pdfBuffer: pdf, paymentUrl });
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'sent', sentAt: now, emailSent: true },
    });
    return res.json({
      success: true,
      message: 'Invoice sent via email',
      data: updated,
      ...(paymentLinkWarning && { warning: paymentLinkWarning }),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Configuration / delivery failures surface as a clean 400, not a 500. The
    // transport's own message is logged here and never echoed to the client.
    logger.error({ err }, 'Failed to send invoice');
    throw new AppError("We couldn't send that invoice. Please try again.", 400);
  }
});

const stripePaymentSummarySchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  currency: z.string().length(3),
  status: z.string(),
  outstandingMinor: z.number().int().nonnegative(),
  customerEmail: z.string().email().nullable(),
});

function getInvoiceIdParam(value) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new AppError('Invoice not found', 404);
  return parsed.data;
}

export const getInternalInvoicePaymentSummary = asyncHandler(async (req, res) => {
  const invoiceId = getInvoiceIdParam(req.params.id);
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, currency: true, status: true, outstandingAmount: true, customerEmail: true },
  });
  if (!invoice) throw new AppError('Invoice not found', 404);
  const summary = stripePaymentSummarySchema.parse({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    status: invoice.status,
    outstandingMinor: Math.max(0, Math.round(invoice.outstandingAmount * 100)),
    customerEmail: invoice.customerEmail || null,
  });
  res.json({ success: true, data: summary });
});

const stripePaymentSchema = z.object({
  checkoutSessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/),
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).nullable(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AUD', 'INR', 'LKR']),
}).strict();

export const recordInternalStripePayment = asyncHandler(async (req, res) => {
  const parsed = stripePaymentSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError('Stripe payment details are invalid', 400);
  const invoiceId = getInvoiceIdParam(req.params.id);
  const tenantId = agency();
  const { checkoutSessionId, paymentIntentId, amountMinor, currency } = parsed.data;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "crm_billing"."Invoice"
       WHERE id = ${invoiceId} AND "tenantId" = ${tenantId}::uuid
       FOR UPDATE
    `;
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.currency !== currency) throw new AppError('Stripe payment currency does not match the invoice', 409);

    const existing = await tx.paymentReceipt.findFirst({
      where: { paymentGateway: 'stripe', gatewayTransactionId: checkoutSessionId },
      include: { paymentHistories: true },
    });
    if (existing) return existing;

    const amount = amountMinor / 100;
    const previousBalance = Math.max(0, invoice.outstandingAmount);
    const paidAmount = invoice.paidAmount + amount;
    const outstandingBalance = Math.max(0, invoice.totalAmount - paidAmount);
    const paymentStatus = paidAmount > invoice.totalAmount + 0.000001
      ? 'overpaid'
      : outstandingBalance <= 0 ? 'paid' : 'partial';
    const paymentDate = new Date();
    const receiptNumber = await nextReceiptNumber();
    const paymentHistoryNumber = await nextPaymentHistoryNumber();
    const receiptStatus = outstandingBalance <= 0 ? 'paid_in_full' : 'partial_payment';
    const paymentType = amount >= previousBalance ? 'full_payment' : 'installment';

    const receipt = await tx.paymentReceipt.create({
      data: {
        receiptNumber,
        leadId: invoice.leadId,
        invoiceId: invoice.id,
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        customerPhone: invoice.customerPhone,
        customerAddress: invoice.customerAddress,
        amount,
        currency,
        paymentMethod: 'online',
        paymentDate,
        transactionId: paymentIntentId,
        paymentType,
        receiptStatus,
        previousBalance,
        outstandingBalance,
        createdById: invoice.createdById,
        paymentGateway: 'stripe',
        gatewayTransactionId: checkoutSessionId,
        gatewayPaymentId: paymentIntentId,
        verified: true,
        verifiedAt: paymentDate,
        reconciled: true,
        reconciledAt: paymentDate,
        notes: 'Paid through Stripe Checkout',
        paymentHistories: {
          create: {
            paymentHistoryNumber,
            leadId: invoice.leadId,
            invoiceId: invoice.id,
            customerName: invoice.customerName,
            customerEmail: invoice.customerEmail,
            customerPhone: invoice.customerPhone,
            amount,
            currency,
            paymentMethod: 'online',
            paymentDate,
            transactionId: paymentIntentId,
            paymentType,
            status: 'reconciled',
            createdById: invoice.createdById,
            verifiedAt: paymentDate,
            reconciledAt: paymentDate,
            notes: 'Paid through Stripe Checkout',
          },
        },
      },
      include: { paymentHistories: true },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount,
        outstandingAmount: outstandingBalance,
        paymentStatus,
        status: outstandingBalance <= 0 ? 'paid' : 'partial',
        ...(outstandingBalance <= 0 && { paidDate: paymentDate }),
      },
    });
    return receipt;
  });
  res.json({ success: true, data: result });
});

export const createInvoicePaymentLink = asyncHandler(async (req, res) => {
  await assertPlanFeature('finance_docs');
  const invoiceId = getInvoiceIdParam(req.params.id);
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'draft' || invoice.status === 'cancelled' || invoice.outstandingAmount <= 0) {
    throw new AppError('This invoice is not available for online payment.', 409);
  }
  const paymentLink = await createStripeInvoicePaymentLink({ invoiceId: invoice.id, tenantId: agency() });
  if (!paymentLink?.available || typeof paymentLink.url !== 'string') {
    throw new AppError('Stripe online payments are not ready for this agency.', 503);
  }
  res.json({ success: true, data: { url: paymentLink.url } });
});

// ─── POST /:id/resend-voice ─────────────────────────────────────
export const resendInvoiceForVoice = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (!invoice.sentAt) throw new AppError('This invoice has not been sent yet — a specialist needs to send it the first time', 409);

  const results = { email: null, whatsapp: null };
  const pdf = await generateInvoicePDF(invoice);
  const now = new Date();

  if (invoice.customerEmail) {
    try {
      await sendInvoiceEmail({ invoice, recipientEmail: invoice.customerEmail, pdfBuffer: pdf });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { emailSent: true } });
      results.email = 'sent';
    } catch (err) {
      req.log.error({ err, invoiceId: invoice.id }, 'Voice resend: email failed');
      results.email = 'failed';
    }
  }

  if (invoice.customerPhone) {
    try {
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendInvoiceWhatsapp({ invoice, phone: invoice.customerPhone, mediaUrl });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl } });
      results.whatsapp = 'sent';
    } catch (err) {
      req.log.error({ err, invoiceId: invoice.id }, 'Voice resend: WhatsApp failed');
      results.whatsapp = 'failed';
    }
  }

  if (results.email === 'sent' || results.whatsapp === 'sent') {
    try {
      await logLeadCommunication({
        leadId: invoice.leadId, type: 'message',
        notes: `Invoice ${invoice.invoiceNumber} resent by voice agent (email: ${results.email ?? 'n/a'}, WhatsApp: ${results.whatsapp ?? 'n/a'})`,
      });
    } catch (err) {
      req.log.error({ err, leadId: invoice.leadId }, 'Failed to log voice resend on lead timeline');
    }
  }

  res.json({ success: true, data: results });
});

export const markInvoiceViewed = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.update({
    where: { id: req.params.id },
    data: { status: 'viewed', viewedAt: new Date() },
  });
  res.json({ success: true, data: invoice });
});

export const sendPaymentReminder = asyncHandler(async (req, res) => {
  await prisma.invoice.update({
    where: { id: req.params.id },
    data: { remindersSent: { increment: 1 }, lastReminderSent: new Date() },
  });
  res.json({ success: true, message: 'Payment reminder sent' });
});

export const getInvoiceStats = asyncHandler(async (req, res) => {
  const leadFilter = await buildLeadFilter(req.user);
  const [total, paid, overdue, draft, revenue, collected, outstanding] = await Promise.all([
    prisma.invoice.count({ where: { ...leadFilter, status: { not: 'cancelled' } } }),
    prisma.invoice.count({ where: { ...leadFilter, paymentStatus: 'paid' } }),
    prisma.invoice.count({ where: { ...leadFilter, status: { in: ['sent', 'partial', 'overdue'] }, dueDate: { lt: new Date() } } }),
    prisma.invoice.count({ where: { ...leadFilter, status: 'draft' } }),
    prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { ...leadFilter, status: { not: 'cancelled' } } }),
    prisma.invoice.aggregate({ _sum: { paidAmount: true }, where: { ...leadFilter, status: { not: 'cancelled' } } }),
    prisma.invoice.aggregate({
      _sum: { outstandingAmount: true },
      where: { ...leadFilter, status: { in: ['sent', 'viewed', 'partial', 'overdue'] } },
    }),
  ]);
  res.json({
    success: true,
    data: {
      total, paid, overdue, draft,
      totalRevenue: revenue._sum.totalAmount || 0,
      totalCollected: collected._sum.paidAmount || 0,
      totalOutstanding: outstanding._sum.outstandingAmount || 0,
    },
  });
});

export const getOverdueInvoices = asyncHandler(async (req, res) => {
  const data = await prisma.invoice.findMany({
    where: { status: { in: ['sent', 'partial', 'overdue'] }, dueDate: { lt: new Date() } },
    include: invoiceInclude,
    orderBy: { dueDate: 'asc' },
  });
  res.json({ success: true, data });
});

export const downloadInvoicePDF = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: invoiceInclude });
  if (!invoice) throw new AppError('Invoice not found', 404);

  const pdf = await generateInvoicePDF(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="invoice-${invoice.invoiceNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

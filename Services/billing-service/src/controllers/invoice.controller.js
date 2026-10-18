import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import logger from '../config/logger.js';
import { nextInvoiceNumber } from '../utils/docNumber.js';
import { generateInvoicePDF } from '../utils/invoicePDFGenerator.js';
import { sendInvoiceEmail } from '../utils/emailService.js';
import { sendInvoiceWhatsapp } from '../utils/whatsappService.js';
import { uploadPdfBuffer } from '../utils/cloudinary.js';
import { sendInvoiceSchema } from '../validators/invoice.validator.js';
import { logLeadCommunication } from '../services/events.client.js';

const invoiceInclude = {
  items: { orderBy: { order: 'asc' } },
  payments: true,
  creditNotes: true,
};

const buildLeadFilter = async (user) => {
  if (user.role === 'salesRep' && !user.isSuperAdmin) {
    const leads = await prisma.$queryRaw`
      SELECT id FROM crm_leads."Lead" WHERE "assignedToId" = ${user.id}
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

  try {
    if (channel === 'whatsapp') {
      const recipient = phone || invoice.customerPhone;
      if (!recipient) throw new AppError('No phone number available for this invoice', 400);
      const mediaUrl = await uploadPdfBuffer(pdf, `invoice-${invoice.invoiceNumber}`);
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
    await sendInvoiceEmail({ invoice, recipientEmail: recipient, pdfBuffer: pdf });
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'sent', sentAt: now, emailSent: true },
    });
    return res.json({ success: true, message: 'Invoice sent via email', data: updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Configuration / delivery failures surface as a clean 400, not a 500. The
    // transport's own message is logged here and never echoed to the client.
    logger.error({ err }, 'Failed to send invoice');
    throw new AppError("We couldn't send that invoice. Please try again.", 400);
  }
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
      const mediaUrl = await uploadPdfBuffer(pdf, `invoice-${invoice.invoiceNumber}`);
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

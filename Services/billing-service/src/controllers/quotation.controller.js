import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import logger from '../config/logger.js';
import { nextQuotationNumber, nextInvoiceNumber } from '../utils/docNumber.js';
import { quotationTotals, createOrVersionQuotation } from '../services/quotation.service.js';
import { emitLeadEvent, logLeadCommunication } from '../services/events.client.js';
import { generateQuotationPDF } from '../utils/quotationPDFGenerator.js';
import { sendQuotationEmail } from '../utils/emailService.js';
import { sendQuotationWhatsapp } from '../utils/whatsappService.js';
import { uploadPdfBuffer } from '../utils/cloudinary.js';
import { sendQuotationSchema, voiceAutoSendQuotationSchema, convertToInvoiceSchema } from '../validators/quotation.validator.js';
import { LeadSnapshotForQuotation } from '@travel-crm/contracts';
import { getOrgSettings, toBrandingShape, getBankDetails } from '../config/orgSettings.js';

const quotationInclude = {
  items: { orderBy: { order: 'asc' } },
  images: true,
  revisionHistory: { orderBy: { modifiedAt: 'desc' } },
};

export const getAllQuotations = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, ids, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const where = {
    ...(status && { status }),
    ...(ids && { id: { in: ids.split(',').filter(Boolean).slice(0, 200) } }),
  };

  const [data, total] = await Promise.all([
    prisma.quotation.findMany({ where, include: quotationInclude, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
    prisma.quotation.count({ where }),
  ]);
  res.json({ success: true, count: data.length, total, data });
});

export const getQuotationById = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: quotationInclude });
  if (!quotation) throw new AppError('Quotation not found', 404);
  res.json({ success: true, data: quotation });
});

export const getQuotationsByLeadId = asyncHandler(async (req, res) => {
  const data = await prisma.quotation.findMany({
    where: { leadId: req.params.leadId },
    include: quotationInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

export const createQuotation = asyncHandler(async (req, res) => {
  const { items = [], images = [], ...body } = req.body;
  const quotationNumber = await nextQuotationNumber();

  const { taxableSubtotal, ...totals } = quotationTotals(items, {
    taxRate: body.taxRate,
    serviceChargeRate: body.serviceChargeRate,
    discountType: body.discountType,
    discountValue: body.discountValue,
  });
  void taxableSubtotal; // computed intermediate, not a persisted column

  const quotation = await prisma.quotation.create({
    data: {
      ...body,
      quotationNumber,
      ...totals,
      createdById: req.user.id,
      items: { create: items.map((item, idx) => ({ ...item, totalPrice: item.unitPrice * item.quantity, order: idx })) },
      images: { create: images },
    },
    include: quotationInclude,
  });
  res.status(201).json({ success: true, data: quotation });
});

export const updateQuotation = asyncHandler(async (req, res) => {
  const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Quotation not found', 404);
  if (['converted', 'accepted'].includes(existing.status)) throw new AppError('Cannot update this quotation', 400);

  const {
    items, images, lead: _lead, createdBy: _cb,
    lastModifiedBy: _lmb, revisionHistory: _rev,
    ...body
  } = req.body;
  const data = { ...body, lastModifiedById: req.user.id, version: { increment: 1 } };

  if (items) {
    const { taxableSubtotal, ...totals } = quotationTotals(items, {
      taxRate: body.taxRate ?? existing.taxRate,
      serviceChargeRate: body.serviceChargeRate ?? existing.serviceChargeRate,
      discountType: body.discountType ?? existing.discountType,
      discountValue: body.discountValue ?? existing.discountValue,
    });
    void taxableSubtotal; // computed intermediate, not a persisted column
    Object.assign(data, totals);
    await prisma.quotationItem.deleteMany({ where: { quotationId: req.params.id } });
    data.items = { create: items.map((item, idx) => ({ ...item, totalPrice: item.unitPrice * item.quantity, order: idx })) };
  }

  const rev = { version: existing.version, modifiedById: req.user.id, changes: JSON.stringify(body) };
  data.revisionHistory = { create: rev };

  const quotation = await prisma.quotation.update({ where: { id: req.params.id }, data, include: quotationInclude });
  res.json({ success: true, data: quotation });
});

/**
 * POST /api/v1/billing/quotations/from-lead
 * Lead-service snapshot handoff: create version 1 or bump the version of the
 * lead's existing quotation. Validates totals against the shared engine.
 */
export const createQuotationFromLead = asyncHandler(async (req, res) => {
  const parsedBody = LeadSnapshotForQuotation.safeParse(req.body);
  if (!parsedBody.success) {
    const messages = parsedBody.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const parsed = parsedBody.data;

  // Internal (gateway-bypassing) call: there is usually no request user, so the
  // acting user id arrives in the body. Fall back to req.user for completeness.
  const createdById = req.user?.id || parsed.createdById || null;

  const quotation = await createOrVersionQuotation({
    ...parsed,
    createdById,
  });
  res.status(201).json({ success: true, data: quotation });
});

export const deleteQuotation = asyncHandler(async (req, res) => {
  const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Quotation not found', 404);
  await prisma.quotation.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Quotation deleted' });
});

/**
 * POST /quotations/:id/send — generate the PDF and deliver it over the chosen
 * channel (email attachment, or WhatsApp with the PDF hosted on Cloudinary as
 * media). Delivery utilities fail soft when their credentials are absent so a
 * misconfigured environment yields a clear 400, never a crash.
 */
export const sendQuotation = asyncHandler(async (req, res) => {
  const { channel, email, phone } = sendQuotationSchema.parse(req.body || {});

  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: quotationInclude });
  if (!quotation) throw new AppError('Quotation not found', 404);

  const pdf = await generateQuotationPDF(quotation);
  const now = new Date();

  try {
    if (channel === 'whatsapp') {
      const recipient = phone || quotation.customerPhone;
      if (!recipient) throw new AppError('No phone number available for this quotation', 400);
      const mediaUrl = await uploadPdfBuffer(pdf, `quotation-${quotation.quotationNumber}`);
      await sendQuotationWhatsapp({ quotation, phone: recipient, mediaUrl });
      const updated = await prisma.quotation.update({
        where: { id: quotation.id },
        data: { status: 'sent', sentAt: now, whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl },
      });
      try {
        await logLeadCommunication({
          leadId: quotation.leadId, type: 'whatsapp', notes: `WhatsApp: Quotation ${quotation.quotationNumber} sent`,
        });
      } catch (err) {
        req.log.error({ err, leadId: quotation.leadId }, 'Failed to log WhatsApp send on lead timeline');
      }
      return res.json({ success: true, message: 'Quotation sent via WhatsApp', data: updated });
    }

    const recipient = email || quotation.customerEmail;
    if (!recipient) throw new AppError('No email address available for this quotation', 400);
    await sendQuotationEmail({ quotation, recipientEmail: recipient, pdfBuffer: pdf });
    const updated = await prisma.quotation.update({
      where: { id: quotation.id },
      data: { status: 'sent', sentAt: now, emailSent: true },
    });
    return res.json({ success: true, message: 'Quotation sent via email', data: updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Configuration / delivery failures surface as a clean 400, not a 500. The
    // transport's own message is logged here and never echoed to the client.
    logger.error({ err }, 'Failed to send quotation');
    throw new AppError("We couldn't send that quotation. Please try again.", 400);
  }
});

export const sendVoiceQuotation = asyncHandler(async (req, res) => {
  const { leadId, packageId, expectedPackagePrice } = voiceAutoSendQuotationSchema.parse(req.body || {});
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: quotationInclude });
  if (!quotation) throw new AppError('Quotation not found', 404);
  if (!['draft', 'sent'].includes(quotation.status)) {
    throw new AppError('Only a draft or sent quotation can be delivered automatically', 409);
  }
  if (quotation.leadId !== leadId || quotation.packageId !== packageId
    || typeof expectedPackagePrice !== 'number' || !Number.isFinite(expectedPackagePrice)
    || expectedPackagePrice < 0 || Math.abs(Number(quotation.subtotal) - expectedPackagePrice) > 0.01) {
    return res.json({
      success: true,
      data: { email: 'not_sent', whatsapp: 'not_sent', allSent: false, reason: 'quotation_package_price_mismatch' },
    });
  }

  const results = {
    email: quotation.emailSent ? 'already_sent' : quotation.customerEmail ? 'failed' : 'unavailable',
    whatsapp: quotation.whatsappSent ? 'already_sent' : quotation.customerPhone ? 'failed' : 'unavailable',
  };
  if (results.email === 'unavailable' || results.whatsapp === 'unavailable') {
    req.log.warn({ quotationId: quotation.id, results }, 'Voice quotation is missing a delivery channel');
  }

  let pdf;
  if (results.email === 'failed' || results.whatsapp === 'failed') {
    pdf = await generateQuotationPDF(quotation);
  }

  if (results.email === 'failed') {
    try {
      await sendQuotationEmail({ quotation, recipientEmail: quotation.customerEmail, pdfBuffer: pdf });
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { status: 'sent', sentAt: quotation.sentAt || new Date(), emailSent: true },
      });
      results.email = 'sent';
    } catch (err) {
      req.log.error({ err, quotationId: quotation.id }, 'Voice quotation email delivery failed');
    }
  }

  if (results.whatsapp === 'failed') {
    try {
      const mediaUrl = quotation.pdfUrl || await uploadPdfBuffer(pdf, `quotation-${quotation.quotationNumber}`);
      await sendQuotationWhatsapp({ quotation, phone: quotation.customerPhone, mediaUrl });
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: {
          status: 'sent', sentAt: quotation.sentAt || new Date(), whatsappSent: true,
          whatsappSentAt: new Date(), pdfUrl: mediaUrl,
        },
      });
      results.whatsapp = 'sent';
    } catch (err) {
      req.log.error({ err, quotationId: quotation.id }, 'Voice quotation WhatsApp delivery failed');
    }
  }

  if (results.email === 'sent' || results.whatsapp === 'sent') {
    try {
      await logLeadCommunication({
        leadId: quotation.leadId,
        type: 'message',
        notes: `Voice quotation ${quotation.quotationNumber} delivery (email: ${results.email}, WhatsApp: ${results.whatsapp})`,
      });
    } catch (err) {
      req.log.error({ err, leadId: quotation.leadId }, 'Failed to log voice quotation delivery');
    }
  }

  res.json({ success: true, data: { ...results, allSent: ['sent', 'already_sent'].includes(results.email) && ['sent', 'already_sent'].includes(results.whatsapp) } });
});

// ─── POST /:id/resend-voice ─────────────────────────────────────
export const resendQuotationForVoice = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: quotationInclude });
  if (!quotation) throw new AppError('Quotation not found', 404);
  if (!quotation.sentAt) throw new AppError('This quotation has not been sent yet — a specialist needs to send it the first time', 409);

  const results = { email: null, whatsapp: null };
  const pdf = await generateQuotationPDF(quotation);
  const now = new Date();

  if (quotation.customerEmail) {
    try {
      await sendQuotationEmail({ quotation, recipientEmail: quotation.customerEmail, pdfBuffer: pdf });
      await prisma.quotation.update({ where: { id: quotation.id }, data: { emailSent: true } });
      results.email = 'sent';
    } catch (err) {
      req.log.error({ err, quotationId: quotation.id }, 'Voice resend: email failed');
      results.email = 'failed';
    }
  }

  if (quotation.customerPhone) {
    try {
      const mediaUrl = await uploadPdfBuffer(pdf, `quotation-${quotation.quotationNumber}`);
      await sendQuotationWhatsapp({ quotation, phone: quotation.customerPhone, mediaUrl });
      await prisma.quotation.update({ where: { id: quotation.id }, data: { whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl } });
      results.whatsapp = 'sent';
    } catch (err) {
      req.log.error({ err, quotationId: quotation.id }, 'Voice resend: WhatsApp failed');
      results.whatsapp = 'failed';
    }
  }

  if (results.email === 'sent' || results.whatsapp === 'sent') {
    try {
      await logLeadCommunication({
        leadId: quotation.leadId, type: 'message',
        notes: `Quotation ${quotation.quotationNumber} resent by voice agent (email: ${results.email ?? 'n/a'}, WhatsApp: ${results.whatsapp ?? 'n/a'})`,
      });
    } catch (err) {
      req.log.error({ err, leadId: quotation.leadId }, 'Failed to log voice resend on lead timeline');
    }
  }

  res.json({ success: true, data: results });
});

export const markQuotationViewed = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.update({
    where: { id: req.params.id },
    data: { status: 'viewed', viewedAt: new Date() },
  });
  res.json({ success: true, data: quotation });
});

export const acceptQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.update({
    where: { id: req.params.id },
    data: { status: 'accepted', acceptedAt: new Date() },
  });
  try {
    await emitLeadEvent({
      type: 'quotation.accepted',
      leadId: quotation.leadId,
      payload: { quoteId: quotation.id, version: quotation.version, packageId: quotation.packageId },
    });
  } catch (err) {
    req.log.error({ err, leadId: quotation.leadId }, 'Failed to notify lead-service of acceptance');
  }
  res.json({ success: true, data: quotation });
});

export const rejectQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.update({
    where: { id: req.params.id },
    data: { status: 'rejected', rejectedAt: new Date(), rejectionReason: req.body.reason },
  });
  try {
    await emitLeadEvent({
      type: 'quotation.rejected',
      leadId: quotation.leadId,
      payload: { quoteId: quotation.id, reason: req.body.reason || null, packageId: quotation.packageId },
    });
  } catch (err) {
    req.log.error({ err, leadId: quotation.leadId }, 'Failed to notify lead-service of rejection');
  }
  res.json({ success: true, data: quotation });
});

/**
 * Creates an Invoice from an already-priced Quotation. Pricing
 * (subtotal/tax/discount/serviceCharge/total + items) is always copied
 * verbatim from the quotation — an invoice must never recompute the numbers
 * a customer already agreed to. Customer/destination/bank/terms fields
 * follow a three-level precedence: explicit override in the request body →
 * the quotation's own snapshot (customer/destination) or current org
 * settings (bank/terms) → nothing (left blank) if neither is set.
 */
export const convertQuotationToInvoice = asyncHandler(async (req, res) => {
  const overrides = convertToInvoiceSchema.parse(req.body || {});

  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!quotation) throw new AppError('Quotation not found', 404);
  if (quotation.status === 'converted') throw new AppError('Already converted', 400);

  const invoiceNumber = await nextInvoiceNumber();
  const dueDate = overrides.dueDate || new Date(Date.now() + 30 * 86400000);

  const orgSettings = await getOrgSettings();
  const branding = toBrandingShape(orgSettings);
  const bank = getBankDetails(branding);

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      currency: quotation.currency,
      leadId: quotation.leadId,
      quotationId: quotation.id,
      bookingId: overrides.bookingId ?? undefined,
      createdById: req.user.id,

      customerName: overrides.customerName ?? quotation.customerName,
      customerEmail: overrides.customerEmail ?? quotation.customerEmail,
      customerPhone: overrides.customerPhone ?? quotation.customerPhone,
      customerAddress: overrides.customerAddress ?? quotation.customerAddress,
      customerGstNumber: overrides.customerGstNumber ?? quotation.customerGstNumber,
      destination: overrides.destination ?? quotation.destination,

      // Pricing is never recomputed — copied verbatim from the quotation.
      subtotal: quotation.subtotal,
      taxRate: quotation.taxRate,
      taxAmount: quotation.taxAmount,
      discountType: quotation.discountType,
      discountValue: quotation.discountValue,
      discountAmount: quotation.discountAmount,
      serviceChargeRate: quotation.serviceChargeRate,
      serviceChargeAmount: quotation.serviceChargeAmount,
      totalAmount: quotation.totalAmount,
      outstandingAmount: quotation.totalAmount,

      dueDate,
      notes: overrides.notes ?? quotation.notes,
      terms: quotation.terms,
      paymentTerms: overrides.paymentTerms ?? branding.content.invoiceTerms,
      paymentInstructions: overrides.paymentInstructions ?? branding.content.invoicePaymentInstructions,

      bankAccountName: overrides.bankAccountName ?? bank.accountName,
      bankAccountNumber: overrides.bankAccountNumber ?? bank.accountNumber,
      bankName: overrides.bankName ?? bank.bankName,
      bankIfscCode: overrides.bankIfscCode ?? bank.ifscCode,
      bankSwiftCode: overrides.bankSwiftCode ?? bank.swiftCode,
      bankBranch: overrides.bankBranch ?? bank.branch,
      bankUpiId: overrides.bankUpiId ?? bank.upiId,

      items: { create: quotation.items.map(({ id, quotationId, ...item }) => item) },
    },
    include: { items: true },
  });

  await prisma.quotation.update({
    where: { id: req.params.id },
    data: { status: 'converted', convertedToInvoiceId: invoice.id },
  });

  res.status(201).json({ success: true, data: invoice });
});

export const getQuotationStats = asyncHandler(async (req, res) => {
  const [total, pending, accepted, rejected, converted] = await Promise.all([
    prisma.quotation.count(),
    prisma.quotation.count({ where: { status: { in: ['sent', 'viewed'] } } }),
    prisma.quotation.count({ where: { status: 'accepted' } }),
    prisma.quotation.count({ where: { status: 'rejected' } }),
    prisma.quotation.count({ where: { status: 'converted' } }),
  ]);
  res.json({ success: true, data: { total, pending, accepted, rejected, converted } });
});

export const downloadQuotationPDF = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: quotationInclude });
  if (!quotation) throw new AppError('Quotation not found', 404);

  const pdf = await generateQuotationPDF(quotation);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="quotation-${quotation.quotationNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { assertPlanFeature } from '../services/plan.service.js';
import { audit } from '../utils/audit.js';
import logger from '../config/logger.js';
import { nextVoucherNumber } from '../utils/docNumber.js';
import { generateVoucherPDF } from '../utils/voucherPDFGenerator.js';
import { sendVoucherEmail } from '../utils/emailService.js';
import { sendVoucherWhatsapp } from '../utils/whatsappService.js';
import { uploadPdfBuffer } from '../utils/cloudinary.js';
import { sendVoucherSchema, createVoucherSchema, updateVoucherSchema } from '../validators/voucher.validator.js';
import { logLeadCommunication } from '../services/events.client.js';

const voucherInclude = {
  locationDates: { orderBy: { order: 'asc' } },
  mealPlans: { orderBy: { dayNumber: 'asc' } },
  itinerarySummary: { orderBy: { order: 'asc' } },
  flightSegments: { orderBy: [{ dayNumber: 'asc' }, { order: 'asc' }] },
};

export const getAllVouchers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const where = { ...(status && { status }) };
  const [data, total] = await Promise.all([
    prisma.voucher.findMany({ where, include: voucherInclude, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
    prisma.voucher.count({ where }),
  ]);
  res.json({ success: true, count: data.length, total, data });
});

export const getVoucherById = asyncHandler(async (req, res) => {
  const voucher = await prisma.voucher.findUnique({ where: { id: req.params.id }, include: voucherInclude });
  if (!voucher) throw new AppError('Voucher not found', 404);
  res.json({ success: true, data: voucher });
});

export const getVouchersByLeadId = asyncHandler(async (req, res) => {
  const data = await prisma.voucher.findMany({ where: { leadId: req.params.leadId }, include: voucherInclude, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data });
});

export const createVoucher = asyncHandler(async (req, res) => {
  const {
    locationDates = [], mealPlans = [], itinerarySummary = [], flightSegments = [], ...body
  } = createVoucherSchema.parse(req.body);
  const voucherNumber = await nextVoucherNumber();

  const voucher = await prisma.voucher.create({
    data: {
      ...body,
      voucherNumber,
      createdById: req.user.id,
      locationDates: { create: locationDates.map((l, idx) => ({ ...l, order: idx })) },
      mealPlans: { create: mealPlans },
      itinerarySummary: { create: itinerarySummary.map((s, idx) => ({ ...s, order: idx })) },
      flightSegments: { create: flightSegments.map((f, idx) => ({ ...f, order: idx })) },
    },
    include: voucherInclude,
  });
  res.status(201).json({ success: true, data: voucher });
});

export const updateVoucher = asyncHandler(async (req, res) => {
  const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Voucher not found', 404);
  if (existing.status === 'cancelled') throw new AppError('Cannot update a cancelled voucher', 400);

  const {
    locationDates, mealPlans, itinerarySummary, flightSegments, ...body
  } = updateVoucherSchema.parse(req.body);
  const data = { ...body, lastModifiedById: req.user.id };

  if (locationDates) {
    await prisma.voucherLocationDate.deleteMany({ where: { voucherId: req.params.id } });
    data.locationDates = { create: locationDates.map((l, idx) => ({ ...l, order: idx })) };
  }
  if (mealPlans) {
    await prisma.voucherMealPlan.deleteMany({ where: { voucherId: req.params.id } });
    data.mealPlans = { create: mealPlans };
  }
  if (itinerarySummary) {
    await prisma.voucherItinerarySummary.deleteMany({ where: { voucherId: req.params.id } });
    data.itinerarySummary = { create: itinerarySummary.map((s, idx) => ({ ...s, order: idx })) };
  }
  if (flightSegments) {
    await prisma.voucherFlightSegment.deleteMany({ where: { voucherId: req.params.id } });
    data.flightSegments = { create: flightSegments.map((f, idx) => ({ ...f, order: idx })) };
  }

  const voucher = await prisma.voucher.update({ where: { id: req.params.id }, data, include: voucherInclude });
  res.json({ success: true, data: voucher });
});

export const deleteVoucher = asyncHandler(async (req, res) => {
  const existing = await prisma.voucher.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Voucher not found', 404);
  await prisma.voucher.delete({ where: { id: req.params.id } });
  await audit(req, {
    action: 'billing.voucher_deleted', targetType: 'voucher', targetId: existing.id,
    summary: `Deleted voucher ${existing.voucherNumber}`,
  });
  res.json({ success: true, message: 'Voucher deleted' });
});

export const sendVoucher = asyncHandler(async (req, res) => {
  const { channel, email, phone } = sendVoucherSchema.parse(req.body || {});

  const voucher = await prisma.voucher.findUnique({ where: { id: req.params.id }, include: voucherInclude });
  if (!voucher) throw new AppError('Voucher not found', 404);

  const pdf = await generateVoucherPDF(voucher);
  const now = new Date();
  const statusUpdate = voucher.status === 'draft' ? { status: 'sent' } : {};

  try {
    if (channel === 'whatsapp') {
      await assertPlanFeature('whatsapp'); // before the PDF is uploaded anywhere
      const recipient = phone || voucher.customerPhone;
      if (!recipient) throw new AppError('No phone number available for this voucher', 400);
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendVoucherWhatsapp({ voucher, phone: recipient, mediaUrl });
      const updated = await prisma.voucher.update({
        where: { id: voucher.id },
        data: { ...statusUpdate, whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl },
        include: voucherInclude,
      });
      try {
        await logLeadCommunication({
          leadId: voucher.leadId, type: 'whatsapp', notes: `WhatsApp: Voucher ${voucher.voucherNumber} sent`,
        });
      } catch (err) {
        req.log.error({ err, leadId: voucher.leadId }, 'Failed to log WhatsApp send on lead timeline');
      }
      return res.json({ success: true, message: 'Voucher sent via WhatsApp', data: updated });
    }

    const recipient = email || voucher.customerEmail;
    if (!recipient) throw new AppError('No email address available for this voucher', 400);
    await sendVoucherEmail({ voucher, recipientEmail: recipient, pdfBuffer: pdf });
    const updated = await prisma.voucher.update({
      where: { id: voucher.id },
      data: { ...statusUpdate, emailSent: true, emailSentAt: now },
      include: voucherInclude,
    });
    return res.json({ success: true, message: 'Voucher sent via email', data: updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Configuration / delivery failures surface as a clean 400, not a 500. The
    // transport's own message is logged here and never echoed to the client.
    logger.error({ err }, 'Failed to send voucher');
    throw new AppError("We couldn't send that voucher. Please try again.", 400);
  }
});

// ─── POST /:id/resend-voice ─────────────────────────────────────
export const resendVoucherForVoice = asyncHandler(async (req, res) => {
  const voucher = await prisma.voucher.findUnique({ where: { id: req.params.id }, include: voucherInclude });
  if (!voucher) throw new AppError('Voucher not found', 404);
  if (!voucher.emailSent && !voucher.whatsappSent) {
    throw new AppError('This voucher has not been sent yet — a specialist needs to send it the first time', 409);
  }

  const results = { email: null, whatsapp: null };
  const pdf = await generateVoucherPDF(voucher);
  const now = new Date();

  if (voucher.customerEmail) {
    try {
      await sendVoucherEmail({ voucher, recipientEmail: voucher.customerEmail, pdfBuffer: pdf });
      await prisma.voucher.update({ where: { id: voucher.id }, data: { emailSent: true, emailSentAt: now } });
      results.email = 'sent';
    } catch (err) {
      req.log.error({ err, voucherId: voucher.id }, 'Voice resend: email failed');
      results.email = 'failed';
    }
  }

  if (voucher.customerPhone) {
    try {
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendVoucherWhatsapp({ voucher, phone: voucher.customerPhone, mediaUrl });
      await prisma.voucher.update({ where: { id: voucher.id }, data: { whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl } });
      results.whatsapp = 'sent';
    } catch (err) {
      req.log.error({ err, voucherId: voucher.id }, 'Voice resend: WhatsApp failed');
      results.whatsapp = 'failed';
    }
  }

  if (results.email === 'sent' || results.whatsapp === 'sent') {
    try {
      await logLeadCommunication({
        leadId: voucher.leadId, type: 'message',
        notes: `Voucher ${voucher.voucherNumber} resent by voice agent (email: ${results.email ?? 'n/a'}, WhatsApp: ${results.whatsapp ?? 'n/a'})`,
      });
    } catch (err) {
      req.log.error({ err, leadId: voucher.leadId }, 'Failed to log voice resend on lead timeline');
    }
  }

  res.json({ success: true, data: results });
});

export const markVoucherViewed = asyncHandler(async (req, res) => {
  const voucher = await prisma.voucher.update({ where: { id: req.params.id }, data: { status: 'viewed', viewedAt: new Date() } });
  res.json({ success: true, data: voucher });
});

export const confirmVoucher = asyncHandler(async (req, res) => {
  const voucher = await prisma.voucher.update({ where: { id: req.params.id }, data: { status: 'confirmed', confirmedAt: new Date() } });
  res.json({ success: true, data: voucher });
});

export const downloadVoucherPDF = asyncHandler(async (req, res) => {
  const voucher = await prisma.voucher.findUnique({ where: { id: req.params.id }, include: voucherInclude });
  if (!voucher) throw new AppError('Voucher not found', 404);

  const pdf = await generateVoucherPDF(voucher);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="voucher-${voucher.voucherNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

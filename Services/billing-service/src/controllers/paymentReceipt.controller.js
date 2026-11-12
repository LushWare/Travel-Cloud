import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { assertPlanFeature } from '../services/plan.service.js';
import logger from '../config/logger.js';
import { nextReceiptNumber, nextPaymentHistoryNumber } from '../utils/docNumber.js';
import { emitLeadEvent, logLeadCommunication } from '../services/events.client.js';
import { generatePaymentReceiptPDF } from '../utils/paymentReceiptPDFGenerator.js';
import { sendReceiptEmail } from '../utils/emailService.js';
import { sendReceiptWhatsapp } from '../utils/whatsappService.js';
import { uploadPdfBuffer } from '../utils/cloudinary.js';
import { sendReceiptSchema, createReceiptSchema } from '../validators/paymentReceipt.validator.js';

const receiptInclude = { paymentHistories: true };
const receiptWithInvoiceInclude = { paymentHistories: true, invoice: true };

export const getAllPaymentReceipts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const where = { ...(status && { receiptStatus: status }) };
  const [data, total] = await Promise.all([
    prisma.paymentReceipt.findMany({ where, include: receiptInclude, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
    prisma.paymentReceipt.count({ where }),
  ]);
  res.json({ success: true, count: data.length, total, data });
});

export const getPaymentReceiptById = asyncHandler(async (req, res) => {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
  if (!receipt) throw new AppError('Payment receipt not found', 404);
  res.json({ success: true, data: receipt });
});

export const getPaymentReceiptsByLeadId = asyncHandler(async (req, res) => {
  const data = await prisma.paymentReceipt.findMany({
    where: { leadId: req.params.leadId },
    include: receiptInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

export const getPaymentReceiptsByInvoiceId = asyncHandler(async (req, res) => {
  const data = await prisma.paymentReceipt.findMany({
    where: { invoiceId: req.params.invoiceId },
    include: receiptInclude,
    orderBy: { paymentDate: 'desc' },
  });
  res.json({ success: true, data });
});

export const createPaymentReceipt = asyncHandler(async (req, res) => {
  const body = createReceiptSchema.parse(req.body || {});

  const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId } });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'draft') {
    throw new AppError('Cannot record a payment against a draft invoice — send it to the customer first.', 400);
  }
  if (invoice.status === 'cancelled') {
    throw new AppError('Cannot record a payment against a cancelled invoice.', 400);
  }
  if (body.amount > invoice.outstandingAmount) {
    throw new AppError(`Payment amount cannot exceed the outstanding balance of ${invoice.outstandingAmount}.`, 400);
  }

  const receiptNumber = await nextReceiptNumber();
  const paymentHistoryNumber = await nextPaymentHistoryNumber();
  const previousBalance = invoice.outstandingAmount;
  const outstandingBalance = Math.max(0, previousBalance - body.amount);

  const leadId = body.leadId || invoice.leadId;
  const customerName = body.customerName || invoice.customerName;
  const customerEmail = body.customerEmail || invoice.customerEmail;
  const customerPhone = body.customerPhone || invoice.customerPhone;
  const customerAddress = body.customerAddress || invoice.customerAddress;
  const paymentDate = body.paymentDate || new Date();
  const pd = body.paymentDetails || {};

  // Receipt creation (with its nested PaymentHistory row) and the invoice's
  // paid/outstanding/status update must succeed or fail together — this is
  // money bookkeeping, and a partial write here would desync the books.
  const receipt = await prisma.$transaction(async (tx) => {
    const created = await tx.paymentReceipt.create({
      data: {
        receiptNumber,
        leadId,
        invoiceId: body.invoiceId,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        amount: body.amount,
        currency: body.currency || 'LKR',
        paymentMethod: body.paymentMethod,
        paymentDate,
        transactionId: body.transactionId,
        paymentType: body.paymentType,
        notes: body.notes,
        previousBalance,
        outstandingBalance,
        createdById: req.user.id,
        cardType: pd.cardType,
        cardLastFour: pd.cardLastFour,
        bankName: pd.bankName,
        bankAccountNumber: pd.accountNumber,
        bankTransactionRef: pd.transactionReference,
        chequeNumber: pd.chequeNumber,
        chequeDate: pd.chequeDate,
        chequeBank: pd.chequeBank,
        paymentGateway: pd.paymentGateway,
        gatewayTransactionId: pd.gatewayTransactionId,
        upiId: pd.upiId,
        upiTransactionId: pd.upiTransactionId,
        paymentHistories: {
          create: {
            paymentHistoryNumber,
            leadId,
            invoiceId: body.invoiceId,
            customerName,
            customerEmail,
            customerPhone,
            amount: body.amount,
            currency: body.currency || 'LKR',
            paymentMethod: body.paymentMethod,
            paymentDate,
            transactionId: body.transactionId,
            paymentType: body.paymentType,
            notes: body.notes,
            createdById: req.user.id,
          },
        },
      },
      include: receiptInclude,
    });

    const newPaid = invoice.paidAmount + body.amount;
    const newOutstanding = Math.max(0, invoice.totalAmount - newPaid);
    const paymentStatus = newOutstanding <= 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
    await tx.invoice.update({
      where: { id: body.invoiceId },
      data: { paidAmount: newPaid, outstandingAmount: newOutstanding, paymentStatus },
    });

    return created;
  });

  res.status(201).json({ success: true, data: receipt });
});

export const updatePaymentReceipt = asyncHandler(async (req, res) => {
  const existing = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Payment receipt not found', 404);
  const {
    invoice: _inv, lead: _lead, paymentHistories: _hist,
    createdBy: _cb, cancelledBy: _cancel, verifiedBy: _ver, reconciledBy: _rec,
    ...body
  } = req.body;
  const receipt = await prisma.paymentReceipt.update({
    where: { id: req.params.id },
    data: { ...body, lastModifiedById: req.user.id },
    include: receiptInclude,
  });
  res.json({ success: true, data: receipt });
});

export const cancelPaymentReceipt = asyncHandler(async (req, res) => {
  const existing = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Payment receipt not found', 404);
  if (existing.receiptStatus === 'cancelled') throw new AppError('Already cancelled', 400);

  const receipt = await prisma.paymentReceipt.update({
    where: { id: req.params.id },
    data: { receiptStatus: 'cancelled', cancelledAt: new Date(), cancellationReason: req.body.reason, cancelledById: req.user.id },
    include: receiptInclude,
  });
  res.json({ success: true, data: receipt });
});

export const verifyPaymentReceipt = asyncHandler(async (req, res) => {
  const receipt = await prisma.paymentReceipt.update({
    where: { id: req.params.id },
    data: { verified: true, verifiedAt: new Date(), verifiedById: req.user.id },
    include: receiptInclude,
  });
  try {
    await emitLeadEvent({
      type: 'payment.verified',
      leadId: receipt.leadId,
      payload: { paymentId: receipt.id, amount: receipt.amount, invoiceId: receipt.invoiceId || null },
    });
  } catch (err) {
    req.log.error({ err, leadId: receipt.leadId }, 'Failed to notify lead-service of verified payment');
  }
  res.json({ success: true, data: receipt });
});

export const reconcilePaymentReceipt = asyncHandler(async (req, res) => {
  const receipt = await prisma.paymentReceipt.update({
    where: { id: req.params.id },
    data: { reconciled: true, reconciledAt: new Date(), reconciledById: req.user.id },
    include: receiptInclude,
  });
  res.json({ success: true, data: receipt });
});

export const sendPaymentReceipt = asyncHandler(async (req, res) => {
  const { channel, email, phone } = sendReceiptSchema.parse(req.body || {});

  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id }, include: receiptWithInvoiceInclude });
  if (!receipt) throw new AppError('Payment receipt not found', 404);

  const pdf = await generatePaymentReceiptPDF(receipt);
  const now = new Date();

  try {
    if (channel === 'whatsapp') {
      await assertPlanFeature('whatsapp'); // before the PDF is uploaded anywhere
      const recipient = phone || receipt.customerPhone;
      if (!recipient) throw new AppError('No phone number available for this receipt', 400);
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendReceiptWhatsapp({ receipt, phone: recipient, mediaUrl });
      const updated = await prisma.paymentReceipt.update({
        where: { id: receipt.id },
        data: { sentAt: now, whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl },
      });
      try {
        await logLeadCommunication({
          leadId: receipt.leadId, type: 'whatsapp', notes: `WhatsApp: Payment receipt ${receipt.receiptNumber} sent`,
        });
      } catch (err) {
        req.log.error({ err, leadId: receipt.leadId }, 'Failed to log WhatsApp send on lead timeline');
      }
      return res.json({ success: true, message: 'Payment receipt sent via WhatsApp', data: updated });
    }

    const recipient = email || receipt.customerEmail;
    if (!recipient) throw new AppError('No email address available for this receipt', 400);
    await sendReceiptEmail({ receipt, recipientEmail: recipient, pdfBuffer: pdf });
    const updated = await prisma.paymentReceipt.update({
      where: { id: receipt.id },
      data: { sentAt: now, emailSent: true },
    });
    return res.json({ success: true, message: 'Payment receipt sent via email', data: updated });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Configuration / delivery failures surface as a clean 400, not a 500. The
    // transport's own message is logged here and never echoed to the client.
    logger.error({ err }, 'Failed to send payment receipt');
    throw new AppError("We couldn't send that receipt. Please try again.", 400);
  }
});

// ─── POST /:id/resend-voice ─────────────────────────────────────
export const resendPaymentReceiptForVoice = asyncHandler(async (req, res) => {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id }, include: receiptWithInvoiceInclude });
  if (!receipt) throw new AppError('Payment receipt not found', 404);
  if (!receipt.sentAt) throw new AppError('This receipt has not been sent yet — a specialist needs to send it the first time', 409);

  const results = { email: null, whatsapp: null };
  const pdf = await generatePaymentReceiptPDF(receipt);
  const now = new Date();

  if (receipt.customerEmail) {
    try {
      await sendReceiptEmail({ receipt, recipientEmail: receipt.customerEmail, pdfBuffer: pdf });
      await prisma.paymentReceipt.update({ where: { id: receipt.id }, data: { emailSent: true } });
      results.email = 'sent';
    } catch (err) {
      req.log.error({ err, receiptId: receipt.id }, 'Voice resend: email failed');
      results.email = 'failed';
    }
  }

  if (receipt.customerPhone) {
    try {
      const mediaUrl = await uploadPdfBuffer(pdf);
      await sendReceiptWhatsapp({ receipt, phone: receipt.customerPhone, mediaUrl });
      await prisma.paymentReceipt.update({ where: { id: receipt.id }, data: { whatsappSent: true, whatsappSentAt: now, pdfUrl: mediaUrl } });
      results.whatsapp = 'sent';
    } catch (err) {
      req.log.error({ err, receiptId: receipt.id }, 'Voice resend: WhatsApp failed');
      results.whatsapp = 'failed';
    }
  }

  if (results.email === 'sent' || results.whatsapp === 'sent') {
    try {
      await logLeadCommunication({
        leadId: receipt.leadId, type: 'message',
        notes: `Payment receipt ${receipt.receiptNumber} resent by voice agent (email: ${results.email ?? 'n/a'}, WhatsApp: ${results.whatsapp ?? 'n/a'})`,
      });
    } catch (err) {
      req.log.error({ err, leadId: receipt.leadId }, 'Failed to log voice resend on lead timeline');
    }
  }

  res.json({ success: true, data: results });
});

export const getPaymentReceiptStats = asyncHandler(async (req, res) => {
  const [total, verified, reconciled] = await Promise.all([
    prisma.paymentReceipt.count({ where: { receiptStatus: { not: 'cancelled' } } }),
    prisma.paymentReceipt.count({ where: { verified: true } }),
    prisma.paymentReceipt.count({ where: { reconciled: true } }),
  ]);
  const totalCollected = await prisma.paymentReceipt.aggregate({
    _sum: { amount: true },
    where: { receiptStatus: { not: 'cancelled' } },
  });
  res.json({ success: true, data: { total, verified, reconciled, totalCollected: totalCollected._sum.amount || 0 } });
});

export const downloadPaymentReceiptPDF = asyncHandler(async (req, res) => {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: req.params.id }, include: receiptWithInvoiceInclude });
  if (!receipt) throw new AppError('Payment receipt not found', 404);

  const pdf = await generatePaymentReceiptPDF(receipt);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${receipt.receiptNumber}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
});

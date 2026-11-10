import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// Hand-written SQL is not filtered automatically: every statement names the agency itself.
const agency = () => requireTenantId();

// ─── GET /internal/leads/:leadId/latest-document ────────────────
const DOCUMENT_TYPES = [
  { type: 'quotation', model: 'quotation', numberField: 'quotationNumber' },
  { type: 'invoice', model: 'invoice', numberField: 'invoiceNumber' },
  { type: 'receipt', model: 'paymentReceipt', numberField: 'receiptNumber' },
  { type: 'voucher', model: 'voucher', numberField: 'voucherNumber' },
];

export const getLatestSentDocumentForVoice = asyncHandler(async (req, res) => {
  const { leadId } = req.params;

  const results = await Promise.all(DOCUMENT_TYPES.map(async ({ type, model, numberField }) => {
    const isVoucher = type === 'voucher';
    const where = isVoucher
      ? { leadId, OR: [{ emailSent: true }, { whatsappSent: true }] }
      : { leadId, sentAt: { not: null } };
    const orderBy = isVoucher ? { updatedAt: 'desc' } : { sentAt: 'desc' };
    const recencyField = isVoucher ? 'updatedAt' : 'sentAt';
    const doc = await prisma[model].findFirst({ where, orderBy, select: { id: true, [numberField]: true, [recencyField]: true } });
    return doc ? { type, id: doc.id, number: doc[numberField], sentAt: doc[recencyField] } : null;
  }));

  const found = results.filter(Boolean);
  // Most recently sent across all types, not just the first type that has one.
  found.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));

  res.json({ success: true, data: { latest: found[0] || null } });
});

export const getDashboardStats = asyncHandler(async (req, res) => {
  const [
    totalQuotations, pendingQuotations,
    totalInvoices, paidInvoices, overdueInvoices,
    revenueAgg, collectedAgg,
    pendingApprovals,
  ] = await Promise.all([
    prisma.quotation.count(),
    prisma.quotation.count({ where: { status: { in: ['sent', 'viewed'] } } }),
    prisma.invoice.count({ where: { status: { not: 'cancelled' } } }),
    prisma.invoice.count({ where: { paymentStatus: 'paid' } }),
    prisma.invoice.count({ where: { status: { in: ['sent', 'partial', 'overdue'] }, dueDate: { lt: new Date() } } }),
    prisma.invoice.aggregate({ _sum: { totalAmount: true }, where: { status: { not: 'cancelled' } } }),
    prisma.paymentReceipt.aggregate({ _sum: { amount: true }, where: { receiptStatus: { not: 'cancelled' } } }),
    prisma.creditNote.count({ where: { approvalRequired: true, approvedAt: null, status: { not: 'cancelled' } } }),
  ]);

  const recentPayments = await prisma.paymentReceipt.findMany({
    where: { receiptStatus: { not: 'cancelled' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  res.json({
    success: true,
    data: {
      totalQuotations, pendingQuotations,
      totalInvoices, paidInvoices, overdueInvoices,
      totalRevenue: revenueAgg._sum.totalAmount || 0,
      totalCollected: collectedAgg._sum.amount || 0,
      pendingApprovals,
      recentPayments,
    },
  });
});

export const getLeadBillingSummary = asyncHandler(async (req, res) => {
  const { leadId } = req.params;

  const [invoices, quotations, receipts, creditNotes, vouchers] = await Promise.all([
    prisma.invoice.findMany({ where: { leadId }, include: { items: true }, orderBy: { createdAt: 'desc' } }),
    prisma.quotation.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
    prisma.paymentReceipt.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
    prisma.creditNote.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
    prisma.voucher.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const totalInvoiced = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.totalAmount, 0);
  const totalPaid = receipts.filter((r) => r.receiptStatus !== 'cancelled').reduce((s, r) => s + r.amount, 0);
  const outstanding = Math.max(0, totalInvoiced - totalPaid);

  res.json({
    success: true,
    data: { invoices, quotations, receipts, creditNotes, vouchers, summary: { totalInvoiced, totalPaid, outstanding } },
  });
});

export const getFinancialReports = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) throw new AppError('Please provide startDate and endDate', 400);

  const dateRange = { gte: new Date(startDate), lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) };

  const [invoiceAgg, receiptAgg] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true }, where: { createdAt: dateRange, status: { not: 'cancelled' } } }),
    prisma.paymentReceipt.aggregate({ _sum: { amount: true }, where: { createdAt: dateRange, receiptStatus: { not: 'cancelled' } } }),
  ]);

  res.json({
    success: true,
    data: {
      period: { startDate, endDate },
      totalBilled: invoiceAgg._sum.totalAmount || 0,
      totalPaid: invoiceAgg._sum.paidAmount || 0,
      totalOutstanding: invoiceAgg._sum.outstandingAmount || 0,
      totalCollected: receiptAgg._sum.amount || 0,
    },
  });
});

export const getAgingReport = asyncHandler(async (req, res) => {
  const now = new Date();
  const buckets = [
    { label: 'current', where: { dueDate: { gte: now } } },
    { label: '1-30 days', where: { dueDate: { lt: now, gte: new Date(now - 30 * 86400000) } } },
    { label: '31-60 days', where: { dueDate: { lt: new Date(now - 30 * 86400000), gte: new Date(now - 60 * 86400000) } } },
    { label: '60+ days', where: { dueDate: { lt: new Date(now - 60 * 86400000) } } },
  ];

  const results = await Promise.all(
    buckets.map(async ({ label, where }) => {
      const agg = await prisma.invoice.aggregate({ _sum: { outstandingAmount: true }, where: { ...where, status: { in: ['sent', 'partial', 'overdue'] } } });
      return { label, amount: agg._sum.outstandingAmount || 0 };
    }),
  );

  res.json({ success: true, data: results });
});

export const getPaymentMethodBreakdown = asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT "paymentMethod"::text AS method, COUNT(*) AS count, SUM(amount) AS total
    FROM crm_billing."PaymentReceipt"
    WHERE "tenantId" = ${agency()}::uuid AND "receiptStatus" != 'cancelled'
    GROUP BY "paymentMethod"
  `;
  res.json({ success: true, data: rows });
});

export const getRevenueTrends = asyncHandler(async (req, res) => {
  const { months = 6 } = req.query;
  const rows = await prisma.$queryRaw`
    SELECT DATE_TRUNC('month', "createdAt") AS month,
           SUM("totalAmount") AS revenue,
           SUM("paidAmount") AS collected
    FROM crm_billing."Invoice"
    WHERE "tenantId" = ${agency()}::uuid AND status != 'cancelled'
      AND "createdAt" >= NOW() - (${Number(months)} || ' months')::INTERVAL
    GROUP BY month
    ORDER BY month ASC
  `;
  res.json({ success: true, data: rows });
});

export const getTopCustomers = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const rows = await prisma.$queryRaw`
    SELECT "customerName", "customerEmail",
           COUNT(*) AS "invoiceCount",
           SUM("totalAmount") AS "totalBilled",
           SUM("paidAmount") AS "totalPaid"
    FROM crm_billing."Invoice"
    WHERE "tenantId" = ${agency()}::uuid AND status != 'cancelled'
    GROUP BY "customerName", "customerEmail"
    ORDER BY "totalBilled" DESC
    LIMIT ${Number(limit)}
  `;
  // COUNT(*) comes back as a BigInt via $queryRaw — JSON.stringify can't
  // serialize that natively, so coerce it before responding.
  const data = rows.map((r) => ({ ...r, invoiceCount: Number(r.invoiceCount) }));
  res.json({ success: true, data });
});

export const exportBillingData = asyncHandler(async (req, res) => {
  const { startDate, endDate, type = 'invoices' } = req.query;
  const dateRange = startDate && endDate
    ? { gte: new Date(startDate), lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)) }
    : undefined;
  const where = dateRange ? { createdAt: dateRange } : {};

  let data;
  if (type === 'quotations') data = await prisma.quotation.findMany({ where, orderBy: { createdAt: 'desc' } });
  else if (type === 'receipts') data = await prisma.paymentReceipt.findMany({ where, orderBy: { createdAt: 'desc' } });
  else data = await prisma.invoice.findMany({ where, orderBy: { createdAt: 'desc' } });

  res.json({ success: true, count: data.length, data });
});

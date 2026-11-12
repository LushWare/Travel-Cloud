import { describe, it, expect, vi, beforeEach } from 'vitest';

// Admin-only actions on the agency's customer and financial records must leave an audit entry.

const { db, mockAudit } = vi.hoisted(() => ({
  db: {
    quotation: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    voucher: { findUnique: vi.fn(), delete: vi.fn() },
    invoice: { findMany: vi.fn() },
    paymentReceipt: { findMany: vi.fn() },
  },
  mockAudit: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ default: db }));
vi.mock('../../utils/audit.js', () => ({ audit: mockAudit }));
vi.mock('../../services/plan.service.js', () => ({ assertPlanFeature: vi.fn(), metered: vi.fn((_m, send) => send()) }));
vi.mock('../../utils/quotationPDFGenerator.js', () => ({ generateQuotationPDF: vi.fn() }));
vi.mock('../../utils/voucherPDFGenerator.js', () => ({ generateVoucherPDF: vi.fn() }));
vi.mock('../../utils/emailService.js', () => ({ sendQuotationEmail: vi.fn(), sendVoucherEmail: vi.fn() }));
vi.mock('../../utils/whatsappService.js', () => ({ sendQuotationWhatsapp: vi.fn(), sendVoucherWhatsapp: vi.fn() }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: vi.fn() }));
vi.mock('../../utils/docNumber.js', () => ({ nextInvoiceNumber: vi.fn(), nextQuotationNumber: vi.fn(), nextVoucherNumber: vi.fn() }));
vi.mock('../../services/events.client.js', () => ({ emitLeadEvent: vi.fn(), logLeadCommunication: vi.fn() }));
vi.mock('../../services/quotation.service.js', () => ({ createOrVersionQuotation: vi.fn(), quotationTotals: vi.fn() }));

import { deleteQuotation } from '../quotation.controller.js';
import { deleteVoucher } from '../voucher.controller.js';
import { exportBillingData } from '../billing.controller.js';

async function run(handler, req) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  let error;
  await handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => { error = err; });
  return { res, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.quotation.findUnique.mockResolvedValue({ id: 'q-1', quotationNumber: 'QT-202611-0007' });
  db.voucher.findUnique.mockResolvedValue({ id: 'v-1', voucherNumber: 'VOU-202611-00003' });
  db.invoice.findMany.mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }]);
  db.quotation.findMany.mockResolvedValue([]);
  db.paymentReceipt.findMany.mockResolvedValue([]);
});

describe('audited billing actions', () => {
  it('records deleting a quotation with its number', async () => {
    await run(deleteQuotation, { params: { id: 'q-1' } });

    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'billing.quotation_deleted', targetId: 'q-1', summary: 'Deleted quotation QT-202611-0007',
    }));
  });

  it('records nothing when the quotation to delete does not exist', async () => {
    db.quotation.findUnique.mockResolvedValue(null);

    const { error } = await run(deleteQuotation, { params: { id: 'missing' } });

    expect(error.statusCode).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('records deleting a voucher with its number', async () => {
    await run(deleteVoucher, { params: { id: 'v-1' } });

    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'billing.voucher_deleted', targetId: 'v-1', summary: 'Deleted voucher VOU-202611-00003',
    }));
  });

  it('records an export with its type, date range and row count', async () => {
    await run(exportBillingData, { query: { type: 'invoices', startDate: '2026-11-01', endDate: '2026-11-30' } });

    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'billing.exported',
      summary: 'Exported 2 invoices from 2026-11-01 to 2026-11-30',
      details: { type: 'invoices', startDate: '2026-11-01', endDate: '2026-11-30', count: 2 },
    }));
  });

  it('records an export of all dates as such', async () => {
    await run(exportBillingData, { query: {} });

    expect(mockAudit.mock.calls[0][1].summary).toBe('Exported 2 invoices (all dates)');
  });

  it.each([
    [{ type: 'payroll' }],
    [{ startDate: 'yesterday' }],
    [{ endDate: '2026-02-31x' }],
  ])('refuses export options %j with 400 and exports nothing', async (query) => {
    const { error } = await run(exportBillingData, { query });

    expect(error.statusCode).toBe(400);
    expect(db.invoice.findMany).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

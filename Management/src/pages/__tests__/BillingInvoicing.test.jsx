import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockQuotationGetAll, mockQuotationDownloadPDF, mockQuotationSend,
  mockInvoiceGetAll, mockReceiptGetAll, mockVoucherGetAll, mockPaymentHistoryGetAll,
  router,
} = vi.hoisted(() => ({
  mockQuotationGetAll: vi.fn(),
  mockQuotationDownloadPDF: vi.fn(),
  mockQuotationSend: vi.fn(),
  mockInvoiceGetAll: vi.fn(),
  mockReceiptGetAll: vi.fn(),
  mockVoucherGetAll: vi.fn(),
  mockPaymentHistoryGetAll: vi.fn(),
  router: { params: new URLSearchParams(), setParams: vi.fn() },
}));

vi.mock('../../services/api.js', () => ({
  quotationAPI: { getAll: mockQuotationGetAll, downloadPDF: mockQuotationDownloadPDF, send: mockQuotationSend },
  invoiceAPI: { getAll: mockInvoiceGetAll },
  receiptAPI: { getAll: mockReceiptGetAll },
  voucherAPI: { getAll: mockVoucherGetAll },
  paymentHistoryAPI: { getAll: mockPaymentHistoryGetAll },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [router.params, router.setParams],
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from '@/lib/toast';
import BillingInvoicing from '../BillingInvoicing';

const quotation = {
  id: 'quote-1',
  quotationNumber: 'QT-1001',
  status: 'draft',
  totalAmount: 1200,
  customer: { name: 'Alice Traveller', email: 'alice@test.com' },
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  router.params = new URLSearchParams();
  router.setParams.mockReset();
  mockQuotationGetAll.mockResolvedValue({ success: true, data: [quotation] });
  mockInvoiceGetAll.mockResolvedValue({ success: true, data: [] });
  mockReceiptGetAll.mockResolvedValue({ success: true, data: [] });
  mockVoucherGetAll.mockResolvedValue({ success: true, data: [] });
  mockPaymentHistoryGetAll.mockResolvedValue({ success: true, data: [] });
  mockQuotationDownloadPDF.mockResolvedValue(undefined);
  mockQuotationSend.mockResolvedValue({ success: true });
});

describe('BillingInvoicing quotations tab', () => {
  it('fetches quotations with the expected params and renders a fetched quotation number', async () => {
    render(<BillingInvoicing />);

    await waitFor(() => expect(mockQuotationGetAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, page: 1 })));
    expect(await screen.findByText('QT-1001')).toBeInTheDocument();
  });

  it('downloads the quotation PDF and shows a success toast', async () => {
    render(<BillingInvoicing />);
    await screen.findByText('QT-1001');

    await userEvent.click(screen.getByTitle('Download PDF'));

    await waitFor(() => expect(mockQuotationDownloadPDF).toHaveBeenCalledWith('quote-1'));
    expect(toast.success).toHaveBeenCalledWith('Quotation PDF downloaded');
  });

  it('shows an error toast when the quotation PDF download fails', async () => {
    mockQuotationDownloadPDF.mockRejectedValue(new Error('network error'));
    render(<BillingInvoicing />);
    await screen.findByText('QT-1001');

    await userEvent.click(screen.getByTitle('Download PDF'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to download quotation PDF'));
    expect(screen.getByText('QT-1001')).toBeInTheDocument();
  });

  it('sends the quotation and shows a success toast', async () => {
    render(<BillingInvoicing />);
    await screen.findByText('QT-1001');

    await userEvent.click(screen.getByTitle('Send Email'));

    await waitFor(() => expect(mockQuotationSend).toHaveBeenCalledWith('quote-1'));
    expect(toast.success).toHaveBeenCalledWith('Quotation sent successfully');
  });

  it('shows an error toast when sending the quotation fails', async () => {
    mockQuotationSend.mockRejectedValue(new Error('network error'));
    render(<BillingInvoicing />);
    await screen.findByText('QT-1001');

    await userEvent.click(screen.getByTitle('Send Email'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to send quotation'));
    expect(screen.getByText('QT-1001')).toBeInTheDocument();
  });
});

describe('BillingInvoicing notification deep links', () => {
  it('activates the requested document tab and forwards its id set', async () => {
    router.params = new URLSearchParams('tab=invoice&ids=invoice-1%2Cinvoice-2');

    render(<BillingInvoicing />);

    await waitFor(() => expect(mockInvoiceGetAll).toHaveBeenCalledWith(expect.objectContaining({
      ids: 'invoice-1,invoice-2',
      limit: 100,
      page: 1,
    })));
    expect(screen.getAllByText('Invoices').length).toBeGreaterThan(0);
    expect(screen.getByText(/Active filter: linked invoices/)).toBeInTheDocument();
  });
});

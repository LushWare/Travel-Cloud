import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockInvoiceGetByLead,
  mockCreatePaymentLink,
  mockGetOrganizationBranding,
  mockToastSuccess,
  mockToastError,
  mockClipboardWrite,
} = vi.hoisted(() => ({
  mockInvoiceGetByLead: vi.fn(),
  mockCreatePaymentLink: vi.fn(),
  mockGetOrganizationBranding: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockClipboardWrite: vi.fn(),
}));

vi.mock('../../../../services/api', () => ({
  invoiceAPI: {
    getByLead: mockInvoiceGetByLead,
    createPaymentLink: mockCreatePaymentLink,
    send: vi.fn(),
    update: vi.fn(),
  },
  quotationAPI: { getByLead: vi.fn().mockResolvedValue({ data: [] }) },
  adminAPI: { getOrganizationBranding: mockGetOrganizationBranding },
}));

vi.mock('@/components/shared/PdfPreview', () => ({ default: () => null }));
vi.mock('@/lib/toast', () => ({
  default: { success: mockToastSuccess, error: mockToastError },
}));

import InvoiceDialog from '../InvoiceDialog';

const invoice = {
  id: 'invoice-1',
  status: 'sent',
  invoiceNumber: 'INV-001',
  customerName: 'Alice',
  customerEmail: 'alice@example.test',
  customerPhone: '',
  customerAddress: '',
  customerGstNumber: '',
  destination: '',
  currency: 'USD',
  totalAmount: 1200,
  subtotal: 1200,
  outstandingAmount: 1200,
  paidAmount: 0,
  items: [],
  paymentTerms: '',
  paymentInstructions: '',
  notes: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoiceGetByLead.mockResolvedValue({ data: [invoice] });
  mockCreatePaymentLink.mockResolvedValue({
    data: { url: 'https://client.example.test/pay/invoice/secret-token' },
  });
  mockGetOrganizationBranding.mockResolvedValue({ data: { branding: {} } });
  mockClipboardWrite.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockClipboardWrite },
  });
});

describe('InvoiceDialog Stripe payment link', () => {
  it('creates and copies a payment link for an outstanding invoice', async () => {
    render(
      <InvoiceDialog
        isOpen
        onClose={vi.fn()}
        lead={{ id: 'lead-1', name: 'Alice', email: 'alice@example.test' }}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Create Stripe payment link' }));

    await waitFor(() => {
      expect(mockCreatePaymentLink).toHaveBeenCalledWith('invoice-1');
      expect(mockClipboardWrite).toHaveBeenCalledWith('https://client.example.test/pay/invoice/secret-token');
    });
    expect(screen.getByRole('textbox', { name: 'Stripe payment link' })).toHaveValue(
      'https://client.example.test/pay/invoice/secret-token',
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Stripe payment link copied');
  });
});

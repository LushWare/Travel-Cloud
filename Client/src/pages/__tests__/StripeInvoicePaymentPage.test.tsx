import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StripeInvoicePaymentPage from '../StripeInvoicePaymentPage';

const { mockGetPaymentLink, mockCreateCheckout } = vi.hoisted(() => ({
  mockGetPaymentLink: vi.fn(),
  mockCreateCheckout: vi.fn(),
}));

vi.mock('../../services/api/stripePayments', () => ({
  getStripePaymentLink: mockGetPaymentLink,
  createStripeCheckout: mockCreateCheckout,
  getStripeCheckoutStatus: vi.fn(),
}));

const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
const paymentLink = {
  status: 'payable' as const,
  invoiceNumber: 'INV-001',
  currency: 'USD',
  outstandingMinor: 12500,
};

function renderPaymentPage() {
  return render(
    <MemoryRouter initialEntries={['/pay/invoice/test-token']}>
      <Routes>
        <Route path="/pay/invoice/:token" element={<StripeInvoicePaymentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPaymentLink.mockResolvedValue(paymentLink);
  mockCreateCheckout.mockResolvedValue('https://checkout.stripe.com/c/pay/cs_test_123');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: vi.fn() },
  });
});

afterEach(() => {
  if (locationDescriptor) Object.defineProperty(window, 'location', locationDescriptor);
});

describe('StripeInvoicePaymentPage', () => {
  it('sends the customer-selected partial amount to Stripe Checkout', async () => {
    renderPaymentPage();

    const amount = await screen.findByLabelText('Amount to pay (USD)');
    fireEvent.change(amount, { target: { value: '25.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));

    await waitFor(() => {
      expect(mockCreateCheckout).toHaveBeenCalledWith('test-token', 2550);
    });
    expect(window.location.assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123');
  });

  it('prevents a payment greater than the live invoice balance', async () => {
    renderPaymentPage();

    const amount = await screen.findByLabelText('Amount to pay (USD)');
    fireEvent.change(amount, { target: { value: '125.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Stripe' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount between $0.50 and $125.00.');
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });
});

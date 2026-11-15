import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgencyBillingSettings from '../AgencyBillingSettings';

const {
  mockGetStatus,
  mockGetPlans,
  mockStartCheckout,
  mockOpenPortal,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockGetPlans: vi.fn(),
  mockStartCheckout: vi.fn(),
  mockOpenPortal: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { isSuperAdmin: true } }),
}));

vi.mock('@/services/api', () => ({
  billingAPI: {
    getStatus: mockGetStatus,
    getPlans: mockGetPlans,
    startCheckout: mockStartCheckout,
    openPortal: mockOpenPortal,
    changePlan: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({
  default: { error: mockToastError, success: vi.fn() },
}));

const plan = {
  key: 'growth',
  planVersionId: '00000000-0000-4000-8000-000000000003',
  name: 'Growth',
  priceMinorUnits: 14900,
  currency: 'USD',
  billingInterval: 'monthly' as const,
};

const status = {
  status: 'trial',
  trialEndsAt: null,
  pastDueAt: null,
  subscriptionCurrentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  postTrialPlanVersionId: null,
  currentPlanVersionId: null,
  hasSubscription: false,
  planName: null,
};

beforeEach(() => {
  mockGetStatus.mockResolvedValue({ data: status });
  mockGetPlans.mockResolvedValue({ data: [plan] });
  mockStartCheckout.mockResolvedValue({ data: { url: 'https://checkout.stripe.com/c/pay/session' } });
  mockOpenPortal.mockResolvedValue({ data: { url: 'https://billing.stripe.com/p/session' } });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('AgencyBillingSettings', () => {
  it('opens subscription checkout in a new tab', async () => {
    const checkoutTab = {
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(checkoutTab);

    render(<AgencyBillingSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to secure checkout' }));

    await waitFor(() => expect(mockStartCheckout).toHaveBeenCalledWith(plan.planVersionId));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(checkoutTab.opener).toBeNull();
    expect(checkoutTab.location.replace).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/session',
    );
  });

  it('does not request checkout when the browser blocks the new tab', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(<AgencyBillingSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to secure checkout' }));

    expect(mockStartCheckout).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      'Allow pop-ups to open Stripe billing in a new tab, then try again.',
    );
  });

  it('opens the Stripe billing portal in a new tab', async () => {
    mockGetStatus.mockResolvedValue({ data: { ...status, hasSubscription: true } });
    const billingTab = {
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(billingTab);

    render(<AgencyBillingSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Payment methods & invoices' }));

    await waitFor(() => expect(mockOpenPortal).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(billingTab.opener).toBeNull();
    expect(billingTab.location.replace).toHaveBeenCalledWith('https://billing.stripe.com/p/session');
  });
});
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StripeIntegrationSettings from '../StripeIntegrationSettings';

const {
  mockGetStripe,
  mockStartStripeConnect,
  mockTestStripe,
  mockDisconnectStripe,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetStripe: vi.fn(),
  mockStartStripeConnect: vi.fn(),
  mockTestStripe: vi.fn(),
  mockDisconnectStripe: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  integrationAPI: {
    getStripe: mockGetStripe,
    startStripeConnect: mockStartStripeConnect,
    testStripe: mockTestStripe,
    disconnectStripe: mockDisconnectStripe,
  },
}));

vi.mock('@/lib/toast', () => ({
  default: { success: mockToastSuccess, error: mockToastError },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/settings?tab=integrations');
});

const disconnected = {
  connected: false,
  status: 'disconnected',
  configured: true,
  account: null,
  lastTestedAt: null,
  lastError: null,
};

describe('StripeIntegrationSettings', () => {
  it('explains when Lushware has not configured Stripe Connect', async () => {
    mockGetStripe.mockResolvedValue({ data: { ...disconnected, configured: false } });

    render(<StripeIntegrationSettings />);

    expect(await screen.findByText(/has not been configured by Lushware/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Setup required' })).toBeDisabled();
  });

  it('opens the Stripe authorization URL for the agency admin', async () => {
    mockGetStripe.mockResolvedValue({ data: disconnected });
    mockStartStripeConnect.mockResolvedValue({
      data: { authorizationUrl: 'https://connect.stripe.com/oauth/authorize?state=signed' },
    });
    const authTab = {
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(authTab);

    render(<StripeIntegrationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Stripe' }));

    await waitFor(() => expect(mockStartStripeConnect).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(authTab.opener).toBeNull();
    expect(authTab.location.replace).toHaveBeenCalledWith(
      'https://connect.stripe.com/oauth/authorize?state=signed',
    );
  });

  it('does not request a Stripe link when the browser blocks the new tab', async () => {
    mockGetStripe.mockResolvedValue({ data: disconnected });
    vi.spyOn(window, 'open').mockReturnValue(null);

    render(<StripeIntegrationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Stripe' }));

    expect(mockStartStripeConnect).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Allow pop-ups to connect Stripe, then try again.');
  });

  it('tests and disconnects the connected agency account', async () => {
    const connected = {
      ...disconnected,
      connected: true,
      status: 'connected',
      account: {
        accountId: 'acct_123',
        businessName: 'Agency A',
        country: 'US',
        chargesEnabled: true,
        payoutsEnabled: true,
        livemode: true,
      },
    };
    mockGetStripe.mockResolvedValue({ data: connected });
    mockTestStripe.mockResolvedValue({ data: connected });
    mockDisconnectStripe.mockResolvedValue({ data: disconnected });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<StripeIntegrationSettings />);
    expect(await screen.findByText('Agency A · US')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(mockTestStripe).toHaveBeenCalledOnce());
    expect(mockToastSuccess).toHaveBeenCalledWith('Stripe connection verified');

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(mockDisconnectStripe).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Connect Stripe' })).toBeInTheDocument();
  });
});

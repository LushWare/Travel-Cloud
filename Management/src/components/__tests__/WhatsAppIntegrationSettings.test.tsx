import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WhatsAppIntegrationSettings from '../WhatsAppIntegrationSettings';

const {
  mockGetWhatsapp,
  mockConnectWhatsapp,
  mockDisconnectWhatsapp,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetWhatsapp: vi.fn(),
  mockConnectWhatsapp: vi.fn(),
  mockDisconnectWhatsapp: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  integrationAPI: {
    getWhatsapp: mockGetWhatsapp,
    connectWhatsapp: mockConnectWhatsapp,
    disconnectWhatsapp: mockDisconnectWhatsapp,
  },
}));

vi.mock('@/lib/toast', () => ({
  default: { success: mockToastSuccess, error: mockToastError },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete window.FB;
});

const disconnected = {
  connected: false,
  status: 'disconnected',
  displayPhoneNumber: null,
  verifiedName: null,
  lastTestedAt: null,
  lastError: null,
  appId: 'meta-app-id',
  configurationId: 'signup-config-id',
  graphApiVersion: 'v27.0',
};

describe('WhatsAppIntegrationSettings', () => {
  it('explains that Lushware setup is required when Meta configuration is missing', async () => {
    mockGetWhatsapp.mockResolvedValue({
      data: { ...disconnected, appId: null, configurationId: null },
    });

    render(<WhatsAppIntegrationSettings />);

    expect(await screen.findByText(/administrator must add the Meta App ID/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Setup required' })).toBeDisabled();
  });

  it('offers a retry when the Meta SDK fails to load', async () => {
    mockGetWhatsapp.mockResolvedValue({ data: disconnected });
    const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });

    render(<WhatsAppIntegrationSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't download Meta's signup SDK/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Meta' }));

    await waitFor(() => expect(appendChild).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Retry Meta' })).toBeEnabled();
  });

  it('can retry when the SDK script loads without initializing the Meta API', async () => {
    mockGetWhatsapp.mockResolvedValue({ data: disconnected });
    const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => node);

    render(<WhatsAppIntegrationSettings />);

    await screen.findByRole('button', { name: 'Loading Meta…' });
    const failedInitialization = window.fbAsyncInit;
    failedInitialization?.();
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to initialize/);

    fireEvent.click(screen.getByRole('button', { name: 'Retry Meta' }));
    await waitFor(() => expect(appendChild).toHaveBeenCalledTimes(2));
    window.FB = { init: vi.fn(), login: vi.fn() };
    window.fbAsyncInit?.();

    expect(await screen.findByRole('button', { name: 'Connect WhatsApp' })).toBeDisabled();
  });

  it('exchanges Embedded Signup v4 details through the agency integration API', async () => {
    mockGetWhatsapp.mockResolvedValue({ data: disconnected });
    mockConnectWhatsapp.mockResolvedValue({
      data: { ...disconnected, connected: true, status: 'connected', displayPhoneNumber: '+1 555 123 4567' },
    });
    window.FB = {
      init: vi.fn(),
      login: vi.fn((callback) => {
        window.dispatchEvent(new MessageEvent('message', {
          origin: 'https://www.facebook.com',
          data: JSON.stringify({
            type: 'WA_EMBEDDED_SIGNUP',
            event: 'FINISH',
            data: { waba_id: '987654321', phone_number_id: '123456789' },
          }),
        }));
        callback({ authResponse: { code: 'short-lived-code' } });
      }),
    };

    render(<WhatsAppIntegrationSettings />);
    fireEvent.change(await screen.findByLabelText('Meta two-step verification PIN'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WhatsApp' }));

    await waitFor(() => expect(mockConnectWhatsapp).toHaveBeenCalledWith({
      code: 'short-lived-code',
      wabaId: '987654321',
      phoneNumberId: '123456789',
      pin: '123456',
    }));
    expect(window.FB.init).toHaveBeenCalledWith({
      appId: 'meta-app-id',
      autoLogAppEvents: true,
      xfbml: false,
      version: 'v27.0',
    });
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WhatsApp Manager' })).toHaveAttribute(
      'href',
      'https://business.facebook.com/wa/manage/home/',
    );
  });

  it('disconnects the agency number and clears connected status', async () => {
    mockGetWhatsapp.mockResolvedValue({
      data: { ...disconnected, connected: true, status: 'connected', displayPhoneNumber: '+1 555 123 4567' },
    });
    mockDisconnectWhatsapp.mockResolvedValue({ data: disconnected });
    window.FB = { init: vi.fn(), login: vi.fn() };
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<WhatsAppIntegrationSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(mockDisconnectWhatsapp).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Connect WhatsApp' })).toBeDisabled();
  });
});
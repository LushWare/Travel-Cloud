import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FacebookLeadAdsIntegrationSettings from '../FacebookLeadAdsIntegrationSettings';

const {
  mockGetFacebook,
  mockStartFacebookConnect,
  mockSaveFacebookPages,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockGetFacebook: vi.fn(),
  mockStartFacebookConnect: vi.fn(),
  mockSaveFacebookPages: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  integrationAPI: {
    getFacebook: mockGetFacebook,
    startFacebookConnect: mockStartFacebookConnect,
    saveFacebookPages: mockSaveFacebookPages,
    disconnectFacebook: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({
  default: { success: mockToastSuccess, error: mockToastError },
}));

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/settings?tab=integrations');
});

describe('FacebookLeadAdsIntegrationSettings', () => {
  it('opens Facebook authorization in a new tab and keeps Management open', async () => {
    mockGetFacebook.mockResolvedValue({
      data: { connected: false, status: 'disconnected', webhookUrl: '', pages: [] },
    });
    const authorizationUrl = 'https://www.facebook.com/v27.0/dialog/oauth?state=state';
    mockStartFacebookConnect.mockResolvedValue({ data: { authorizationUrl } });
    const popup = {
      opener: window,
      location: { replace: vi.fn() },
      close: vi.fn(),
    } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);

    render(<FacebookLeadAdsIntegrationSettings />);
    const managementUrl = window.location.href;
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Facebook' }));

    await waitFor(() => expect(popup.location.replace).toHaveBeenCalledWith(authorizationUrl));
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(window.location.href).toBe(managementUrl);
  });

  it('saves only the agency-selected Facebook pages', async () => {
    mockGetFacebook.mockResolvedValue({
      data: {
        connected: false,
        status: 'pending',
        webhookUrl: 'https://api.example.test/api/v1/webhooks/facebook',
        pages: [
          { id: '123', name: 'Agency Page', selected: false },
          { id: '456', name: 'Personal Page', selected: false },
        ],
      },
    });
    mockSaveFacebookPages.mockResolvedValue({
      data: {
        connected: true,
        status: 'connected',
        webhookUrl: 'https://api.example.test/api/v1/webhooks/facebook',
        pages: [{ id: '123', name: 'Agency Page', selected: true }],
      },
    });

    render(<FacebookLeadAdsIntegrationSettings />);

    const agencyPage = await screen.findByRole('checkbox', { name: /Agency Page/ });
    fireEvent.click(agencyPage);
    fireEvent.click(screen.getByRole('button', { name: 'Save selected pages' }));

    await waitFor(() => expect(mockSaveFacebookPages).toHaveBeenCalledWith(['123']));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith('Facebook Lead Ads pages connected');
  });
});

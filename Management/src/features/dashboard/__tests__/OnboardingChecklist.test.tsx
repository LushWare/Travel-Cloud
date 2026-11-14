import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { adminAPI, integrationAPI, packageAPI } = vi.hoisted(() => ({
  adminAPI: { getSettings: vi.fn(), getUsers: vi.fn() },
  integrationAPI: { getEmail: vi.fn() },
  packageAPI: { getAll: vi.fn(), initializeOnboardingCatalog: vi.fn() },
}));

vi.mock('../../../services/api', () => ({ adminAPI, integrationAPI, packageAPI }));

import OnboardingChecklist from '../OnboardingChecklist';

function renderChecklist() {
  return render(
    <MemoryRouter>
      <OnboardingChecklist />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  adminAPI.getSettings.mockResolvedValue({
    data: { settings: { companyName: 'North Star Travel', companyAddress: '', logoUrl: '' } },
  });
  adminAPI.getUsers.mockResolvedValue({ pagination: { total: 1 } });
  packageAPI.getAll.mockResolvedValue({ total: 0 });
  integrationAPI.getEmail.mockResolvedValue({ data: { connected: false } });
  packageAPI.initializeOnboardingCatalog.mockResolvedValue({ status: 'success', data: {} });
});

describe('OnboardingChecklist', () => {
  it('shows incomplete setup steps with links to the relevant Management pages', async () => {
    renderChecklist();

    expect(await screen.findByText('Get started')).toBeInTheDocument();
    expect(screen.getByText('Add your company logo').closest('a')).toHaveAttribute('href', '/settings#company-identity');
    expect(screen.getByText('Invite a teammate').closest('a')).toHaveAttribute('href', '/users');
    expect(screen.getByText('Connect your agency email').closest('a')).toHaveAttribute('href', '/settings?tab=integrations');
    expect(packageAPI.initializeOnboardingCatalog).toHaveBeenCalledOnce();
  });

  it('hides the checklist after all setup tasks are complete', async () => {
    adminAPI.getSettings.mockResolvedValue({
      data: {
        settings: {
          companyName: 'North Star Travel',
          companyAddress: '1 Main Street',
          logoUrl: 'https://example.com/logo.png',
          bankName: 'Example Bank',
          bankAccountName: 'North Star Travel',
          bankAccountNumber: '12345',
        },
      },
    });
    adminAPI.getUsers.mockResolvedValue({ pagination: { total: 2 } });
    packageAPI.getAll.mockResolvedValue({ total: 1 });
    integrationAPI.getEmail.mockResolvedValue({ data: { connected: true } });

    const { container } = renderChecklist();

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a retryable error when checklist data cannot be loaded', async () => {
    adminAPI.getSettings.mockRejectedValue(new Error('request failed'));

    renderChecklist();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check: Organization settings');
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });
});

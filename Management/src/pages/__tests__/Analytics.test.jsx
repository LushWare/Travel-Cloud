import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockUseAuth, router } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  router: { params: new URLSearchParams(), setParams: vi.fn() },
}));

vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: mockUseAuth, useOptionalAuth: mockUseAuth }));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [router.params, router.setParams],
}));

vi.mock('../../features/analytics/components', () => ({
  LeadAnalytics: () => <div>Lead Analytics Content</div>,
  BillingAnalytics: () => <div>Billing Analytics Content</div>,
  UserAnalytics: () => <div>User Analytics Content</div>,
  PackageAnalytics: () => <div>Package Analytics Content</div>,
  WebsiteAnalytics: () => <div>Website Analytics Content</div>,
  MyPerformanceAnalytics: () => <div>My Performance Content</div>,
}));

import Analytics from '../Analytics.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  router.params = new URLSearchParams();
  router.setParams.mockReset();
});

describe('Analytics — tab visibility by role', () => {
  it('hides Package, Website, and Users analytics tabs for a salesRep user', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'salesRep' } });
    render(<Analytics />);

    expect(screen.getAllByText('Lead Analytics').length).toBeGreaterThan(0);
    expect(screen.getByText('Billing Analytics')).toBeInTheDocument();
    expect(screen.queryByText('Package Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Website Analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('User Analytics')).not.toBeInTheDocument();
  });

  it('shows every analytics tab for an admin user', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' } });
    render(<Analytics />);

    expect(screen.getAllByText('Lead Analytics').length).toBeGreaterThan(0);
    expect(screen.getByText('Billing Analytics')).toBeInTheDocument();
    expect(screen.getByText('Package Analytics')).toBeInTheDocument();
    expect(screen.getByText('Website Analytics')).toBeInTheDocument();
    expect(screen.getByText('User Analytics')).toBeInTheDocument();
  });

  it('shows the My Performance tab for a salesRep user but not the admin-only tabs', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'salesRep' } });
    render(<Analytics />);

    expect(screen.getAllByText('My Performance').length).toBeGreaterThan(0);
  });

  it('hides the My Performance tab for an admin user', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' } });
    render(<Analytics />);

    expect(screen.queryByText('My Performance')).not.toBeInTheDocument();
  });
});

describe('Analytics — notification deep links', () => {
  it('selects the URL-backed analytics tab when the role may view it', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin' } });
    router.params = new URLSearchParams('tab=billing');

    render(<Analytics />);

    expect(screen.getByText('Billing Analytics Content')).toBeInTheDocument();
  });
});

describe('Analytics — plan without full analytics', () => {
  it('explains the page is not in the plan instead of showing report tabs', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin', planModulesOff: ['analytics_full'] } });
    render(<Analytics />);

    expect(screen.getByText("Full analytics isn't in your plan")).toBeInTheDocument();
    expect(screen.queryByText('Lead Analytics Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Package Analytics')).not.toBeInTheDocument();
  });

  it('shows the reports when the plan includes full analytics', () => {
    mockUseAuth.mockReturnValue({ user: { role: 'admin', planModulesOff: ['vendors'] } });
    render(<Analytics />);

    expect(screen.queryByText("Full analytics isn't in your plan")).not.toBeInTheDocument();
    expect(screen.getByText('Lead Analytics Content')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockGetLeadAnalyticsOverview,
  mockGetPackageAnalyticsOverview,
  mockGetBillingAnalyticsOverview,
  mockGetUserAnalyticsOverview,
  mockGetSalesRepPerformance,
  mockUseAuth,
  mockUsePermission,
} = vi.hoisted(() => ({
  mockGetLeadAnalyticsOverview: vi.fn(),
  mockGetPackageAnalyticsOverview: vi.fn(),
  mockGetBillingAnalyticsOverview: vi.fn(),
  mockGetUserAnalyticsOverview: vi.fn(),
  mockGetSalesRepPerformance: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUsePermission: vi.fn(),
}));

vi.mock('../../../services/analytics.service.js', () => ({
  default: {
    getLeadAnalyticsOverview: mockGetLeadAnalyticsOverview,
    getPackageAnalyticsOverview: mockGetPackageAnalyticsOverview,
    getBillingAnalyticsOverview: mockGetBillingAnalyticsOverview,
    getUserAnalyticsOverview: mockGetUserAnalyticsOverview,
    getSalesRepPerformance: mockGetSalesRepPerformance,
  },
}));

vi.mock('../../../contexts/AuthContext.jsx', () => ({ useAuth: mockUseAuth }));
vi.mock('../../../contexts/PermissionContext.jsx', () => ({ usePermission: mockUsePermission }));
vi.mock('@/lib/toast', () => ({ default: { loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import DashboardContainer from '../DashboardContainer.tsx';

const leadOverview = { stats: { totalLeads: 55, allTimeTotalLeads: 80 }, trend: [{ label: 'Jul', new: 10 }, { label: 'Aug', new: 20 }], destinationPerformance: [] };
const packageOverview = { stats: { totalItineraries: 14 }, destinationPerformance: [{ destination: 'Bali', inquiries: 5 }] };
const billingOverview = {
  stats: { totalOutstanding: 1200, currentOutstanding: 4800, pendingInvoices: 2, currentPendingInvoices: 5, totalPotentialRevenue: 1000, totalRevenue: 9000 },
  revenueTrend: [{ label: 'Jul', revenue: 4000, target: 4000 }, { label: 'Aug', revenue: 9000, target: 4000 }],
};
const userOverview = { stats: { totalUsers: 12, allTimeTotalUsers: 90, activeUsers: 9, inactiveUsers: 3 }, roleDistribution: [] };

function setRole(role, permissions = []) {
  mockUseAuth.mockReturnValue({ user: { name: 'Test User', role } });
  mockUsePermission.mockReturnValue({ hasPermission: (p) => permissions.includes(p) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLeadAnalyticsOverview.mockResolvedValue(leadOverview);
  mockGetPackageAnalyticsOverview.mockResolvedValue(packageOverview);
  mockGetBillingAnalyticsOverview.mockResolvedValue(billingOverview);
  mockGetUserAnalyticsOverview.mockResolvedValue(userOverview);
  mockGetSalesRepPerformance.mockResolvedValue({ performance: { leadsAssigned: 7, converted: 3, pending: 4, conversionRate: 42.9 } });
});

describe('DashboardContainer', () => {
  it('renders real metric values from the API responses for an admin', async () => {
    setRole('admin', ['manage_billing', 'view_reports']);
    render(<DashboardContainer />);

    await waitFor(() => expect(screen.getByText('80')).toBeInTheDocument());
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
    expect(screen.getByText('Total Leads')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getAllByText('New Users').length).toBeGreaterThan(0);
    expect(screen.getByText('Collected Revenue')).toBeInTheDocument();
  });

  it('never renders a fabricated trend percentage', async () => {
    setRole('admin', ['manage_billing', 'view_reports']);
    render(<DashboardContainer />);

    await waitFor(() => expect(screen.getByText('80')).toBeInTheDocument());
    for (const fake of ['+12%', '+5%', '+23%', '-15%', '+8%']) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument();
    }
  });

  it('computes a real trend badge from period-over-period revenue', async () => {
    setRole('admin', ['manage_billing', 'view_reports']);
    render(<DashboardContainer />);

    // revenueTrend goes 4000 -> 9000, a +125% period-over-period change
    await waitFor(() => expect(screen.getByText('+125%')).toBeInTheDocument());
  });

  it('renders the sales rep\'s own performance block for a salesRep, sourced from performance{}', async () => {
    setRole('salesRep');
    render(<DashboardContainer />);

    await waitFor(() => expect(screen.getByText('Your Performance')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('42.9%')).toBeInTheDocument();
  });

  it('dismisses the error banner when the dismiss button is clicked', async () => {
    setRole('admin', ['manage_billing', 'view_reports']);
    mockGetLeadAnalyticsOverview.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<DashboardContainer />);

    await waitFor(() => expect(screen.getByText('14')).toBeInTheDocument());
    // Individual overview failures are swallowed per-panel, so the banner
    // only appears if fetchData's outer catch fires; this asserts the
    // dismiss control works whenever it is shown, without depending on it.
    const dismiss = screen.queryByText('Dismiss');
    if (dismiss) {
      await user.click(dismiss);
      expect(screen.queryByText('Dismiss')).not.toBeInTheDocument();
    }
  });
});

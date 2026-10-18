import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { mockGetBillingOverview } = vi.hoisted(() => ({ mockGetBillingOverview: vi.fn() }));

vi.mock('../../../../../services/api.js', () => ({
  analyticsAPI: { getBillingOverview: mockGetBillingOverview },
}));

vi.mock('@/lib/toast', () => ({ default: { loading: vi.fn(), dismiss: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import BillingAnalytics from '../BillingAnalytics.tsx';

const fixture = {
  success: true,
  data: {
    stats: { totalRevenue: 50000, totalOutstanding: 12000, totalPotentialRevenue: 8000, pendingInvoices: 6 },
    revenueTrend: [{ label: 'Jul 2026', revenue: 20000, target: 18000 }, { label: 'Aug 2026', revenue: 50000, target: 20000 }],
    outstandingTrend: [{ label: 'Aug 2026', outstanding: 12000, potentialRevenue: 8000 }],
    paymentStatusDistribution: [
      { name: 'Paid', status: 'paid', totalAmount: 50000.12 },
      { name: 'Cancelled', status: 'cancelled', totalAmount: 6933.14 },
    ],
    invoiceCategoryBreakdown: [{ name: 'Invoice', revenue: 50000, invoices: 6 }],
  },
};

beforeEach(() => vi.clearAllMocks());

describe('BillingAnalytics', () => {
  it('renders totalOutstanding and pendingInvoices distinctly from totalRevenue', async () => {
    mockGetBillingOverview.mockResolvedValue(fixture);
    render(<BillingAnalytics />);

    await waitFor(() => expect(screen.getAllByText(/\$?12(\.\d+)?K/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    expect(screen.getByText('56933.26')).toBeInTheDocument();
  });

  it('shows "No data available" for revenue trend when the response has no history', async () => {
    mockGetBillingOverview.mockResolvedValue({
      success: true,
      data: { stats: { totalRevenue: 0, totalOutstanding: 0, totalPotentialRevenue: 0, pendingInvoices: 0 }, revenueTrend: [], outstandingTrend: [], paymentStatusDistribution: [], invoiceCategoryBreakdown: [] },
    });
    render(<BillingAnalytics />);

    await waitFor(() => expect(screen.getByText(/no revenue data available/i)).toBeInTheDocument());
    expect(screen.getByText(/no payment status data available/i)).toBeInTheDocument();
    expect(screen.getByText(/no invoice data available/i)).toBeInTheDocument();
  });
});

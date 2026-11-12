import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgencyPlanSummary from '../AgencyPlanSummary';

vi.mock('../../services/api', () => ({
  adminAPI: { getAgencyPlan: vi.fn() },
}));

import { adminAPI } from '../../services/api';

afterEach(() => vi.clearAllMocks());

describe('AgencyPlanSummary', () => {
  it('shows effective plan limits, usage, and feature access', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue({
      data: {
        plan: { name: 'Growth', version: 2, key: 'growth' },
        entitlements: { staff_seats: 8, packages: 30, features: { ai_itinerary_builder: false } },
        usage: { staff_seats: 6, packages: 22 },
      },
    });

    render(<AgencyPlanSummary />);

    expect(await screen.findByText('Growth · v2')).toBeInTheDocument();
    expect(screen.getByText('6 / 8')).toBeInTheDocument();
    expect(screen.getByText('22 / 30')).toBeInTheDocument();
    expect(screen.getByText('AI itinerary builder').parentElement).toHaveTextContent('Not included');
  });

  const withSends = (emails: number, emailLimit: number | null) => ({
    data: {
      plan: { name: 'Starter', version: 1, key: 'starter' },
      entitlements: { staff_seats: null, packages: null, emails_per_month: emailLimit, whatsapp_per_month: null, features: {} },
      usage: { staff_seats: 1, packages: 1, emails_per_month: emails, whatsapp_per_month: 3 },
    },
  });

  it('shows this month\'s customer emails against the monthly limit', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue(withSends(120, 1000));

    render(<AgencyPlanSummary />);

    expect(await screen.findByText('120 / 1000')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns once usage reaches 80% of a monthly limit', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue(withSends(800, 1000));

    render(<AgencyPlanSummary />);

    expect(await screen.findByRole('status')).toHaveTextContent('Nearly at the limit');
  });

  it('says sending is paused once a monthly limit is reached', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue(withSends(1000, 1000));

    render(<AgencyPlanSummary />);

    expect(await screen.findByRole('status')).toHaveTextContent('sending is paused until the 1st of next month');
  });

  it('never warns about an unlimited allowance', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue(withSends(50000, null));

    render(<AgencyPlanSummary />);

    expect(await screen.findByText('50000 / Unlimited')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows legacy access as unlimited when there is no plan assignment', async () => {
    vi.mocked(adminAPI.getAgencyPlan).mockResolvedValue({
      data: {
        plan: null,
        entitlements: { staff_seats: null, packages: null, features: {} },
        usage: { staff_seats: 1, packages: 2 },
      },
    });

    render(<AgencyPlanSummary />);

    expect(await screen.findByText('Default access')).toBeInTheDocument();
    expect(screen.getByText('1 / Unlimited')).toBeInTheDocument();
    expect(screen.getByText('2 / Unlimited')).toBeInTheDocument();
  });
});
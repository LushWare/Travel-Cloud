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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgencySignup from '../AgencySignup';

const { authService } = vi.hoisted(() => ({
  authService: { getSignupPlans: vi.fn(), createAgency: vi.fn() },
}));

vi.mock('../../services/auth.service', () => ({ default: authService }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

const plans = [
  {
    key: 'starter', planVersionId: 'plan-starter', name: 'Starter', description: 'For small teams.',
    priceMinorUnits: 4900, currency: 'USD', billingInterval: 'monthly',
    entitlements: { staff_seats: 5, packages: 25, features: {} },
  },
  {
    key: 'growth', planVersionId: 'plan-growth', name: 'Growth', description: 'For growing teams.',
    priceMinorUnits: 14900, currency: 'USD', billingInterval: 'monthly',
    entitlements: { staff_seats: 15, packages: 100, features: { ai_itinerary_builder: true } },
  },
];

afterEach(() => vi.clearAllMocks());

describe('AgencySignup', () => {
  it('lets an owner choose a post-trial plan and starts signup with that choice', async () => {
    authService.getSignupPlans.mockResolvedValue({ data: plans });
    authService.createAgency.mockResolvedValue({ data: { email: 'alex@example.com' } });

    render(
      <MemoryRouter initialEntries={['/signup?plan=starter']}>
        <AgencySignup />
      </MemoryRouter>,
    );

    expect(await screen.findByText('$49.00 / month')).toBeInTheDocument();
    expect(screen.getByText('Your trial uses Growth features. No payment is taken today; we\'ll ask you to confirm billing before the trial ends.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Agency name'), { target: { value: 'North Star Travel' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex Owner' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Create an account/ }));

    await waitFor(() => {
      expect(authService.createAgency).toHaveBeenCalledWith({
        agencyName: 'North Star Travel',
        ownerName: 'Alex Owner',
        email: 'alex@example.com',
        password: 'secure-password',
        planKey: 'starter',
      });
    });
  });
});

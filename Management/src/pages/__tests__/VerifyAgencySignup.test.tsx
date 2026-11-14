import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VerifyAgencySignup from '../VerifyAgencySignup';

const { authService, setAuth } = vi.hoisted(() => ({
  authService: { verifyAgencySignup: vi.fn(), resendAgencySignupCode: vi.fn() },
  setAuth: vi.fn(),
}));

vi.mock('../../services/auth.service', () => ({ default: authService }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, setAuth }),
}));

afterEach(() => vi.clearAllMocks());

describe('VerifyAgencySignup', () => {
  it('verifies the email and signs the owner into the new agency', async () => {
    const user = { id: 'owner-id', tenant: { id: 'tenant-id', name: 'North Star Travel' } };
    authService.verifyAgencySignup.mockResolvedValue({ data: { user } });

    render(
      <MemoryRouter initialEntries={['/verify-signup?email=alex%40example.com']}>
        <VerifyAgencySignup />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Six-digit verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Verify and open your agency/ }));

    await waitFor(() => {
      expect(authService.verifyAgencySignup).toHaveBeenCalledWith('alex@example.com', '123456');
      expect(setAuth).toHaveBeenCalledWith(user);
    });
  });
});

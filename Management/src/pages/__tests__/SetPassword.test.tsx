import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetAuth, mockAuthFetch, mockNavigate } = vi.hoisted(() => ({
  mockSetAuth: vi.fn(),
  mockAuthFetch: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ setAuth: mockSetAuth }) }));
vi.mock('@/lib/authFetch', () => ({ API_BASE_URL: 'https://api.test/api/v1', authFetch: mockAuthFetch }));
vi.mock('@/lib/toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mockNavigate,
}));

import SetPassword, { passwordProblem } from '../SetPassword';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/set-password/tok123']}>
      <Routes>
        <Route path="/set-password/:token" element={<SetPassword />} />
      </Routes>
    </MemoryRouter>
  );
}

function submit(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('passwordProblem', () => {
  it('rejects a password shorter than 12 characters', () => {
    expect(passwordProblem('Short1', 'Short1')).toBe('Use at least 12 characters.');
  });

  it('rejects a password without numbers', () => {
    expect(passwordProblem('onlylettershere', 'onlylettershere')).toBe('Use both letters and numbers.');
  });

  it('rejects passwords that do not match', () => {
    expect(passwordProblem('Long-enough-123', 'Long-enough-124')).toBe('The two passwords do not match.');
  });

  it('accepts a long password with letters and numbers', () => {
    expect(passwordProblem('Long-enough-123', 'Long-enough-123')).toBeNull();
  });
});

describe('SetPassword page', () => {
  it('sends the new password to the link from the email', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { user: { id: 'u1' } } }) });
    renderPage();

    submit('Long-enough-123');

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledWith(
      'https://api.test/api/v1/auth/reset-password/tok123',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ password: 'Long-enough-123' }) }),
    ));
  });

  it('signs the person in and opens the dashboard', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { user: { id: 'u1' } } }) });
    renderPage();

    submit('Long-enough-123');

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
    expect(mockSetAuth).toHaveBeenCalledWith({ id: 'u1' });
  });

  it('does not call the server when the password is too weak', () => {
    renderPage();

    submit('weak');

    expect(mockAuthFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('at least 12');
  });

  it('explains an expired link', async () => {
    mockAuthFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'Invalid or expired reset token' }) });
    renderPage();

    submit('Long-enough-123');

    expect((await screen.findByRole('alert')).textContent).toContain('Invalid or expired reset token');
    expect(mockSetAuth).not.toHaveBeenCalled();
  });
});

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPost, mockRefreshSession } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockRefreshSession: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: mockPost,
    defaults: { headers: { common: {} } },
  },
}));

vi.mock('@/lib/toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock('@/lib/authFetch', () => ({
  API_BASE_URL: 'https://api.test/api/v1',
  SESSION_EXPIRED_EVENT: 'auth:session-expired',
  refreshSession: mockRefreshSession,
}));

import { AuthProvider, useAuth } from '../AuthContext';

const USER = { id: 'user-1', role: 'admin' };
let auth;

function AuthStatus() {
  auth = useAuth();
  return <div>{auth.isAuthenticated ? 'authenticated' : 'signed out'}</div>;
}

async function renderAuth() {
  render(
    <AuthProvider>
      <AuthStatus />
    </AuthProvider>
  );
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  mockPost.mockReset().mockReturnValue(new Promise(() => {}));
  mockRefreshSession.mockReset().mockResolvedValue(USER);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('user', JSON.stringify(USER));
  localStorage.setItem('lastActivity', Date.now().toString());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthContext session restore', () => {
  it('restores the login from the cookie session on reload', async () => {
    await renderAuth();

    expect(screen.getByText('authenticated')).toBeTruthy();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it('signs out on reload when the cookie session can no longer be renewed', async () => {
    mockRefreshSession.mockResolvedValue(null);

    await renderAuth();

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('does not contact the server when nobody was signed in', async () => {
    localStorage.clear();

    await renderAuth();

    expect(mockRefreshSession).not.toHaveBeenCalled();
    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('removes a token left in storage by the old login method', async () => {
    localStorage.setItem('token', 'old-token');
    sessionStorage.setItem('token', 'old-token');

    await renderAuth();

    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('stores the refreshed profile from the server', async () => {
    mockRefreshSession.mockResolvedValue({ id: 'user-1', role: 'salesRep' });

    await renderAuth();

    expect(JSON.parse(localStorage.getItem('user')).role).toBe('salesRep');
  });
});

describe('AuthContext login', () => {
  it('keeps only the user profile in storage, never a token', async () => {
    localStorage.clear();
    mockPost.mockResolvedValue({ data: { data: { user: USER } } });
    await renderAuth();

    await act(async () => {
      await auth.login('a@test.com', 'pw');
    });

    expect(screen.getByText('authenticated')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('user'))).toEqual(USER);
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });
});

describe('AuthContext first login with a temporary password', () => {
  it('keeps the temporary password out of browser storage', async () => {
    localStorage.clear();
    mockPost.mockResolvedValue({ data: { data: { mustChangePassword: true } } });
    await renderAuth();

    let result;
    await act(async () => {
      result = await auth.login('new@test.com', 'Temp-Pass-1');
    });

    expect(result).toBe('password-reset-required');
    expect(JSON.stringify({ ...localStorage })).not.toContain('Temp-Pass-1');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Temp-Pass-1');
  });

  it('hands the temporary password to the reset page in memory', async () => {
    const { peekPendingPasswordReset } = await import('@/lib/pendingPasswordReset');
    localStorage.clear();
    mockPost.mockResolvedValue({ data: { data: { mustChangePassword: true } } });
    await renderAuth();

    await act(async () => {
      await auth.login('new@test.com', 'Temp-Pass-1');
    });

    expect(peekPendingPasswordReset()).toEqual({ email: 'new@test.com', tempPassword: 'Temp-Pass-1' });
  });
});

describe('AuthContext session expiry', () => {
  it('signs out when a request reports the session can no longer be renewed', async () => {
    await renderAuth();

    act(() => {
      window.dispatchEvent(new Event('auth:session-expired'));
    });

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('signs out when another tab signs out', async () => {
    await renderAuth();

    act(() => {
      localStorage.removeItem('user');
      window.dispatchEvent(new StorageEvent('storage', { key: 'user', newValue: null }));
    });

    expect(screen.getByText('signed out')).toBeTruthy();
  });
});

describe('AuthContext inactivity logout', () => {
  it('clears the local session when the server logout request hangs', async () => {
    await renderAuth();
    expect(screen.getByText('authenticated')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(localStorage.getItem('user')).toBeNull();
    expect(mockPost).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/));
  });

  it('logs out on reopen when the persisted activity timestamp has expired', async () => {
    localStorage.setItem('lastActivity', (Date.now() - 60 * 60 * 1000 - 1).toString());

    await renderAuth();

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it('does not restart the inactivity period when reopening a fresh tab', async () => {
    const lastActivity = Date.now() - (60 * 60 * 1000 - 60 * 1000);
    localStorage.setItem('lastActivity', lastActivity.toString());

    await renderAuth();

    expect(screen.getByText('authenticated')).toBeTruthy();
    expect(localStorage.getItem('lastActivity')).toBe(lastActivity.toString());

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('uses activity recorded in another tab to extend the session deadline', async () => {
    await renderAuth();

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });

    const otherTabActivity = Date.now().toString();
    localStorage.setItem('lastActivity', otherTabActivity);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'lastActivity',
        newValue: otherTabActivity,
      }));
    });

    act(() => {
      vi.advanceTimersByTime(59 * 60 * 1000);
    });
    expect(screen.getByText('authenticated')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(screen.getByText('signed out')).toBeTruthy();
  });
});

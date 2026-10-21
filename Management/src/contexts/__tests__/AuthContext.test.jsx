import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));

vi.mock('axios', () => ({
  default: {
    post: mockPost,
    defaults: { headers: { common: {} } },
  },
}));

vi.mock('@/lib/toast', () => ({ default: vi.fn(), success: vi.fn(), error: vi.fn() }));

import { AuthProvider, useAuth } from '../AuthContext';

function AuthStatus() {
  const { isAuthenticated } = useAuth();
  return <div>{isAuthenticated ? 'authenticated' : 'signed out'}</div>;
}

describe('AuthContext inactivity logout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPost.mockReturnValue(new Promise(() => {}));
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('token', 'session-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', role: 'admin' }));
    localStorage.setItem('lastActivity', Date.now().toString());
    sessionStorage.setItem('lastActivity', Date.now().toString());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the local session when the server logout request hangs', () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    expect(screen.getByText('authenticated')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('lastActivity')).toBeNull();
    expect(mockPost).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/));
  });

  it('logs out on reopen when the persisted activity timestamp has expired', () => {
    localStorage.setItem('lastActivity', (Date.now() - 60 * 60 * 1000 - 1).toString());
    sessionStorage.clear();

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    expect(screen.getByText('signed out')).toBeTruthy();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('does not restart the inactivity period when reopening a fresh tab', () => {
    const lastActivity = Date.now() - (60 * 60 * 1000 - 60 * 1000);
    localStorage.setItem('lastActivity', lastActivity.toString());
    sessionStorage.clear();

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    expect(screen.getByText('authenticated')).toBeTruthy();
    expect(localStorage.getItem('lastActivity')).toBe(lastActivity.toString());

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(screen.getByText('signed out')).toBeTruthy();
  });

  it('uses activity recorded in another tab to extend the session deadline', () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

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
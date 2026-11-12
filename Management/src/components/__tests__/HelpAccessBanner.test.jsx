import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogout, mockUser, mockToast } = vi.hoisted(() => ({ mockLogout: vi.fn(), mockUser: { current: null }, mockToast: vi.fn() }));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current, logout: mockLogout }) }));
vi.mock('@/lib/toast', () => ({ default: mockToast }));

import HelpAccessBanner from '../HelpAccessBanner';

const helpUser = (minutes) => ({
  name: 'Lushware support · Ops', role: 'admin', tenant: { name: 'Acme Tours' },
  helpAccess: { grantId: 'g-1', viewOnly: true, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString() },
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockLogout.mockReset();
  mockToast.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('HelpAccessBanner', () => {
  it('shows nothing for an ordinary agency login', () => {
    mockUser.current = { name: 'Priya', role: 'admin' };

    const { container } = render(<HelpAccessBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says whose view it is, that it is view-only and how long is left', () => {
    mockUser.current = helpUser(30);

    render(<HelpAccessBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('Lushware support view of Acme Tours');
    expect(screen.getByRole('status')).toHaveTextContent('view-only, changes are blocked');
    expect(screen.getByRole('status')).toHaveTextContent('(30 min left)');
  });

  it('ends the help session when asked', () => {
    mockUser.current = helpUser(30);
    render(<HelpAccessBanner />);

    fireEvent.click(screen.getByRole('button', { name: /End help session/ }));

    expect(mockLogout).toHaveBeenCalledWith();
  });

  it('signs out by itself when the time is up', () => {
    mockUser.current = helpUser(1);
    render(<HelpAccessBanner />);

    act(() => { vi.advanceTimersByTime(75_000); });

    expect(mockLogout).toHaveBeenCalledWith({ silent: true });
    expect(mockToast).toHaveBeenCalledWith('Help access has ended.');
  });
});

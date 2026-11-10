import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

import ChooseAgency from '../ChooseAgency';
import {
  clearPendingTenantChoice, nextStepAfterSignIn, peekPendingTenantChoice, setPendingTenantChoice,
} from '@/lib/pendingTenantChoice';

const TENANTS = [
  { id: 'aaa', name: 'Acme Tours', slug: 'acme-tours', role: 'salesRep' },
  { id: 'bbb', name: 'Globe DMC', slug: 'globe-dmc', role: 'admin' },
];

const renderPage = () => render(<MemoryRouter><ChooseAgency /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingTenantChoice();
});

describe('nextStepAfterSignIn', () => {
  it('sends someone in several agencies to the picker', () => {
    expect(nextStepAfterSignIn({ requiresTenantChoice: true, selectionToken: 't', tenants: TENANTS }, mockSetAuth)).toBe('choose-agency');
    expect(mockSetAuth).not.toHaveBeenCalled();
  });

  it('keeps the choice in memory for the picker', () => {
    nextStepAfterSignIn({ requiresTenantChoice: true, selectionToken: 't', tenants: TENANTS }, mockSetAuth);

    expect(peekPendingTenantChoice()).toEqual({ selectionToken: 't', tenants: TENANTS });
  });

  it('never puts the selection token in browser storage', () => {
    nextStepAfterSignIn({ requiresTenantChoice: true, selectionToken: 'secret-token', tenants: TENANTS }, mockSetAuth);

    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('secret-token');
  });

  it('signs straight in when there is one agency', () => {
    expect(nextStepAfterSignIn({ user: { id: 'u1' } }, mockSetAuth)).toBe('signed-in');
    expect(mockSetAuth).toHaveBeenCalledWith({ id: 'u1' });
  });
});

describe('ChooseAgency page', () => {
  it('lists every agency with the person\'s role in it', () => {
    setPendingTenantChoice({ selectionToken: 't', tenants: TENANTS });
    renderPage();

    expect(screen.getByText('Acme Tours')).toBeTruthy();
    expect(screen.getByText('Globe DMC')).toBeTruthy();
    expect(screen.getByText('Sales rep')).toBeTruthy();
  });

  it('opens the chosen agency', async () => {
    setPendingTenantChoice({ selectionToken: 't', tenants: TENANTS });
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { user: { id: 'u1', tenant: { id: 'bbb' } } } }) });
    renderPage();

    fireEvent.click(screen.getByText('Globe DMC'));

    await waitFor(() => expect(mockSetAuth).toHaveBeenCalledWith({ id: 'u1', tenant: { id: 'bbb' } }));
    expect(JSON.parse(mockAuthFetch.mock.calls[0][1].body)).toEqual({ selectionToken: 't', tenantId: 'bbb' });
    expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('sends the person back to login when the choice expired', async () => {
    setPendingTenantChoice({ selectionToken: 't', tenants: TENANTS });
    mockAuthFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'expired' }) });
    renderPage();

    fireEvent.click(screen.getByText('Acme Tours'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(mockSetAuth).not.toHaveBeenCalled();
  });

  it('sends someone who opened the page directly back to login', () => {
    renderPage();

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });
});

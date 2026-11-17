import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

const ADMIN = { id: 'u-1', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin' };
const SUPPORT = { ...ADMIN, role: 'support' };
const AGENCY_ID = '00000000-0000-4000-8000-000000000009';
const pendingDetail = {
  agency: { id: AGENCY_ID, name: 'North Star Travel', slug: 'north-star', status: 'pending_approval', region: 'apac', createdAt: '2026-11-16T00:00:00Z' },
  isPublicSite: false,
  people: { total: 1, byRole: { owners: 1, admins: 0, salesReps: 0, vendors: 0 }, byStatus: { active: 1, invited: 0, suspended: 0 } },
  owners: [{ name: 'Alex Owner', email: 'alex@example.com', status: 'active', lastLogin: null }],
  usage: { leads: { total: 0, thisMonth: 0 }, quotations: { total: 0, thisMonth: 0 }, invoices: { total: 0, thisMonth: 0 }, bookings: { total: 0, thisMonth: 0 }, packages: { total: 0, thisMonth: 0 } },
  activity: { lastActivityAt: null, activeUsers7d: 0, activeUsers30d: 0 },
  setup: { companyDetails: false, logo: false, bankDetails: false },
  history: [],
  plan: { assignment: null, overrides: [], resolved: { plan: null, entitlements: { staff_seats: null, packages: null, features: {} }, source: {} } },
};

const ok = (data: unknown, pagination?: unknown) => ({ status: 200, body: { status: 'success', data, ...(pagination ? { pagination } : {}) } });
const calls: { url: string; method: string; body: unknown }[] = [];
let me = ADMIN;
let approvalOn = false;

beforeEach(() => {
  calls.length = 0;
  me = ADMIN;
  approvalOn = false;
  window.location.hash = '';
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    let res: { status: number; body: unknown } = { status: 404, body: { message: 'not found' } };
    if (url.endsWith('/auth/me')) res = ok({ user: me });
    else if (url.endsWith('/settings/signup-approval')) { approvalOn = body.enabled; res = ok({ requireSignupApproval: approvalOn }); }
    else if (url.endsWith('/settings')) res = ok({ requireSignupApproval: approvalOn });
    else if (url.endsWith('/approve')) res = ok({ agency: { status: 'trial' }, ownersEmailed: true });
    else if (url.endsWith('/reject')) res = ok({ agency: { status: 'deleted' }, ownersEmailed: true });
    else if (url.endsWith('/plans')) res = ok([]);
    else if (/\/agencies\/[0-9a-f-]{36}$/.test(url)) res = ok(pendingDetail);
    else if (url.includes('/agencies?')) res = ok([], { page: 1, limit: 25, total: 0, pages: 0 });
    return { ok: res.status < 400, status: res.status, json: async () => res.body } as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = (hash: string) => { window.location.hash = hash; render(<App />); };

describe('sign-up approval switch', () => {
  it('shows that sign-up is open by default', async () => {
    open('#/agencies');

    expect(await screen.findByRole('switch', { name: 'Require approval for new sign-ups' })).toHaveAttribute('aria-checked', 'false');
  });

  it('lets a platform admin turn approval on', async () => {
    const user = userEvent.setup();
    open('#/agencies');

    await user.click(await screen.findByRole('switch', { name: 'Require approval for new sign-ups' }));

    await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(calls.find((c) => c.url.endsWith('/settings/signup-approval'))).toMatchObject({ method: 'PUT', body: { enabled: true } });
  });

  it('does not let support staff change it', async () => {
    me = SUPPORT;
    open('#/agencies');

    expect(await screen.findByRole('switch', { name: 'Require approval for new sign-ups' })).toBeDisabled();
  });
});

describe('an agency awaiting approval', () => {
  it('shows it as awaiting approval', async () => {
    open(`#/agencies/${AGENCY_ID}`);

    expect((await screen.findAllByText('Awaiting approval')).length).toBeGreaterThan(0);
  });

  it('approves it from the agency page', async () => {
    const user = userEvent.setup();
    open(`#/agencies/${AGENCY_ID}`);

    await user.click(await screen.findByRole('button', { name: /Approve/ }));

    expect(await screen.findByText('Agency approved. The owner has been emailed.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/agencies/${AGENCY_ID}/approve`))).toBe(true);
  });

  it('rejects it with a reason', async () => {
    const user = userEvent.setup();
    open(`#/agencies/${AGENCY_ID}`);

    await user.click(await screen.findByRole('button', { name: /Reject/ }));
    await user.type(screen.getByPlaceholderText('e.g. Looks like a spam sign-up'), 'Looks like a spam sign-up');
    await user.click(screen.getByRole('button', { name: 'Reject sign-up' }));

    expect(await screen.findByText('Sign-up rejected. The owner has been emailed.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/reject'))?.body).toEqual({ reason: 'Looks like a spam sign-up' });
  });

  it('offers no approve or reject to support staff', async () => {
    me = SUPPORT;
    open(`#/agencies/${AGENCY_ID}`);

    await screen.findAllByText('Awaiting approval');
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
  });
});

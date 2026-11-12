import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { parseRoute } from '../../lib/route';

const ADMIN = { id: 'admin-1', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin' };
const SUPPORT = { ...ADMIN, role: 'support' };
const STAFF_ID = '00000000-0000-4000-8000-000000000002';
const staffRow = {
  id: STAFF_ID, email: 'support@lushware.test', name: 'Support Agent', role: 'support',
  isActive: false, authenticatorSetupRequired: true, setupPurpose: 'invite', lastLoginAt: null, createdAt: '2026-11-01T00:00:00Z',
};
const selfRow = {
  id: ADMIN.id, email: ADMIN.email, name: ADMIN.name, role: 'platform_admin',
  isActive: true, authenticatorSetupRequired: false, setupPurpose: null, lastLoginAt: '2026-11-11T00:00:00Z', createdAt: '2026-10-01T00:00:00Z',
};
const ok = (data: unknown) => ({ status: 200, body: { status: 'success', data } });
type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  calls.length = 0;
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const result = handler(url, init);
    return { ok: result.status < 400, status: result.status, json: async () => result.body } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

const open = (hash: string, user = ADMIN) => {
  handler = (url, init) => {
    if (url.endsWith('/auth/me')) return ok({ user });
    if (url.endsWith('/platform/staff') && init.method === 'POST') return ok(staffRow);
    if (url.includes('/platform/staff/') && init.method === 'POST') return ok(staffRow);
    if (url.includes('/platform/staff/') && init.method === 'PUT') return ok({ ...staffRow, role: 'platform_admin' });
    if (url.includes('/platform/staff/') && init.method === 'DELETE') return ok({ ...staffRow, deleted: true });
    if (url.endsWith('/platform/staff')) return ok([selfRow, staffRow]);
    if (url.endsWith('/auth/setup/details')) return ok({
      email: 'support@lushware.test', name: 'Support Agent', purpose: 'invite', requiresPassword: true,
      secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Lush%20Console',
    });
    if (url.endsWith('/auth/setup')) return ok({ completed: true });
    return { status: 404, body: { message: 'not found' } };
  };
  window.location.hash = hash;
  render(<App />);
};

describe('staff routes', () => {
  it('parses the setup token from the hash route', () => {
    expect(parseRoute('#/setup?token=abc_123')).toEqual({ page: 'setup', token: 'abc_123' });
  });

  it('lets platform admins open staff management and resend a pending invite', async () => {
    const user = userEvent.setup();
    open('#/staff');

    expect(await screen.findByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByText('Invite pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Resend invite/ }));

    await waitFor(() => expect(calls.some(({ url }) => url.endsWith(`/platform/staff/${STAFF_ID}/resend-invite`))).toBe(true));
  });

  it('shows active Overview links to admins', async () => {
    open('#/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: /Help access/ })).toHaveAttribute('href', '#/agencies');
    expect(main.getByRole('link', { name: /Staff/ })).toHaveAttribute('href', '#/staff');
  });

  it('explains why the current admin cannot change their own role or run account actions', async () => {
    open('#/staff');

    const selfRole = await screen.findByRole('combobox', { name: `Role for ${ADMIN.email}` });
    expect(selfRole).toBeDisabled();
    expect(screen.getByText('Your role can’t be changed here.')).toBeInTheDocument();
    expect(screen.getByText('Use another platform admin account to manage this account.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: `Role for ${staffRow.email}` })).toBeEnabled();
  });

  it('creates a Console staff invitation with the selected role', async () => {
    const user = userEvent.setup();
    open('#/staff');

    await user.click(await screen.findByRole('button', { name: /Add staff/ }));
    await user.type(screen.getByLabelText('Full name'), 'Alex Support');
    await user.type(screen.getByLabelText('Email'), 'alex@lushware.test');
    await user.selectOptions(screen.getByLabelText('Role'), 'platform_admin');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to support@lushware.test');
    const request = calls.find(({ url, init }) => url.endsWith('/platform/staff') && init.method === 'POST');
    expect(JSON.parse(String(request?.init.body))).toEqual({ email: 'alex@lushware.test', name: 'Alex Support', role: 'platform_admin' });
  });

  it('requires typing the account email before permanently deleting staff', async () => {
    const user = userEvent.setup();
    open('#/staff');

    await user.click(await screen.findByRole('button', { name: /Delete permanently/ }));
    const dialog = screen.getByRole('dialog', { name: 'Delete staff account?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });
    expect(confirm).toBeDisabled();
    expect(dialog).toHaveTextContent('Audit history is retained');

    await user.type(screen.getByLabelText(/Type support@lushware.test to confirm/), 'support@lushware.test');
    await user.click(confirm);

    expect(await screen.findByRole('status')).toHaveTextContent('Support Agent\'s account was permanently deleted.');
    expect(calls.some(({ url, init }) => url.endsWith(`/platform/staff/${STAFF_ID}`) && init.method === 'DELETE')).toBe(true);
  });

  it('keeps staff management hidden from support accounts', async () => {
    open('#/staff', SUPPORT);

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Staff' })).not.toBeInTheDocument();
    expect(calls.some(({ url }) => url.endsWith('/platform/staff'))).toBe(false);
  });

  it('keeps the Staff Overview shortcut hidden from support accounts', async () => {
    open('#/', SUPPORT);

    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('link', { name: /Help access/ })).toBeInTheDocument();
    expect(main.queryByRole('link', { name: /Staff/ })).not.toBeInTheDocument();
  });

  it('sends an authenticator setup code and password to finish an invitation', async () => {
    const user = userEvent.setup();
    open('#/setup?token=invitation-token-123456789012345678901234');

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Create password'), 'a-long-unique-phrase-930');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-unique-phrase-930');
    await user.type(screen.getByLabelText('6-digit authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Complete setup' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Setup complete' })).toBeInTheDocument();
    const request = calls.find(({ url }) => url.endsWith('/auth/setup'));
    expect(JSON.parse(String(request?.init.body))).toMatchObject({
      token: 'invitation-token-123456789012345678901234', password: 'a-long-unique-phrase-930', code: '123456',
    });
  });
});
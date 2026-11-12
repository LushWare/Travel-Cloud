import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';

const USER = { id: 'u-1', email: 'ops@lushware.test', name: 'Ops Person', role: 'platform_admin' };

type Reply = { status: number; body: unknown };
const routes = new Map<string, Reply[]>();
const calls: { url: string; init: RequestInit }[] = [];

const reply = (path: string, ...replies: Reply[]) => routes.set(path, replies);
const ok = (data: unknown): Reply => ({ status: 200, body: { status: 'success', data } });
const fail = (status: number, message: string): Reply => ({ status, body: { status: 'fail', message } });

beforeEach(() => {
  routes.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = url.replace(/^.*\/platform/, '');
    const queue = routes.get(path) ?? [];
    const next = queue.length > 1 ? queue.shift()! : queue[0] ?? fail(404, 'not found');
    return { ok: next.status < 400, status: next.status, json: async () => next.body } as Response;
  }));
});

afterEach(() => vi.unstubAllGlobals());

const signInWithPassword = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Email'), 'ops@lushware.test');
  await user.type(screen.getByLabelText('Password'), 'Correct-Horse-9');
  await user.click(screen.getByRole('button', { name: 'Next' }));
};

describe('console sign-in', () => {
  it('shows the sign-in form when there is no session', async () => {
    reply('/auth/me', fail(401, 'Your session has expired.'));

    render(<App />);

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('goes straight to the console when the session is still live', async () => {
    reply('/auth/me', ok({ user: USER }));

    render(<App />);

    expect(await screen.findByText('Signed in as ops@lushware.test')).toBeInTheDocument();
  });

  it('asks for the authenticator code after a correct password', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    const user = userEvent.setup();
    render(<App />);

    await signInWithPassword(user);

    expect(await screen.findByLabelText('Code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('signs in with the code and sends the challenge from step one', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    reply('/auth/mfa', ok({ user: USER }));
    const user = userEvent.setup();
    render(<App />);
    await signInWithPassword(user);

    await user.type(await screen.findByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Signed in as ops@lushware.test')).toBeInTheDocument();
    const mfaCall = calls.find((c) => c.url.endsWith('/auth/mfa'))!;
    expect(JSON.parse(String(mfaCall.init.body))).toEqual({ challenge: 'chal.sig', code: '123456' });
    expect(mfaCall.init.credentials).toBe('include');
  });

  it('shows the server message for a wrong password and stays on step one', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', fail(401, 'Email or password is incorrect.'));
    const user = userEvent.setup();
    render(<App />);

    await signInWithPassword(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('clears a wrong code so it can be retyped', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    reply('/auth/mfa', fail(401, 'That code is incorrect or has expired.'));
    const user = userEvent.setup();
    render(<App />);
    await signInWithPassword(user);

    await user.type(await screen.findByLabelText('Code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is incorrect or has expired.');
    expect(screen.getByLabelText('Code')).toHaveValue('');
  });

  it('returns to the password step when the sign-in has expired', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    reply('/auth/mfa', fail(401, 'Your sign-in has expired. Please start again.'));
    const user = userEvent.setup();
    render(<App />);
    await signInWithPassword(user);

    await user.type(await screen.findByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
  });

  it('only accepts digits in the code box', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    const user = userEvent.setup();
    render(<App />);
    await signInWithPassword(user);

    await user.type(await screen.findByLabelText('Code'), '12ab34');

    expect(screen.getByLabelText('Code')).toHaveValue('1234');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('signs out and returns to the sign-in form', async () => {
    reply('/auth/me', ok({ user: USER }));
    reply('/auth/logout', ok({}));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Sign out/ }));

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
    expect(calls.some((c) => c.url.endsWith('/auth/logout') && c.init.method === 'POST')).toBe(true);
  });

  it('explains when the server cannot be reached', async () => {
    reply('/auth/me', fail(401, 'x'));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('Email');
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await signInWithPassword(user);

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server.");
  });
});

describe('own password', () => {
  const TEMP_USER = { ...USER, mustChangePassword: true };

  const fillPasswords = async (user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm = next) => {
    await user.type(await screen.findByLabelText(/Temporary password|Current password/), current);
    await user.type(screen.getByLabelText('New password'), next);
    await user.type(screen.getByLabelText('Confirm new password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Save password' }));
  };

  it('shows only the set-your-own-password screen while the password is temporary', async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Set your own password' })).toBeInTheDocument();
    expect(screen.queryByText('Signed in as ops@lushware.test')).not.toBeInTheDocument();
  });

  it('goes to the set-your-own-password screen straight after a sign-in with a temporary password', async () => {
    reply('/auth/me', fail(401, 'x'));
    reply('/auth/login', ok({ mfaRequired: true, challenge: 'chal.sig' }));
    reply('/auth/mfa', ok({ user: TEMP_USER }));
    const user = userEvent.setup();
    render(<App />);
    await signInWithPassword(user);

    await user.type(await screen.findByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Set your own password' })).toBeInTheDocument();
  });

  it('opens the console once the new password is saved', async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));
    reply('/auth/change-password', ok({ user: { ...USER, mustChangePassword: false } }));
    const user = userEvent.setup();
    render(<App />);

    await fillPasswords(user, 'Temp-Pass-9a', 'blue-train-sunset-2026');

    expect(await screen.findByText('Signed in as ops@lushware.test')).toBeInTheDocument();
    const call = calls.find((c) => c.url.endsWith('/auth/change-password'))!;
    expect(JSON.parse(String(call.init.body))).toEqual({ currentPassword: 'Temp-Pass-9a', newPassword: 'blue-train-sunset-2026' });
  });

  it('refuses mismatched new passwords without asking the server', async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));
    const user = userEvent.setup();
    render(<App />);

    await fillPasswords(user, 'Temp-Pass-9a', 'blue-train-sunset-2026', 'blue-train-sunset-2027');

    expect(await screen.findByRole('alert')).toHaveTextContent("The new passwords don't match.");
    expect(calls.some((c) => c.url.endsWith('/auth/change-password'))).toBe(false);
  });

  it('refuses a too-short new password without asking the server', async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));
    const user = userEvent.setup();
    render(<App />);

    await fillPasswords(user, 'Temp-Pass-9a', 'short');

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 12 characters.');
    expect(calls.some((c) => c.url.endsWith('/auth/change-password'))).toBe(false);
  });

  it("shows the server's reason when it refuses the new password", async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));
    reply('/auth/change-password', fail(400, 'That password is too easy to guess. Try a longer phrase.'));
    const user = userEvent.setup();
    render(<App />);

    await fillPasswords(user, 'Temp-Pass-9a', 'Password2026!!');

    expect(await screen.findByRole('alert')).toHaveTextContent('too easy to guess');
  });

  it('offers only signing out, not skipping, on the required screen', async () => {
    reply('/auth/me', ok({ user: TEMP_USER }));
    reply('/auth/logout', ok({}));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('lets a signed-in person change their password and come back', async () => {
    reply('/auth/me', ok({ user: USER }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Change password/ }));
    expect(await screen.findByLabelText('Current password')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Signed in as ops@lushware.test')).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { parseRoute } from '../../lib/route';

const ADMIN = { id: 'u-1', email: 'ops@lushware.test', name: 'Ops', role: 'platform_admin' };
const SUPPORT = { ...ADMIN, role: 'support' };
const ACME_ID = '00000000-0000-4000-8000-000000000002';
const PLAN_VERSION_ID = '00000000-0000-4000-8000-000000000011';
const catalog = [{
  id: '00000000-0000-4000-8000-000000000010', key: 'starter', archivedAt: null, createdAt: '2026-01-01',
  versions: [{
    id: PLAN_VERSION_ID, planId: '00000000-0000-4000-8000-000000000010', version: 1, name: 'Starter',
    description: null, priceMinorUnits: null, currency: 'USD', billingInterval: 'monthly',
    entitlements: { staff_seats: 5, packages: 20, features: { ai_itinerary_builder: true } },
    isCurrent: true, assignments: 0,
  }],
}];

const row = (over = {}) => ({
  id: ACME_ID, name: 'Acme Tours', slug: 'acme-tours', status: 'active', createdAt: '2026-10-01T00:00:00Z',
  ownerName: 'Nuwan J', ownerEmail: 'nuwan@acme.test', staff: 23, admins: 3, salesReps: 8, vendors: 12,
  lastActivityAt: null, ...over,
});
const detail = (over = {}) => ({
  agency: { id: ACME_ID, name: 'Acme Tours', slug: 'acme-tours', status: 'active', region: 'ap-southeast-1', createdAt: '2026-10-01T00:00:00Z' },
  isPublicSite: false,
  people: { total: 23, byRole: { owners: 1, admins: 2, salesReps: 8, vendors: 12 }, byStatus: { active: 23, invited: 0, suspended: 0 } },
  owners: [{ name: 'Nuwan J', email: 'nuwan@acme.test', status: 'active', lastLogin: null }],
  usage: { leads: { total: 152, thisMonth: 2 }, quotations: { total: 66, thisMonth: 9 }, invoices: { total: 36, thisMonth: 0 }, bookings: { total: 26, thisMonth: 3 }, packages: { total: 18, thisMonth: 18 } },
  activity: { lastActivityAt: null, activeUsers7d: 2, activeUsers30d: 4 },
  setup: { companyDetails: true, logo: false, bankDetails: true },
  history: [],
  plan: { assignment: null, overrides: [], resolved: {
    plan: null, entitlements: { staff_seats: null, packages: null, features: { ai_itinerary_builder: true } }, source: {},
  } },
  ...over,
});

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };
let handler: Handler;
const calls: { url: string; init: RequestInit }[] = [];
const ok = (data: unknown, pagination?: unknown) => ({ status: 200, body: { status: 'success', data, ...(pagination ? { pagination } : {}) } });

beforeEach(() => {
  calls.length = 0;
  window.location.hash = '';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

const serve = ({ me = ADMIN, rows = [row()], total = rows.length, pages = 1, agency = detail(), onPost }: {
  me?: object; rows?: object[]; total?: number; pages?: number; agency?: object;
  onPost?: (url: string, body: unknown) => { status: number; body: unknown };
} = {}) => {
  handler = (url, init) => {
    if (url.endsWith('/auth/me')) return ok({ user: me });
    if (['POST', 'PUT', 'DELETE'].includes(init.method ?? '') && onPost) return onPost(url, JSON.parse(String(init.body ?? '{}')));
    if (url.endsWith('/plans')) return ok(catalog);
    if (/\/agencies\/[0-9a-f-]{36}$/.test(url)) return ok(agency);
    if (url.includes('/agencies?')) return ok(rows, { page: 1, limit: 25, total, pages });
    return { status: 404, body: { message: 'not found' } };
  };
};

const open = async (hash: string) => {
  window.location.hash = hash;
  render(<App />);
};

describe('routes', () => {
  it.each([
    ['', { page: 'overview' }],
    ['#/agencies', { page: 'agencies' }],
    [`#/agencies/${ACME_ID}`, { page: 'agency', id: ACME_ID }],
    ['#/agencies/not-an-id', { page: 'agencies' }],
    ['#/unknown', { page: 'overview' }],
  ])('reads %j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});

describe('agency plans on the list', () => {
  it("shows each agency's plan", async () => {
    serve({ rows: [row({ planName: 'Growth' })] });

    await open('#/agencies');

    expect((await screen.findAllByText('Growth')).length).toBeGreaterThan(0);
    expect(screen.queryByText('No plan')).not.toBeInTheDocument();
  });

  it('flags an agency without a plan, which gets everything unlimited', async () => {
    serve({ rows: [row({ planName: null })] });

    await open('#/agencies');

    expect((await screen.findAllByText('No plan')).length).toBeGreaterThan(0);
  });
});

describe('agencies list', () => {
  it('shows each agency with its status, owner and staff breakdown', async () => {
    serve();

    await open('#/agencies');

    const link = await screen.findByRole('link', { name: 'More details' });
    expect(link).toHaveAttribute('href', `#/agencies/${ACME_ID}`);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('nuwan@acme.test').length).toBeGreaterThan(0);
    expect(screen.getByText('3 admin · 8 reps · 12 vendors')).toBeInTheDocument();
    expect(screen.getByText('1 agency')).toBeInTheDocument();
  });

  it('opens agency details from the details link and the rest of the row', async () => {
    serve();
    const user = userEvent.setup();
    await open('#/agencies');

    const detailsLink = await screen.findByRole('link', { name: 'More details' });
    expect(detailsLink).toHaveAttribute('href', `#/agencies/${ACME_ID}`);
    await user.click(detailsLink);
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Tours' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'All agencies' }));
    await screen.findByRole('link', { name: 'More details' });

    await user.click(screen.getAllByText('nuwan@acme.test')[0].closest('td')!);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Tours' })).toBeInTheDocument();
  });

  it('asks the server for the chosen status and sort', async () => {
    serve();
    const user = userEvent.setup();
    await open('#/agencies');
    await screen.findByRole('link', { name: 'More details' });

    await user.selectOptions(screen.getByLabelText('Status'), 'suspended');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'activity');

    await waitFor(() => expect(calls.at(-1)!.url).toMatch(/status=suspended/));
    expect(calls.at(-1)!.url).toMatch(/sort=activity/);
    expect(calls.at(-1)!.url).toMatch(/page=1/);
  });

  it('searches once typing pauses', async () => {
    serve();
    const user = userEvent.setup();
    await open('#/agencies');
    await screen.findByRole('link', { name: 'More details' });

    await user.type(screen.getByLabelText('Search agencies'), 'globe');

    await waitFor(() => expect(calls.at(-1)!.url).toMatch(/search=globe/));
  });

  it('pages through a long list', async () => {
    serve({ total: 60, pages: 3 });
    const user = userEvent.setup();
    await open('#/agencies');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(calls.at(-1)!.url).toMatch(/page=2/));
  });

  it('says when no agency matches', async () => {
    serve({ rows: [] });

    await open('#/agencies');

    expect(await screen.findByText('No agencies yet.')).toBeInTheDocument();
  });
});

describe('agency detail', () => {
  it('shows people, usage, activity and setup as counts', async () => {
    serve();

    await open(`#/agencies/${ACME_ID}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Tours' })).toBeInTheDocument();
    expect(screen.getByText('152')).toBeInTheDocument();
    expect(screen.getByText('2 this month')).toBeInTheDocument();
    expect(screen.getByText('Logo uploaded').parentElement).toHaveTextContent('not done');
    expect(screen.getByText('Bank details added').parentElement).toHaveTextContent('done');
    expect(screen.getByText('nuwan@acme.test')).toBeInTheDocument();
  });

  it('suspends only after a reason and the agency short name are given', async () => {
    let posted: { url: string; body: unknown } | null = null;
    serve({ onPost: (url, body) => { posted = { url, body }; return ok({ agency: { status: 'suspended' } }); } });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.click(await screen.findByRole('button', { name: /Suspend/ }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Suspend agency' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Unpaid for 60 days');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/to confirm/), 'acme-tours');
    await user.click(confirm);

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.url).toMatch(new RegExp(`/agencies/${ACME_ID}/suspend$`));
    expect(posted!.body).toEqual({ reason: 'Unpaid for 60 days' });
    expect(await screen.findByRole('status')).toHaveTextContent('Agency suspended');
  });

  it('keeps the dialog open and shows why when the server refuses', async () => {
    serve({ onPost: () => ({ status: 409, body: { message: 'This agency changed while you were looking at it. Refresh and try again.' } }) });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);
    await user.click(await screen.findByRole('button', { name: /Suspend/ }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Reason'), 'Unpaid for 60 days');
    await user.type(within(dialog).getByLabelText(/to confirm/), 'acme-tours');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend agency' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('changed while you were looking');
  });

  it('offers Restore, not Suspend, for a suspended agency', async () => {
    serve({ agency: detail({ agency: { ...detail().agency, status: 'suspended' } }) });

    await open(`#/agencies/${ACME_ID}`);

    expect(await screen.findByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
  });

  it('offers no suspend for the agency that runs the public website', async () => {
    serve({ agency: detail({ isPublicSite: true }) });

    await open(`#/agencies/${ACME_ID}`);

    expect(await screen.findByText(/runs the public website/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
  });

  it('shows support staff the agency without suspend or restore', async () => {
    serve({ me: SUPPORT });

    await open(`#/agencies/${ACME_ID}`);

    expect(await screen.findByText('152')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
  });

  it('assigns a plan version only after a reason is entered', async () => {
    const writes: { url: string; body: unknown }[] = [];
    serve({ onPost: (url, body) => { writes.push({ url, body }); return ok({}); } });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.selectOptions(await screen.findByLabelText('Plan version'), PLAN_VERSION_ID);
    await user.type(screen.getByPlaceholderText('Why is this plan changing?'), 'Approved by account lead');
    await user.click(screen.getByRole('button', { name: /Assign/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].url).toMatch(new RegExp(`/agencies/${ACME_ID}/plan$`));
    expect(writes[0].body).toEqual({ planVersionId: PLAN_VERSION_ID, reason: 'Approved by account lead' });
  });

  it('saves an agency-specific entitlement override with its reason', async () => {
    const writes: { url: string; body: unknown }[] = [];
    serve({ onPost: (url, body) => { writes.push({ url, body }); return ok({}); } });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.selectOptions(await screen.findByLabelText('Override'), 'staff_seats');
    await user.type(screen.getByLabelText('Value'), '8');
    await user.type(screen.getByPlaceholderText('Why is this exception needed?'), 'Temporary extra seats');
    await user.click(screen.getByRole('button', { name: /Save override/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].url).toMatch(new RegExp(`/agencies/${ACME_ID}/overrides/staff_seats$`));
    expect(writes[0].body).toEqual({ value: 8, reason: 'Temporary extra seats' });
  });
});

describe('help access', () => {
  const fakeTab = () => {
    const tab = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    return tab;
  };

  it('opens Management in a new tab with the one-time link after recording the reason', async () => {
    const tab = fakeTab();
    let posted: unknown = null;
    serve({ onPost: (_url, body) => { posted = body; return { status: 201, body: { status: 'success', data: { grantId: 'g-1', expiresAt: '2026-11-11T10:30:00Z', code: 'abc_DEF-123' } } }; } });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.click(await screen.findByRole('button', { name: /Help this agency/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Invoice PDF shows wrong bank');
    await user.click(within(dialog).getByLabelText('15 minutes'));
    await user.click(within(dialog).getByRole('button', { name: /Open view-only/ }));

    await waitFor(() => expect(tab.location.href).toBe('http://localhost:3000/api/v1/auth/help-access/redeem?code=abc_DEF-123'));
    expect(posted).toEqual({ reason: 'Invoice PDF shows wrong bank', minutes: 15 });
    expect(tab.opener).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent('opened in a new tab for 15 minutes');
  });

  it('closes the blank tab and explains when the server refuses', async () => {
    const tab = fakeTab();
    serve({ onPost: () => ({ status: 409, body: { message: 'This agency is being deleted and cannot be opened.' } }) });
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.click(await screen.findByRole('button', { name: /Help this agency/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Invoice PDF shows wrong bank');
    await user.click(within(dialog).getByRole('button', { name: /Open view-only/ }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('being deleted');
    expect(tab.close).toHaveBeenCalled();
  });

  it('needs a reason before it can open', async () => {
    serve();
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);

    await user.click(await screen.findByRole('button', { name: /Help this agency/ }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: /Open view-only/ })).toBeDisabled();
  });

  it('says how many more characters the reason needs', async () => {
    serve();
    const user = userEvent.setup();
    await open(`#/agencies/${ACME_ID}`);
    await user.click(await screen.findByRole('button', { name: /Help this agency/ }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Reason'), 'test');

    expect(within(dialog).getByText('Write at least 5 characters (1 more).')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), 'ing');
    expect(within(dialog).getByRole('button', { name: /Open view-only/ })).toBeEnabled();
  });

  it('is available to support staff too', async () => {
    serve({ me: SUPPORT });

    await open(`#/agencies/${ACME_ID}`);

    expect(await screen.findByRole('button', { name: /Help this agency/ })).toBeInTheDocument();
  });
});

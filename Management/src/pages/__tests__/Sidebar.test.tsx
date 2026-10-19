import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockUseAuth,
  mockUsePermission,
  mockNavigate,
  mockGetOrganizationBranding,
  mockUseLocation,
  mockAppearanceToggleProps,
} = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUsePermission: vi.fn(),
  mockNavigate: vi.fn(),
  mockGetOrganizationBranding: vi.fn(),
  mockUseLocation: vi.fn(),
  mockAppearanceToggleProps: { current: null as { collapsed?: boolean } | null },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockUseLocation(),
}));

vi.mock('../../contexts/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../../contexts/PermissionContext', () => ({ usePermission: mockUsePermission }));
vi.mock('../../services/api', () => ({ adminAPI: { getOrganizationBranding: mockGetOrganizationBranding } }));
vi.mock('@/lib/toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
// AppearanceToggle needs a ThemeProvider ancestor and isn't the concern of
// this test file (see AppearanceToggle.test.tsx) — stub it out, but record the
// props so the sidebar's collapsed wiring stays observable.
vi.mock('../../components/AppearanceToggle', () => ({
  default: (props: { collapsed?: boolean }) => {
    mockAppearanceToggleProps.current = props;
    return <div>Appearance</div>;
  },
}));

import toast from '@/lib/toast';
import Sidebar from '../Sidebar';
import { deferred } from '../../test/deferred';
import { getSidebarInfo, getLoginBranding } from '../../config/branding';

const STORAGE_KEY = 'management-sidebar-open';
const SIDEBAR_BRAND_NAME = 'Travel Cloud';
// Values resolved from the real config (env-driven), so assertions stay valid
// if the company name/logo is re-branded again.
const FALLBACK = getSidebarInfo();
const ADMIN = { name: 'Alice Admin', role: 'admin', isSuperAdmin: false };

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
}

type LogoutFn = () => Promise<unknown>;

function setUser(user: Record<string, unknown> | undefined, logout: LogoutFn = vi.fn()) {
  mockUseAuth.mockReturnValue({ user, logout });
  return logout;
}

function setPermissions(hasPermission: (perm: string) => boolean) {
  mockUsePermission.mockReturnValue({ hasPermission });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setViewportWidth(1280);
  mockUseLocation.mockReturnValue({ pathname: '/' });
  mockAppearanceToggleProps.current = null;
  setUser(ADMIN);
  setPermissions(() => true);
  mockGetOrganizationBranding.mockResolvedValue({ status: 'success', data: { branding: null } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Sidebar collapse state', () => {
  it('stays expanded after clicking a nav item', async () => {
    const user = userEvent.setup();
    const { container } = render(<Sidebar />);

    await user.click(screen.getByTitle('Dashboard'));

    expect(container.firstChild).toHaveClass('w-56');
    expect(screen.getByText('Dashboard')).toHaveClass('text-[13px]');
  });

  it('collapses when Ctrl+B is pressed, and expands again on a second press', () => {
    const { container } = render(<Sidebar />);

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(container.firstChild).toHaveClass('w-20');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(container.firstChild).toHaveClass('w-56');
  });

  it('persists the collapsed state to localStorage and restores it on remount', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<Sidebar />);

    await user.click(screen.getByLabelText('Collapse sidebar'));

    expect(container.firstChild).toHaveClass('w-20');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');

    unmount();
    const { container: container2 } = render(<Sidebar />);
    expect(container2.firstChild).toHaveClass('w-20');
  });

  it('does not let a mobile session overwrite the desktop-persisted preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setViewportWidth(500);

    render(<Sidebar />);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });
});

describe('Sidebar brand header', () => {
  it('renders the static brand fallback while org branding is still loading', () => {
    const { promise } = deferred<never>();
    mockGetOrganizationBranding.mockReturnValue(promise);

    render(<Sidebar />);

    expect(screen.getByRole('heading', { name: SIDEBAR_BRAND_NAME })).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', FALLBACK.logoUrl);
  });

  it('keeps the sidebar name fixed when organization branding resolves', async () => {
    mockGetOrganizationBranding.mockResolvedValue({
      status: 'success',
      data: {
        branding: {
          companyName: 'Acme Travel Group',
          companyShortName: 'XZ',
          logoUrl: 'https://cdn.example.com/acme.png',
        },
      },
    });

    const { container } = render(<Sidebar />);

    expect(await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Acme Travel Group' })).not.toBeInTheDocument();
    // The icon ships with the app: an org logo URL is never rendered, so the
    // rail cannot break on a remote asset that is missing or unreachable.
    expect(container.querySelector('img')).toHaveAttribute('src', FALLBACK.logoUrl);
    expect(container.querySelector('img')).toHaveAttribute('alt', SIDEBAR_BRAND_NAME);
  });

  it('shows only the app logo when the sidebar is collapsed', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'false');
    mockGetOrganizationBranding.mockResolvedValue({
      status: 'success',
      data: { branding: { companyName: 'Zenith Holidays', companyShortName: 'XZ' } },
    });

    const { container } = render(<Sidebar />);

    expect(await screen.findByRole('img', { name: SIDEBAR_BRAND_NAME })).toHaveAttribute('src', FALLBACK.logoUrl);
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.queryByText('XZ')).not.toBeInTheDocument();
  });

  it('keeps the static fallback when branding is rejected, unsuccessful, or settles after unmount', async () => {
    mockGetOrganizationBranding.mockRejectedValue(new Error('network down'));
    const rejected = render(<Sidebar />);
    expect(await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME })).toBeInTheDocument();
    rejected.unmount();

    mockGetOrganizationBranding.mockResolvedValue({ status: 'error' });
    const unsuccessful = render(<Sidebar />);
    expect(await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME })).toBeInTheDocument();
    unsuccessful.unmount();

    type BrandingResponse = { status: string; data: { branding: { companyName: string } } };
    const lateBranding = deferred<BrandingResponse>();
    mockGetOrganizationBranding.mockReturnValue(lateBranding.promise);
    const late = render(<Sidebar />);
    late.unmount();
    lateBranding.resolve({ status: 'success', data: { branding: { companyName: 'Late Org' } } });
    await act(async () => {
      await lateBranding.promise;
    });
    expect(screen.queryByText('Late Org')).not.toBeInTheDocument();
  });

  it('regression: renders the fixed sidebar name but never a tagline in the rail', async () => {
    mockGetOrganizationBranding.mockResolvedValue({
      status: 'success',
      data: { branding: { companyName: 'Acme Travel Group', tagline: 'Acme, forever' } },
    });

    render(<Sidebar />);

    const heading = await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME });
    expect(heading.textContent).toBe(SIDEBAR_BRAND_NAME);
    // Neither the org-supplied tagline nor the static config tagline is shown.
    expect(screen.queryByText('Acme, forever')).not.toBeInTheDocument();
    expect(screen.queryByText(getLoginBranding().tagline)).toBeNull();
    // getSidebarInfo() dropped the field; the login screen still exposes one.
    expect(getSidebarInfo()).not.toHaveProperty('tagline');
    expect(getLoginBranding()).toHaveProperty('tagline');
  });

  it('navigates to /settings from the brand block when the role may edit org settings', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const heading = await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME });
    expect(screen.getByTitle('Organization Settings')).toBeEnabled();

    await user.click(heading);

    expect(mockNavigate).toHaveBeenCalledWith('/settings');
  });

  it('gates the brand block on org-settings rights', async () => {
    const user = userEvent.setup();

    setUser({ name: 'Sam Rep', role: 'salesRep', isSuperAdmin: false });
    const rep = render(<Sidebar />);

    expect(screen.getByTitle('Company logo')).toBeDisabled();
    const repHeading = await screen.findByRole('heading', { name: SIDEBAR_BRAND_NAME });
    expect(repHeading.closest('button')).toBeDisabled();

    await user.click(repHeading);
    expect(mockNavigate).not.toHaveBeenCalled();
    rep.unmount();

    // `isSuperAdmin` alone is enough, even without the admin role.
    setUser({ name: 'Root', role: 'salesRep', isSuperAdmin: true });
    render(<Sidebar />);
    expect(await screen.findByTitle('Organization Settings')).toBeEnabled();
  });
});

describe('Sidebar navigation', () => {
  it('centers collapsed navigation and logout icons in consistent square controls', () => {
    window.localStorage.setItem(STORAGE_KEY, 'false');
    render(<Sidebar />);

    expect(screen.getByTitle('Dashboard')).toHaveClass('h-9', 'w-9', 'justify-center');
    expect(screen.getByTitle('Dashboard')).not.toHaveClass('px-4');
    expect(screen.getByTitle('Sign Out')).toHaveClass('h-9', 'w-9', 'justify-center', 'p-0');
    expect(screen.getByTitle('Sign Out').parentElement).toHaveClass('flex-col', 'items-center', 'gap-1');
    expect(mockAppearanceToggleProps.current?.collapsed).toBe(true);
    expect(screen.getByLabelText('Expand sidebar from navigation')).toBeInTheDocument();
  });

  it('expands from the control below the collapsed navigation icons', () => {
    window.localStorage.setItem(STORAGE_KEY, 'false');
    const { container } = render(<Sidebar />);

    fireEvent.click(screen.getByLabelText('Expand sidebar from navigation'));

    expect(container.firstChild).toHaveClass('w-56');
  });

  it('orders Leads directly beneath Dashboard', async () => {
    // The order is the feature: agents never see Dashboard, so whatever sits
    // directly beneath it becomes the first item in their sidebar.
    render(<Sidebar />);

    const nav = await screen.findByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('button[title]')).map((b) => b.getAttribute('title'));

    expect(labels[0]).toBe('Dashboard');
    expect(labels[1]).toBe('Leads');
  });

  it('orders Analytics directly beneath Billing', async () => {
    render(<Sidebar />);

    const nav = await screen.findByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('button[title]')).map((b) => b.getAttribute('title'));

    expect(labels.indexOf('Analytics')).toBe(labels.indexOf('Billing') + 1);
  });

  it('navigates when a nav item is clicked and marks the active route', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Sidebar />);

    await user.click(screen.getByTitle('Analytics'));
    expect(mockNavigate).toHaveBeenCalledWith('/analytics');

    mockUseLocation.mockReturnValue({ pathname: '/analytics' });
    rerender(<Sidebar />);

    expect(screen.getByTitle('Analytics')).toHaveClass('bg-sidebar-primary');
    expect(screen.getByTitle('Dashboard')).not.toHaveClass('bg-sidebar-primary');
  });

  it('filters navigation by role and permission for a sales rep', async () => {
    setUser({ name: 'Sam Rep', role: 'salesRep', isSuperAdmin: false });
    setPermissions(() => false);

    render(<Sidebar />);

    for (const label of ['Leads', 'Packages', 'Flights', 'Hotels']) {
      expect(await screen.findByTitle(label)).toBeInTheDocument();
    }
    // An agent has no Dashboard: it is hidden here, and HomeRoute lands them on
    // Leads so they never open on a page their own sidebar does not list.
    for (const label of ['Dashboard', 'Analytics', 'Billing', 'Users', 'Career', 'Settings']) {
      expect(screen.queryByTitle(label)).not.toBeInTheDocument();
    }
  });

  it('shows super-admin items and hides sales-only items for a super admin', async () => {
    setUser({ name: 'Root', role: 'superAdmin', isSuperAdmin: true });
    setPermissions(() => false);

    render(<Sidebar />);

    for (const label of ['Dashboard', 'Packages', 'Flights', 'Hotels', 'Career', 'Settings']) {
      expect(await screen.findByTitle(label)).toBeInTheDocument();
    }
    for (const label of ['Analytics', 'Leads', 'Billing', 'Users']) {
      expect(screen.queryByTitle(label)).not.toBeInTheDocument();
    }
  });

  it('requires manage_packages for an admin to see Packages and any user permission for Users', async () => {
    setPermissions((perm) => perm === 'manage_vendors');
    const vendorManager = render(<Sidebar />);

    expect(await screen.findByTitle('Users')).toBeInTheDocument();
    expect(screen.queryByTitle('Packages')).not.toBeInTheDocument();
    vendorManager.unmount();

    setPermissions((perm) => perm === 'manage_packages');
    render(<Sidebar />);

    expect(await screen.findByTitle('Packages')).toBeInTheDocument();
    expect(screen.queryByTitle('Users')).not.toBeInTheDocument();
  });

  it('shows no navigation items when there is no user', async () => {
    // Every item now sits behind a role or permission gate, so an unresolved
    // user gets an empty menu rather than a default entry — fail closed. The
    // app only renders the sidebar for an authenticated user anyway.
    setUser(undefined);
    setPermissions(() => false);

    render(<Sidebar />);

    for (const label of ['Dashboard', 'Analytics', 'Leads', 'Packages', 'Flights', 'Hotels', 'Billing', 'Users', 'Career', 'Settings']) {
      expect(screen.queryByTitle(label)).not.toBeInTheDocument();
    }
  });
});

describe('Sidebar user card', () => {
  it('renders the user name and avatar for each role', async () => {
    setUser({ name: 'Root', role: 'superAdmin', isSuperAdmin: true });
    const superAdmin = render(<Sidebar />);

    expect(await screen.findByText('Root')).toBeInTheDocument();
    expect(screen.getByText('R', { exact: true })).toBeInTheDocument();
    superAdmin.unmount();

    setUser({ name: 'Alice Admin', role: 'admin', isSuperAdmin: false });
    const admin = render(<Sidebar />);
    expect(await screen.findByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('A', { exact: true })).toBeInTheDocument();
    admin.unmount();

    setUser({ name: 'Sam Rep', role: 'salesRep', isSuperAdmin: false });
    const rep = render(<Sidebar />);
    expect(await screen.findByText('Sam Rep')).toBeInTheDocument();
    expect(screen.getByText('S', { exact: true })).toBeInTheDocument();
    rep.unmount();

    setUser({ name: '', role: 'admin', isSuperAdmin: false });
    render(<Sidebar />);
    expect(await screen.findByText('U')).toBeInTheDocument();
  });

  it('hides the user card when the rail is collapsed', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'false');

    render(<Sidebar />);

    expect(await screen.findByTitle('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('does not render a time-based greeting in the user card', () => {
    render(<Sidebar />);

    expect(screen.queryByText(/good morning|good afternoon|good evening/i)).not.toBeInTheDocument();
  });
});

describe('Sidebar keyboard and mobile drawer', () => {
  it('toggles with Ctrl/Cmd+B, ignores other keys, and persists the choice', () => {
    const { container } = render(<Sidebar />);

    expect(screen.getByLabelText('Collapse sidebar')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(container.firstChild).toHaveClass('w-20');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(container.firstChild).toHaveClass('w-20');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(container.firstChild).toHaveClass('w-56');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('does not bind the keyboard shortcut on a mobile viewport', () => {
    setViewportWidth(500);

    render(<Sidebar />);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('opens and closes the mobile drawer from the hamburger, overlay, close button, nav, and route changes', async () => {
    const user = userEvent.setup();
    setViewportWidth(500);
    const { container, rerender } = render(<Sidebar />);

    const drawer = () => container.querySelector('.fixed.top-0.left-0') as HTMLElement;
    expect(drawer()).toHaveClass('-translate-x-full');

    await user.click(screen.getByLabelText('Open menu'));
    expect(drawer()).toHaveClass('translate-x-0');
    expect(screen.queryByLabelText('Open menu')).not.toBeInTheDocument();

    await user.click(container.querySelector('.fixed.inset-0') as HTMLElement);
    expect(drawer()).toHaveClass('-translate-x-full');

    await user.click(screen.getByLabelText('Open menu'));
    await user.click(container.querySelector('button.ml-auto') as HTMLElement);
    expect(drawer()).toHaveClass('-translate-x-full');

    await user.click(screen.getByLabelText('Open menu'));
    await user.click(screen.getByTitle('Dashboard'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(drawer()).toHaveClass('-translate-x-full');

    // Opening Org Settings from the brand block closes the drawer too.
    mockNavigate.mockClear();
    await user.click(screen.getByLabelText('Open menu'));
    await user.click(screen.getByRole('heading', { name: SIDEBAR_BRAND_NAME }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(drawer()).toHaveClass('-translate-x-full');

    await user.click(screen.getByLabelText('Open menu'));
    expect(drawer()).toHaveClass('translate-x-0');
    mockUseLocation.mockReturnValue({ pathname: '/leads' });
    rerender(<Sidebar />);
    expect(drawer()).toHaveClass('-translate-x-full');
  });
});

describe('Sidebar footer actions', () => {
  it('signs out, disables the button while in flight, and reports a failed logout', async () => {
    const user = userEvent.setup();

    setUser(ADMIN, vi.fn().mockResolvedValue(undefined));
    const success = render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
    success.unmount();

    const pendingLogout = deferred<void>();
    setUser(ADMIN, vi.fn(() => pendingLogout.promise));
    const pending = render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
    pendingLogout.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign Out' })).toBeEnabled());
    pending.unmount();

    mockNavigate.mockClear();
    setUser(ADMIN, vi.fn().mockRejectedValue(new Error('boom')));
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Logout failed'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('passes the collapsed flag to the appearance toggle and hides the Sign Out label', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    expect(mockAppearanceToggleProps.current?.collapsed).toBe(false);
    expect(screen.getByTitle('Sign Out').textContent).toBe('Sign Out');

    await user.click(screen.getByLabelText('Collapse sidebar'));

    expect(mockAppearanceToggleProps.current?.collapsed).toBe(true);
    expect(screen.getByTitle('Sign Out').textContent).toBe('');
  });
});

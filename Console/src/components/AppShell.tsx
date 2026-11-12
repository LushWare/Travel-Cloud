import { useState, type ComponentType, type ReactNode } from 'react';
import { Building2, CreditCard, KeyRound, LayoutDashboard, LogOut, Menu, ShieldCheck, Users, X } from 'lucide-react';
import type { PlatformUser } from '../lib/api';
import { BrandMark } from './AuthCard';
import { Button } from './ui/button';

export const ROLE_LABEL: Record<PlatformUser['role'], string> = { platform_admin: 'Platform admin', support: 'Support' };

type NavItem = { id: string; label: string; href: string; icon: ComponentType<{ className?: string }> };
// Each console part adds its page here (Help access, Staff).
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', href: '#/', icon: LayoutDashboard },
  { id: 'agencies', label: 'Agencies', href: '#/agencies', icon: Building2 },
  { id: 'plans', label: 'Plans', href: '#/plans', icon: CreditCard },
  { id: 'staff', label: 'Staff', href: '#/staff', icon: Users },
];

type Props = {
  user: PlatformUser;
  active: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onChangePassword: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

/** The same sidebar + page-header layout as Management, so staff move between the two without relearning. */
export default function AppShell({ user, active, title, subtitle, actions, onChangePassword, onSignOut, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (
    <aside className="flex h-full w-56 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 border-b border-sidebar-border p-3">
        <BrandMark className="h-9 w-9" />
        <span className="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-sidebar-foreground">Lush Console</span>
        <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu"
          className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent md:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Console">
        {NAV.filter((item) => item.id !== 'staff' || user.role === 'platform_admin').map((item) => {
          const isActive = item.id === active;
          return (
            <a key={item.id} href={item.href} aria-current={isActive ? 'page' : undefined}
              onClick={() => setMobileOpen(false)}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors ${isActive
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent'}`}>
              <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-sidebar-primary-foreground' : 'text-muted-foreground'}`} />
              <span className="text-[13px] font-medium">{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="rounded-lg bg-sidebar-accent p-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground">
              {user.name?.charAt(0)?.toUpperCase() || 'U'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{ROLE_LABEL[user.role] ?? user.role}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2 p-3 pt-0">
        <Button variant="outline" onClick={onChangePassword} className="h-10 w-full justify-start gap-3 px-4">
          <KeyRound className="h-4 w-4" />
          Change password
        </Button>
        <Button variant="destructive" onClick={onSignOut} className="h-10 w-full justify-start gap-3 px-4">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-background">
      <div className="hidden md:block">{sidebar}</div>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed top-0 left-0 z-50 h-full md:hidden">{sidebar}</div>
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur-lg">
          <div className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu"
              className="rounded-lg border border-border p-2 text-muted-foreground hover:text-primary md:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 py-1">
              <h1 className="truncate font-heading text-lg font-bold text-foreground sm:text-xl">{title}</h1>
              {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

import { ArrowRight, Building2, LifeBuoy, ShieldCheck, Users } from 'lucide-react';
import type { PlatformUser } from '../lib/api';
import AppShell, { ROLE_LABEL } from '../components/AppShell';

type Props = { user: PlatformUser; onSignOut: () => void; onChangePassword: () => void };

const TOOLS = [
  { icon: LifeBuoy, title: 'Help access', href: '#/agencies', text: 'Open an agency to start a timed, view-only help session.' },
  { icon: Users, title: 'Staff', href: '#/staff', adminOnly: true, text: 'Invite staff, manage roles, reset authenticators, or remove accounts.' },
];

export default function Home({ user, onSignOut, onChangePassword }: Props) {
  return (
    <AppShell user={user} active="overview" title="Overview" subtitle="Platform administration"
      onChangePassword={onChangePassword} onSignOut={onSignOut}>
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold break-words">Signed in as {user.email}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ROLE_LABEL[user.role] ?? user.role} · Your session ends after 30 minutes without activity.
            </p>
          </div>
        </div>
      </section>

      <a href="#/agencies" className="group mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40">
        <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold">Agencies</p>
          <p className="text-sm text-muted-foreground">Every agency with its status, staff and usage; suspend or restore.</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </a>

      <h2 className="mt-8 mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Tools</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.filter(({ adminOnly }) => !adminOnly || user.role === 'platform_admin').map(({ icon: Icon, title, href, text }) => (
          <a key={title} href={href} className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-heading text-sm font-semibold">{title}</h3>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
          </a>
        ))}
      </div>
    </AppShell>
  );
}

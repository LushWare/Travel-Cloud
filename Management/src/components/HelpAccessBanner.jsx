import { useEffect, useState } from 'react';
import { Eye, LogOut } from 'lucide-react';
import toast from '@/lib/toast';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '@/components/ui/button';

const minutesLeft = (expiresAt) => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000));

/**
 * Shown on every page while Lushware support views this agency through the console's help access.
 * The session is view-only (the gateway refuses every change) and ends on its own at expiry.
 */
export default function HelpAccessBanner() {
  const { user, logout } = useAuth();
  const help = user?.helpAccess;
  const [left, setLeft] = useState(() => (help ? minutesLeft(help.expiresAt) : 0));

  useEffect(() => {
    if (!help) return undefined;
    const tick = () => {
      const remaining = minutesLeft(help.expiresAt);
      setLeft(remaining);
      if (remaining === 0) {
        toast('Help access has ended.');
        logout({ silent: true });
      }
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [help, logout]);

  if (!help) return null;
  const endsAt = new Date(help.expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-foreground">
      <Eye className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Lushware support view</span>
        {user.tenant?.name ? ` of ${user.tenant.name}` : ''} · view-only, changes are blocked · ends at {endsAt}
        <span className="text-muted-foreground"> ({left} min left)</span>
      </p>
      <Button size="sm" variant="outline" onClick={() => logout()} className="gap-1.5">
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        End help session
      </Button>
    </div>
  );
}

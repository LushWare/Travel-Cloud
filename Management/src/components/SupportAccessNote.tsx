import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { adminAPI } from '../services/api';

type Visit = { id: string; startedAt: string; minutes: number | null; reason: string | null };

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Each time Lushware support opened view-only access to this agency from the console, so the
 * agency always knows when someone outside it looked at its data, and why.
 */
export default function SupportAccessNote() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    adminAPI.getSupportAccess()
      .then((response: { data?: Visit[] }) => setVisits(response.data ?? []))
      .catch(() => setFailed(true));
  }, []);

  if (failed || visits === null) return null;

  return (
    <section className="border-y border-border py-5" aria-labelledby="support-access-heading">
      <h2 id="support-access-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Lushware support access
      </h2>
      {visits.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Lushware support has never viewed your account.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visits.map((visit) => (
            <li key={visit.id} className="text-sm">
              <span className="font-medium">{formatWhen(visit.startedAt)}</span>
              {visit.minutes ? ` · view-only, up to ${visit.minutes} minutes` : ' · view-only'}
              {visit.reason && <span className="block text-muted-foreground">Reason: {visit.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Support can look but never change anything, and only for the time shown.</p>
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from '@/lib/toast';
import { adminAPI } from '../services/api';
import { Button } from '@/components/ui/button';
import PageHeader from '../components/PageHeader';

export type AuditEntry = {
  id: string;
  action: string;
  summary: string;
  actorEmail: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export const AUDIT_FILTERS = [
  { label: 'All', action: '' },
  { label: 'Staff', action: 'staff' },
  { label: 'Settings', action: 'settings' },
  { label: 'Bank details', action: 'settings.bank_details_changed' },
  { label: 'Policies', action: 'policy' },
  { label: 'Lead assignment', action: 'leads' },
  { label: 'Accounts', action: 'account' },
  { label: 'Lushware access', action: 'platform' },
];

const ROLE_LABELS: Record<string, string> = { superAdmin: 'Owner', admin: 'Admin', salesRep: 'Sales rep', vendor: 'Vendor' };
// Entries made by Lushware staff from the platform console carry a "platform:..." role.
const roleLabel = (role: string) => (role.startsWith('platform:') ? 'Lushware staff' : ROLE_LABELS[role] ?? role);

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const AuditLog = () => {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (action: string, cursor?: string) => {
    const response = await adminAPI.getAuditLog({ action: action || undefined, cursor });
    if (response.status !== 'success') throw new Error(response.message || 'Failed to load the audit log');
    return { rows: (response.data ?? []) as AuditEntry[], next: (response.pagination?.nextCursor ?? null) as string | null };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(filter)
      .then(({ rows, next }) => {
        if (cancelled) return;
        setEntries(rows);
        setNextCursor(next);
      })
      .catch((err) => !cancelled && toast.error((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [filter, load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const { rows, next } = await load(filter, nextCursor);
      setEntries((current) => [...current, ...rows]);
      setNextCursor(next);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <PageHeader title="Audit Log" subtitle="Who changed staff access, settings and bank details in this agency, and when" />

      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          {AUDIT_FILTERS.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant={filter === f.action ? 'default' : 'outline'}
              aria-pressed={filter === f.action}
              onClick={() => setFilter(f.action)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                <time dateTime={e.createdAt} className="shrink-0 text-xs text-muted-foreground sm:w-40 sm:pt-0.5">
                  {formatWhen(e.createdAt)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-foreground">{e.summary}</p>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {e.actorEmail ?? 'System'}
                    {e.actorRole && ` · ${roleLabel(e.actorRole)}`}
                    {e.ipAddress && ` · ${e.ipAddress}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {nextCursor && !loading && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
              {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLog;

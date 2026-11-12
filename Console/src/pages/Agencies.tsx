import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { agencyApi, ApiError, type AgencyRow, type AgencySort, type AgencyStatus, type PlatformUser } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { navigate } from '../lib/route';
import AppShell from '../components/AppShell';
import StatusBadge, { STATUS_LABEL } from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = { user: PlatformUser; onSignOut: () => void; onChangePassword: () => void };

const LIMIT = 25;
const STATUS_FILTERS: (AgencyStatus | '')[] = ['', 'active', 'trial', 'past_due', 'suspended'];
const SORT_LABEL: Record<AgencySort, string> = { name: 'Name', activity: 'Last activity', created: 'Newest', staff: 'Most staff' };
const selectClass = 'h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const staffBreakdown = (a: AgencyRow) => `${a.admins} admin · ${a.salesReps} reps · ${a.vendors} vendors`;

// An agency without a plan gets every feature with no limits, so it is flagged rather than left blank.
function PlanCell({ name }: { name?: string | null }) {
  if (name) return <span className="text-sm text-foreground">{name}</span>;
  return (
    <span title="No plan: every feature, no limits. Assign a plan on the agency page."
      className="inline-flex items-center rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-warning/30 ring-inset">
      No plan
    </span>
  );
}

export default function Agencies({ user, onSignOut, onChangePassword }: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AgencyStatus | ''>('');
  const [sort, setSort] = useState<AgencySort>('name');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Wait for typing to pause before searching.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    agencyApi.list({ search: query, status, sort, page, limit: LIMIT })
      .then(({ rows: next, pagination }) => {
        if (cancelled) return;
        setRows(next);
        setTotal(pagination.total);
        setPages(Math.max(1, pagination.pages));
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load agencies.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [query, status, sort, page]);

  return (
    <AppShell user={user} active="agencies" title="Agencies"
      subtitle={loading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'agency' : 'agencies'}`}
      onChangePassword={onChangePassword} onSignOut={onSignOut}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search agencies" placeholder="Search by name, short name or owner email" value={search}
            onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9" />
        </div>
        <select aria-label="Status" className={selectClass} value={status}
          onChange={(e) => { setStatus(e.target.value as AgencyStatus | ''); setPage(1); }}>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? STATUS_LABEL[s] : 'All statuses'}</option>)}
        </select>
        <select aria-label="Sort by" className={selectClass} value={sort}
          onChange={(e) => { setSort(e.target.value as AgencySort); setPage(1); }}>
          {(Object.keys(SORT_LABEL) as AgencySort[]).map((s) => <option key={s} value={s}>Sort: {SORT_LABEL[s]}</option>)}
        </select>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {query || status ? 'No agencies match these filters.' : 'No agencies yet.'}
        </p>
      ) : (
        <>
          {/* Wide screens: a table. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Agency</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Plan</th>
                  <th className="px-4 py-2.5 font-semibold">Owner</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Staff</th>
                  <th className="px-4 py-2.5 font-semibold">Last activity</th>
                  <th className="px-4 py-2.5 font-semibold">Created</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  // The whole row opens the agency; the link in the last column does the same for keyboards.
                  <tr key={a.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a, button')) return;
                    navigate({ page: 'agency', id: a.id });
                  }}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{a.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{a.slug}</p>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><PlanCell name={a.planName} /></td>
                    <td className="max-w-56 px-4 py-3">
                      <p className="truncate">{a.ownerName ?? '—'}</p>
                      {a.ownerEmail && <p className="truncate text-xs text-muted-foreground">{a.ownerEmail}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-mono">{a.staff}</p>
                      <p className="text-xs whitespace-nowrap text-muted-foreground">{staffBreakdown(a)}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{timeAgo(a.lastActivityAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDate(a.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <a href={`#/agencies/${a.id}`} title={`More details for ${a.name}`}
                        className="inline-flex items-center gap-0.5 font-medium whitespace-nowrap text-primary hover:underline">
                        More details <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per agency. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((a) => (
              <li key={a.id}>
                <a href={`#/agencies/${a.id}`} className="block rounded-xl border border-border bg-card p-4 hover:border-primary/40">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{a.slug}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-2 truncate text-sm text-muted-foreground">{a.ownerEmail ?? 'No owner'}</p>
                  <div className="mt-1"><PlanCell name={a.planName} /></div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{a.staff} staff · active {timeAgo(a.lastActivityAt)}</p>
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-primary">
                      Details <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Pages">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      )}
    </AppShell>
  );
}

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, CircleSlash, Eye, Loader2, RotateCcw, Save, Trash2, XCircle } from 'lucide-react';
import {
  agencyApi, ApiError, PLAN_FEATURES, plansApi,
  type AgencyDetail as Detail, type PlanCatalogItem, type PlanFeatureKey, type PlatformUser,
} from '../lib/api';
import { formatDate, formatNumber, timeAgo } from '../lib/format';
import AppShell from '../components/AppShell';
import StatusBadge from '../components/StatusBadge';
import StatusChangeDialog from '../components/StatusChangeDialog';
import HelpAccessDialog from '../components/HelpAccessDialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = { id: string; user: PlatformUser; onSignOut: () => void; onChangePassword: () => void };

const USAGE_LABEL = { leads: 'Leads', quotations: 'Quotations', invoices: 'Invoices', bookings: 'Bookings', packages: 'Packages' } as const;
const OVERRIDE_KEYS = [
  ['staff_seats', 'Staff seats'], ['packages', 'Packages'],
  ['emails_per_month', 'Customer emails per month'], ['whatsapp_per_month', 'WhatsApp messages per month'],
  ['features.ai_itinerary_builder', 'AI itinerary builder'],
  ['features.finance_docs', 'Invoices, receipts, credit notes and vouchers'],
  ['features.whatsapp', 'WhatsApp delivery'],
  ['features.vendors', 'Vendors and suppliers'],
  ['features.travel_booking', 'Flight booking'],
  ['features.analytics_full', 'Full analytics'],
] as const;

const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <h2 className="mb-3 font-heading text-sm font-semibold">{title}</h2>
    {children}
  </section>
);

const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-0.5 font-mono text-lg font-semibold">{value}</p>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <li className="flex items-center gap-2 text-sm">
    {ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
    <span className={ok ? '' : 'text-muted-foreground'}>{label}</span>
    <span className="sr-only">{ok ? 'done' : 'not done'}</span>
  </li>
);

export default function AgencyDetail({ id, user, onSignOut, onChangePassword }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'suspend' | 'restore' | 'help' | null>(null);
  const [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<PlanCatalogItem[]>([]);
  const [planVersionId, setPlanVersionId] = useState('');
  const [planReason, setPlanReason] = useState('');
  const [overrideKey, setOverrideKey] = useState<(typeof OVERRIDE_KEYS)[number][0]>('staff_seats');
  const [overrideValue, setOverrideValue] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [removeReason, setRemoveReason] = useState('');

  const load = useCallback(() => {
    setError('');
    return agencyApi.get(id)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this agency.'));
  }, [id]);

  useEffect(() => { setDetail(null); load(); }, [load]);

  useEffect(() => {
    if (user.role !== 'platform_admin') return;
    plansApi.list().then(setCatalog).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load plans.'));
  }, [user.role]);

  const updatePlan = async (event: FormEvent) => {
    event.preventDefault();
    if (planReason.trim().length < 5 || !planVersionId) return;
    try {
      await agencyApi.assignPlan(id, { planVersionId, reason: planReason.trim() });
      setPlanReason('');
      setNotice('Agency plan updated.');
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not assign this plan.'); }
  };

  const saveOverride = async (event: FormEvent) => {
    event.preventDefault();
    if (overrideReason.trim().length < 5 || overrideValue === '') return;
    const value = overrideKey.startsWith('features.') ? overrideValue === 'true' : Number(overrideValue);
    try {
      await agencyApi.setOverride(id, overrideKey, { value, reason: overrideReason.trim() });
      setOverrideReason('');
      setNotice('Agency override saved.');
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save this override.'); }
  };

  const removeOverride = async (key: string) => {
    if (removeReason.trim().length < 5) return;
    try {
      await agencyApi.removeOverride(id, key, removeReason.trim());
      setRemoveReason('');
      setNotice('Agency override removed.');
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not remove this override.'); }
  };

  const changeStatus = async (reason: string) => {
    const action = dialog === 'suspend' ? agencyApi.suspend : agencyApi.restore;
    if (dialog !== 'suspend' && dialog !== 'restore') return;
    await action(id, reason);
    setNotice(dialog === 'suspend' ? 'Agency suspended. Its staff are being signed out.' : 'Agency restored.');
    setDialog(null);
    await load();
  };

  const isAdmin = user.role === 'platform_admin';
  const agency = detail?.agency;
  const canSuspend = agency && isAdmin && ['active', 'trial', 'past_due'].includes(agency.status) && !detail?.isPublicSite;
  const canRestore = agency && isAdmin && agency.status === 'suspended';

  const canHelp = agency && !['pending_deletion', 'deleted'].includes(agency.status);
  const actions = (
    <>
      {canHelp && <Button variant="outline" onClick={() => setDialog('help')}><Eye /> Help this agency</Button>}
      {canSuspend && <Button variant="destructive" onClick={() => setDialog('suspend')}><CircleSlash /> Suspend</Button>}
      {canRestore && <Button onClick={() => setDialog('restore')}><RotateCcw /> Restore</Button>}
    </>
  );

  return (
    <AppShell user={user} active="agencies" title={agency?.name ?? 'Agency'} subtitle={agency?.slug}
      actions={actions} onChangePassword={onChangePassword} onSignOut={onSignOut}>
      <a href="#/agencies" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All agencies
      </a>

      {notice && <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {!detail && !error && (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      )}

      {detail && agency && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Panel title="Overview">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={agency.status} />
                <span className="text-sm text-muted-foreground">Created {formatDate(agency.createdAt)}</span>
                <span className="text-sm text-muted-foreground">Last activity {timeAgo(detail.activity.lastActivityAt)}</span>
              </div>
              {detail.isPublicSite && (
                <p className="mt-3 text-sm text-muted-foreground">This agency runs the public website, so it cannot be suspended.</p>
              )}
            </Panel>

            <Panel title="People">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat label="Total" value={detail.people.total} />
                <Stat label="Owners" value={detail.people.byRole.owners} />
                <Stat label="Admins" value={detail.people.byRole.admins} />
                <Stat label="Sales reps" value={detail.people.byRole.salesReps} />
                <Stat label="Vendors" value={detail.people.byRole.vendors} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {detail.people.byStatus.active} active · {detail.people.byStatus.invited} invited · {detail.people.byStatus.suspended} suspended
              </p>
            </Panel>

            <Panel title="Usage">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {(Object.keys(USAGE_LABEL) as (keyof typeof USAGE_LABEL)[]).map((key) => (
                  <Stat key={key} label={USAGE_LABEL[key]} value={formatNumber(detail.usage[key]?.total)}
                    hint={`${formatNumber(detail.usage[key]?.thisMonth)} this month`} />
                ))}
              </div>
            </Panel>

            <Panel title="Plan and limits">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Assigned plan" value={detail.plan?.resolved.plan?.name ?? 'Default access'}
                  hint={detail.plan?.resolved.plan ? `Version ${detail.plan.resolved.plan.version} · ${detail.plan.resolved.plan.key}` : 'No plan assigned'} />
                <Stat label="Staff seats" value={`${detail.people.total} / ${detail.plan?.resolved.entitlements.staff_seats ?? 'Unlimited'}`} />
                <Stat label="Packages" value={`${detail.usage.packages.total} / ${detail.plan?.resolved.entitlements.packages ?? 'Unlimited'}`} />
                <Stat label="Customer emails" hint="This month"
                  value={`${formatNumber(detail.sends?.emails ?? 0)} / ${detail.plan?.resolved.entitlements.emails_per_month ?? 'Unlimited'}`} />
                <Stat label="WhatsApp messages" hint="This month"
                  value={`${formatNumber(detail.sends?.whatsapp ?? 0)} / ${detail.plan?.resolved.entitlements.whatsapp_per_month ?? 'Unlimited'}`} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {Object.entries(detail.plan?.resolved.entitlements.features ?? {}).map(([key, enabled]) => (
                  <p key={key} className="border-b border-border py-2 text-sm">
                    <span className={enabled ? 'text-foreground' : 'text-muted-foreground'}>{PLAN_FEATURES[key as PlanFeatureKey] ?? key.replaceAll('_', ' ')}</span>
                    <span className="float-right text-xs">{enabled ? 'Enabled' : 'Disabled'}</span>
                  </p>
                ))}
              </div>
              {isAdmin && <>
                <form onSubmit={updatePlan} className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <label className="grid gap-1 text-sm">Plan version
                    <select className="h-9 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm" value={planVersionId} onChange={(event) => setPlanVersionId(event.target.value)} required>
                      <option value="">Choose a plan</option>
                      {catalog.filter((plan) => !plan.archivedAt).flatMap((plan) => plan.versions.filter((version) => version.isCurrent).map((version) => (
                        <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>
                      )))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">Reason<Input value={planReason} minLength={5} maxLength={500} required placeholder="Why is this plan changing?" onChange={(event) => setPlanReason(event.target.value)} /></label>
                  <Button type="submit" disabled={!planVersionId || planReason.trim().length < 5}><Save /> Assign</Button>
                </form>
                <form onSubmit={saveOverride} className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm">Override
                    <select className="h-9 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm" value={overrideKey} onChange={(event) => { setOverrideKey(event.target.value as typeof overrideKey); setOverrideValue(''); }}>
                      {OVERRIDE_KEYS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">Value
                    {overrideKey.startsWith('features.') ? (
                      <select className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm" value={overrideValue} onChange={(event) => setOverrideValue(event.target.value)} required><option value="">Choose a value</option><option value="true">Enabled</option><option value="false">Disabled</option></select>
                    ) : <Input type="number" min="0" step="1" required value={overrideValue} onChange={(event) => setOverrideValue(event.target.value)} />}
                  </label>
                  <label className="grid gap-1 text-sm sm:col-span-2">Reason<Input value={overrideReason} minLength={5} maxLength={500} required placeholder="Why is this exception needed?" onChange={(event) => setOverrideReason(event.target.value)} /></label>
                  <div className="sm:col-span-2 sm:flex sm:justify-end"><Button type="submit" disabled={overrideValue === '' || overrideReason.trim().length < 5}><Save /> Save override</Button></div>
                </form>
                {detail.plan?.overrides.length ? <div className="mt-4 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold">Agency overrides</h3>
                  <ul className="mt-2 divide-y divide-border">
                    {detail.plan.overrides.map((override) => <li key={override.id} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0"><p className="text-sm">{override.entitlementKey}: <strong>{String(override.value)}</strong></p><p className="text-xs text-muted-foreground">{override.reason}</p></div>
                      <Button variant="ghost" onClick={() => removeOverride(override.entitlementKey)} disabled={removeReason.trim().length < 5}><Trash2 /> Remove</Button>
                    </li>)}
                  </ul>
                  <label className="mt-3 grid gap-1 text-sm">Reason for removing an override<Input value={removeReason} minLength={5} maxLength={500} onChange={(event) => setRemoveReason(event.target.value)} placeholder="Why should this exception end?" /></label>
                </div> : null}
              </>}
            </Panel>

            <Panel title="Platform history">
              {detail.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No platform actions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.history.map((h) => (
                    <li key={h.id} className="py-2.5">
                      <p className="text-sm break-words">{h.summary}</p>
                      <p className="text-xs text-muted-foreground">{h.actorEmail ?? 'System'} · {formatDate(h.createdAt)} · {timeAgo(h.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Owners">
              {detail.owners.length === 0 ? (
                <p className="text-sm text-muted-foreground">No owner.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.owners.map((o) => (
                    <li key={o.email} className="min-w-0">
                      <p className="truncate text-sm font-medium">{o.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{o.email}</p>
                      <p className="text-xs text-muted-foreground">Last login {timeAgo(o.lastLogin)}{o.status !== 'active' ? ` · ${o.status}` : ''}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Activity">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Active, 7 days" value={detail.activity.activeUsers7d} />
                <Stat label="Active, 30 days" value={detail.activity.activeUsers30d} />
              </div>
            </Panel>

            <Panel title="Setup">
              <ul className="space-y-2">
                <Check ok={detail.setup.companyDetails} label="Company name and address" />
                <Check ok={detail.setup.logo} label="Logo uploaded" />
                <Check ok={detail.setup.bankDetails} label="Bank details added" />
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {(dialog === 'suspend' || dialog === 'restore') && agency && (
        <StatusChangeDialog mode={dialog} agencyName={agency.name} slug={agency.slug}
          onConfirm={changeStatus} onClose={() => setDialog(null)} />
      )}
      {dialog === 'help' && agency && (
        <HelpAccessDialog agencyId={agency.id} agencyName={agency.name} onClose={() => setDialog(null)}
          onStarted={(minutes) => {
            setDialog(null);
            setNotice(`View-only help access opened in a new tab for ${minutes} minutes.`);
            load();
          }} />
      )}
    </AppShell>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Archive, Copy, Loader2, Pencil, Plus, Save, X } from 'lucide-react';
import AppShell from '../components/AppShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  ApiError, PLAN_FEATURES, PLAN_LIMITS, plansApi, withFeatureDefaults,
  type PlanCatalogItem, type PlanEntitlements, type PlanInput, type PlanLimitKey, type PlatformUser,
} from '../lib/api';

type Props = { user: PlatformUser; onSignOut: () => void; onChangePassword: () => void };
type Editor = { planId: string | null; key: string; input: PlanInput };

const FEATURE_LABELS: Record<keyof PlanEntitlements['features'], string> = PLAN_FEATURES;

const emptyInput = (): PlanInput => ({
  name: '', description: '', priceMinorUnits: null, currency: 'USD', billingInterval: 'monthly',
  entitlements: withFeatureDefaults({ staff_seats: null, packages: null }),
});

const numberValue = (value: string): number | null => value === '' ? null : Number(value);
const messageOf = (error: unknown) => error instanceof ApiError ? error.message : 'Could not save plan changes.';

export default function Plans({ user, onSignOut, onChangePassword }: Props) {
  const [plans, setPlans] = useState<PlanCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const isAdmin = user.role === 'platform_admin';

  const load = async () => {
    setError('');
    try { setPlans(await plansApi.list()); }
    catch (err) { setError(messageOf(err)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => { setNotice(''); setEditor({ planId: null, key: '', input: emptyInput() }); };
  const startEdit = (plan: PlanCatalogItem) => {
    const current = plan.versions.find((version) => version.isCurrent) ?? plan.versions[0];
    if (!current) return;
    setNotice('');
    setEditor({ planId: plan.id, key: plan.key, input: {
      name: current.name, description: current.description ?? '', priceMinorUnits: current.priceMinorUnits,
      currency: current.currency, billingInterval: current.billingInterval,
      entitlements: withFeatureDefaults(current.entitlements),
    } });
  };

  const startDuplicate = (plan: PlanCatalogItem) => {
    const current = plan.versions.find((version) => version.isCurrent) ?? plan.versions[0];
    if (!current) return;
    setNotice('');
    setEditor({ planId: null, key: `${plan.key}-copy`, input: {
      name: `${current.name} copy`, description: current.description ?? '', priceMinorUnits: current.priceMinorUnits,
      currency: current.currency, billingInterval: current.billingInterval,
      entitlements: withFeatureDefaults(current.entitlements),
    } });
  };

  const changeLimit = (key: PlanLimitKey, value: string) => {
    if (!editor) return;
    setEditor({ ...editor, input: { ...editor.input, entitlements: { ...editor.input.entitlements, [key]: numberValue(value) } } });
  };

  const changeFeature = (key: keyof PlanEntitlements['features'], checked: boolean) => {
    if (!editor) return;
    setEditor({ ...editor, input: { ...editor.input, entitlements: {
      ...editor.input.entitlements, features: { ...editor.input.entitlements.features, [key]: checked },
    } } });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setError('');
    try {
      if (editor.planId) await plansApi.createVersion(editor.planId, editor.input);
      else await plansApi.create({ ...editor.input, key: editor.key });
      setEditor(null);
      setNotice(editor.planId ? 'A new plan version is active.' : 'Plan created.');
      await load();
    } catch (err) { setError(messageOf(err)); }
    finally { setSaving(false); }
  };

  const archive = async (plan: PlanCatalogItem) => {
    if (!window.confirm(`Archive ${plan.key}? Existing agency assignments will keep their version.`)) return;
    try {
      await plansApi.archive(plan.id);
      setNotice(`${plan.key} archived.`);
      await load();
    } catch (err) { setError(messageOf(err)); }
  };

  return (
    <AppShell user={user} active="plans" title="Plans" subtitle={`${plans.length} plan${plans.length === 1 ? '' : 's'}`}
      actions={isAdmin ? <Button onClick={startCreate}><Plus /> New plan</Button> : undefined}
      onChangePassword={onChangePassword} onSignOut={onSignOut}>
      {notice && <p role="status" className="mb-4 border-l-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="mb-4 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {editor && (
        <form onSubmit={save} className="mb-6 border-y border-border py-5" aria-label={editor.planId ? 'Edit plan version' : 'Create plan'}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-heading text-base font-semibold">{editor.planId ? `New version: ${editor.key}` : 'New plan'}</h2>
            <Button type="button" variant="ghost" size="icon" aria-label="Cancel editing" onClick={() => setEditor(null)}><X /></Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {!editor.planId && <label className="grid gap-1 text-sm">Plan key<Input required pattern="[a-z0-9][a-z0-9_-]{0,63}" value={editor.key} onChange={(event) => setEditor({ ...editor, key: event.target.value })} /></label>}
            <label className="grid gap-1 text-sm">Plan name<Input required maxLength={120} value={editor.input.name} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, name: event.target.value } })} /></label>
            <label className="grid gap-1 text-sm">Price in minor units<Input type="number" min="0" value={editor.input.priceMinorUnits ?? ''} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, priceMinorUnits: numberValue(event.target.value) } })} /></label>
            <label className="grid gap-1 text-sm">Currency<Input required minLength={3} maxLength={3} value={editor.input.currency} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, currency: event.target.value.toUpperCase() } })} /></label>
            <label className="grid gap-1 text-sm">Billing interval<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={editor.input.billingInterval ?? ''} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, billingInterval: (event.target.value || null) as PlanInput['billingInterval'] } })}><option value="">None</option><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
            <label className="grid gap-1 text-sm sm:col-span-2 lg:col-span-3">Description<Input maxLength={500} value={editor.input.description ?? ''} onChange={(event) => setEditor({ ...editor, input: { ...editor.input, description: event.target.value } })} /></label>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-semibold">Limits</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(PLAN_LIMITS) as PlanLimitKey[]).map((key) => (
                <label key={key} className="grid gap-1 text-sm">{PLAN_LIMITS[key]}<Input type="number" min="0" placeholder="Unlimited" value={editor.input.entitlements[key] ?? ''} onChange={(event) => changeLimit(key, event.target.value)} /></label>
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-semibold">Features</legend>
            <p className="mb-2 text-xs text-muted-foreground">Switching a module off makes it read-only for agencies on this plan: they keep their existing records but cannot add or change any. Staff see the change at their next sign-in or within 15 minutes.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(FEATURE_LABELS) as (keyof PlanEntitlements['features'])[]).map((key) => (
                <label key={key} className="flex min-h-10 items-center gap-2 border-b border-border py-2 text-sm">
                  <input type="checkbox" checked={editor.input.entitlements.features[key]} onChange={(event) => changeFeature(key, event.target.checked)} />
                  {FEATURE_LABELS[key]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 flex justify-end"><Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Save plan</Button></div>
        </form>
      )}

      {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading plans" /></div> : (
        <div className="divide-y divide-border border-y border-border">
          {plans.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No plans have been created.</p>}
          {plans.map((plan) => {
            const current = plan.versions.find((version) => version.isCurrent) ?? plan.versions[0];
            return (
              <article key={plan.id} className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-heading text-base font-semibold">{current?.name ?? plan.key}</h2>
                    <span className="font-mono text-xs text-muted-foreground">{plan.key}</span>
                    {plan.archivedAt && <span className="text-xs text-muted-foreground">Archived</span>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {current ? `Version ${current.version} · ${current.assignments} agencies · ${current.entitlements.staff_seats ?? 'unlimited'} seats · ${current.entitlements.packages ?? 'unlimited'} packages` : 'No versions'}
                  </p>
                  {current?.description && <p className="mt-1 text-sm">{current.description}</p>}
                </div>
                {isAdmin && !plan.archivedAt && <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => startEdit(plan)} disabled={!current}><Pencil /> Edit</Button>
                  <Button variant="outline" onClick={() => startDuplicate(plan)} disabled={!current}><Copy /> Duplicate</Button>
                  <Button variant="ghost" onClick={() => archive(plan)}><Archive /> Archive</Button>
                </div>}
              </article>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
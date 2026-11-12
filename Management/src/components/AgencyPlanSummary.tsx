import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminAPI } from '../services/api';

type LimitKey = 'staff_seats' | 'packages' | 'emails_per_month' | 'whatsapp_per_month';

type PlanSummary = {
  plan: { name: string; version: number; key: string } | null;
  entitlements: Partial<Record<LimitKey, number | null>> & { features: Record<string, boolean> };
  usage: Partial<Record<LimitKey, number>>;
};

const LIMITS: [LimitKey, string][] = [
  ['staff_seats', 'Staff seats'],
  ['packages', 'Packages'],
  ['emails_per_month', 'Customer emails this month'],
  ['whatsapp_per_month', 'WhatsApp messages this month'],
];

// Matches USAGE_WARNING_SHARE in Services/shared/tenancy/src/usage.js.
const WARNING_SHARE = 0.8;

function limitState(used: number, limit: number | null | undefined): 'ok' | 'near' | 'reached' {
  if (limit == null) return 'ok';
  if (used >= limit) return 'reached';
  return used >= Math.ceil(limit * WARNING_SHARE) ? 'near' : 'ok';
}

const FEATURE_LABELS: Record<string, string> = {
  ai_itinerary_builder: 'AI itinerary builder',
  finance_docs: 'Invoices, receipts, credit notes and vouchers',
  whatsapp: 'WhatsApp delivery',
  vendors: 'Vendors and suppliers',
  travel_booking: 'Flight booking',
  analytics_full: 'Full analytics',
};

export default function AgencyPlanSummary() {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminAPI.getAgencyPlan()
      .then((response) => setSummary(response.data))
      .catch((err) => setError(err?.message || 'Could not load plan details.'));
  }, []);

  return (
    <section className="border-y border-border py-5" aria-labelledby="agency-plan-heading">
      <div className="mb-4">
        <h2 id="agency-plan-heading" className="text-base font-semibold text-foreground">Plan and limits</h2>
        <p className="mt-1 text-sm text-muted-foreground">Current agency access and usage.</p>
      </div>
      {!summary && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading plan" />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {summary && <>
        <p className="font-medium">{summary.plan ? `${summary.plan.name} · v${summary.plan.version}` : 'Default access'}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {LIMITS.map(([key, label]) => {
            const used = summary.usage[key] ?? 0;
            const limit = summary.entitlements[key] ?? null;
            const state = limitState(used, limit);
            return (
              <div key={key} className="text-sm">
                <p>{label} <span className="font-mono font-semibold">{used} / {limit ?? 'Unlimited'}</span></p>
                {state !== 'ok' && (
                  <p role="status" className={`mt-0.5 text-xs ${state === 'reached' ? 'text-destructive' : 'text-amber-700'}`}>
                    {state === 'reached'
                      ? (key.endsWith('_per_month') ? 'Limit reached: sending is paused until the 1st of next month.' : 'Limit reached.')
                      : 'Nearly at the limit. Ask your agency owner about upgrading.'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(summary.entitlements.features).map(([key, enabled]) => (
            <li key={key} className="flex items-center justify-between border-b border-border py-2 text-sm">
              <span>{FEATURE_LABELS[key] ?? key}</span>
              <span className={enabled ? 'text-emerald-700' : 'text-muted-foreground'}>{enabled ? 'Included' : 'Not included'}</span>
            </li>
          ))}
        </ul>
      </>}
    </section>
  );
}
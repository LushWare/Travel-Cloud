import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { adminAPI } from '../services/api';

type PlanSummary = {
  plan: { name: string; version: number; key: string } | null;
  entitlements: {
    staff_seats: number | null;
    packages: number | null;
    features: Record<string, boolean>;
  };
  usage: { staff_seats: number; packages: number };
};

const FEATURE_LABELS: Record<string, string> = {
  ai_itinerary_builder: 'AI itinerary builder',
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
          <p className="text-sm">Staff seats <span className="font-mono font-semibold">{summary.usage.staff_seats} / {summary.entitlements.staff_seats ?? 'Unlimited'}</span></p>
          <p className="text-sm">Packages <span className="font-mono font-semibold">{summary.usage.packages} / {summary.entitlements.packages ?? 'Unlimited'}</span></p>
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
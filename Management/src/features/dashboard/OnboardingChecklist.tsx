import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { adminAPI, integrationAPI, packageAPI } from '../../services/api';

type ChecklistState = {
  logo: boolean;
  company: boolean;
  bank: boolean;
  teammate: boolean;
  package: boolean;
  email: boolean;
  starterCatalog: boolean;
};

const EMPTY_CHECKLIST: ChecklistState = {
  logo: false,
  company: false,
  bank: false,
  teammate: false,
  package: false,
  email: false,
  starterCatalog: false,
};

const STEPS: { key: keyof ChecklistState; label: string; to: string }[] = [
  { key: 'logo', label: 'Add your company logo', to: '/settings#company-identity' },
  { key: 'company', label: 'Complete your company details', to: '/settings#company-identity' },
  { key: 'bank', label: 'Add bank and payment details', to: '/settings#bank-payment-details' },
  { key: 'teammate', label: 'Invite a teammate', to: '/users' },
  { key: 'package', label: 'Create your first package', to: '/packages' },
  { key: 'email', label: 'Connect your agency email', to: '/settings?tab=integrations' },
  { key: 'starterCatalog', label: 'Prepare starter places and activities', to: '/packages' },
];

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

export default function OnboardingChecklist() {
  const [checklist, setChecklist] = useState(EMPTY_CHECKLIST);
  const [failedChecks, setFailedChecks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadChecklist = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      adminAPI.getSettings(),
      adminAPI.getUsers({ page: 1, limit: 1 }),
      packageAPI.getAll({ page: 1, limit: 1 }),
      integrationAPI.getEmail(),
      packageAPI.initializeOnboardingCatalog(),
    ]);

    const next = { ...EMPTY_CHECKLIST };
    const failed: string[] = [];

    const [settingsResult, usersResult, packagesResult, emailResult, catalogResult] = results;
    if (isFulfilled(settingsResult) && settingsResult.value?.data?.settings) {
      const settings = settingsResult.value.data.settings;
      next.logo = Boolean(settings.logoUrl);
      next.company = Boolean(settings.companyName?.trim() && settings.companyAddress?.trim());
      next.bank = Boolean(settings.bankName?.trim() && settings.bankAccountName?.trim() && settings.bankAccountNumber?.trim());
    } else {
      failed.push('Organization settings');
    }

    if (isFulfilled(usersResult) && Number.isFinite(usersResult.value?.pagination?.total)) {
      next.teammate = usersResult.value.pagination.total > 1;
    } else {
      failed.push('Teammate status');
    }

    if (isFulfilled(packagesResult) && Number.isFinite(packagesResult.value?.total)) {
      next.package = packagesResult.value.total > 0;
    } else {
      failed.push('Package status');
    }

    if (isFulfilled(emailResult) && typeof emailResult.value?.data?.connected === 'boolean') {
      next.email = emailResult.value.data.connected;
    } else {
      failed.push('Agency email status');
    }

    if (isFulfilled(catalogResult) && catalogResult.value?.status === 'success') {
      next.starterCatalog = true;
    } else {
      failed.push('Starter places and activities');
    }

    setChecklist(next);
    setFailedChecks(failed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadChecklist();
  }, [loadChecklist]);

  if (!loading && STEPS.every(({ key }) => checklist[key])) return null;

  const completed = STEPS.filter(({ key }) => checklist[key]).length;

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="onboarding-checklist-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-checklist-heading" className="font-heading text-lg font-semibold text-foreground">
            Get started
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete these steps to set up your agency ({completed} of {STEPS.length} complete).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadChecklist()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {failedChecks.length > 0 && (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          Could not check: {failedChecks.join(', ')}. Refresh to try again.
        </p>
      )}

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {STEPS.map(({ key, label, to }) => {
          const Icon = checklist[key] ? CheckCircle2 : Circle;
          return (
            <li key={key}>
              <Link
                to={to}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/60"
              >
                <Icon className={`h-4 w-4 shrink-0 ${checklist[key] ? 'text-success' : 'text-muted-foreground'}`} aria-hidden="true" />
                <span className={checklist[key] ? 'text-muted-foreground line-through' : 'text-foreground'}>{label}</span>
                {!checklist[key] && <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

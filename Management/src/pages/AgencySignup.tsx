import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/auth.service';

type SignupPlan = {
  key: string;
  planVersionId: string;
  name: string;
  description: string | null;
  priceMinorUnits: number;
  currency: string;
  billingInterval: 'monthly' | 'annual';
  entitlements: {
    staff_seats?: number | null;
    packages?: number | null;
    features?: Record<string, boolean>;
  };
};

function priceLabel(plan: SignupPlan) {
  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency,
  }).format(plan.priceMinorUnits / 100);
  return `${amount} / ${plan.billingInterval === 'annual' ? 'year' : 'month'}`;
}

function planHighlights(plan: SignupPlan) {
  const highlights = [
    plan.entitlements.staff_seats == null
      ? 'Unlimited staff seats'
      : `${plan.entitlements.staff_seats} staff seats`,
    plan.entitlements.packages == null
      ? 'Unlimited packages'
      : `${plan.entitlements.packages} packages`,
  ];
  if (plan.entitlements.features?.ai_itinerary_builder) highlights.push('AI itinerary builder');
  if (plan.entitlements.features?.whatsapp) highlights.push('WhatsApp tools');
  return highlights;
}

export default function AgencySignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const [plans, setPlans] = useState<SignupPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState(searchParams.get('plan') || 'growth');
  const [agencyName, setAgencyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authService.getSignupPlans()
      .then((response) => {
        if (!active) return;
        const availablePlans = response.data as SignupPlan[];
        setPlans(availablePlans);
        const requestedPlan = searchParams.get('plan');
        if (requestedPlan && availablePlans.some((plan) => plan.key === requestedPlan)) {
          setSelectedPlan(requestedPlan);
        } else {
          setSelectedPlan(availablePlans.find((plan) => plan.key === 'growth')?.key || availablePlans[0]?.key || '');
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError?.message || 'Plans could not be loaded. Please try again.');
      })
      .finally(() => {
        if (active) setLoadingPlans(false);
      });
    return () => { active = false; };
  }, [searchParams]);

  const selectedPlanDetails = useMemo(
    () => plans.find((plan) => plan.key === selectedPlan),
    [plans, selectedPlan],
  );

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPlan) {
      setError('Choose a plan to continue.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await authService.createAgency({
        agencyName,
        ownerName,
        email,
        password,
        planKey: selectedPlan,
      });
      navigate(`/verify-signup?email=${encodeURIComponent(response.data.email || email.trim())}`, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Signup could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="w-full max-w-2xl">
        <div className="border border-border rounded-xl p-6 sm:p-8">
          <form onSubmit={submit} className="space-y-4">
            <div className="mb-6">
              <div className="flex items-center justify-center gap-3">
                <img src="/logo.jpeg" alt="" className="h-10 w-10 shrink-0 object-contain" />
                <h2 className="font-heading text-xl font-semibold text-foreground">Create an account</h2>
              </div>
              <p className="mt-1 text-center text-sm text-muted-foreground">Choose the plan you want after your trial.</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Agency and owner details</h3>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Agency name</span>
                <Input required minLength={2} maxLength={120} value={agencyName} onChange={(event) => setAgencyName(event.target.value)} autoComplete="organization" />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Your name</span>
                <Input required maxLength={50} value={ownerName} onChange={(event) => setOwnerName(event.target.value)} autoComplete="name" />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Work email</span>
                <Input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Password</span>
                <Input required type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                <span className="block text-xs text-muted-foreground">Use at least 8 characters.</span>
              </label>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Choose your plan</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your trial uses Growth features. No payment is taken today; we&apos;ll ask you to confirm billing before the trial ends.
                </p>
              </div>

              {loadingPlans ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading plans" />
              ) : plans.length === 0 ? (
                <p role="alert" className="text-sm text-destructive">No plans are available for signup right now.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {plans.map((plan) => (
                    <button
                      key={plan.key}
                      type="button"
                      aria-pressed={selectedPlan === plan.key}
                      onClick={() => setSelectedPlan(plan.key)}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        selectedPlan === plan.key
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <span className="block font-semibold text-foreground">{plan.name}</span>
                      <span className="mt-1 block text-sm font-medium text-foreground">{priceLabel(plan)}</span>
                      {plan.description && <span className="mt-2 block text-xs text-muted-foreground">{plan.description}</span>}
                      <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                        {planHighlights(plan).map((highlight) => <li key={highlight}>{highlight}</li>)}
                      </ul>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedPlanDetails && (
              <p className="text-center text-xs text-muted-foreground">
                After the trial: {selectedPlanDetails.name} ({priceLabel(selectedPlanDetails)}).
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="h-11 w-full gap-2" disabled={submitting || loadingPlans || plans.length === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {submitting ? 'Creating account…' : 'Create an account'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

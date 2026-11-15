import { useEffect, useState } from 'react';
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { billingAPI } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import toast from '@/lib/toast';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Plan = {
  key: string;
  planVersionId: string;
  name: string;
  priceMinorUnits: number;
  currency: string;
  billingInterval: 'monthly' | 'annual';
};

type BillingStatus = {
  status: string;
  trialEndsAt: string | null;
  pastDueAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  postTrialPlanVersionId: string | null;
  currentPlanVersionId: string | null;
  hasSubscription: boolean;
  planName: string | null;
};

function priceLabel(plan: Plan) {
  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: plan.currency,
  }).format(plan.priceMinorUnits / 100);
  return `${amount} / ${plan.billingInterval === 'annual' ? 'year' : 'month'}`;
}

export default function AgencyBillingSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.isSuperAdmin) {
      setLoading(false);
      return;
    }
    Promise.all([billingAPI.getStatus(), billingAPI.getPlans()])
      .then(([statusResponse, plansResponse]) => {
        const billingStatus = statusResponse.data as BillingStatus;
        const availablePlans = plansResponse.data as Plan[];
        setStatus(billingStatus);
        setPlans(availablePlans);
        const preferredVersion = billingStatus.postTrialPlanVersionId
          && availablePlans.some((plan) => plan.planVersionId === billingStatus.postTrialPlanVersionId)
          ? billingStatus.postTrialPlanVersionId
          : '';
        setSelectedVersion(
          preferredVersion
          || availablePlans.find((plan) => plan.key === 'growth')?.planVersionId
          || availablePlans[0]?.planVersionId
          || '',
        );
      })
      .catch((error) => toast.error(apiErrorMessage(error)))
      .finally(() => setLoading(false));
  }, [user?.isSuperAdmin]);

  if (!user?.isSuperAdmin) return null;

  const openStripePage = async (getUrl: () => Promise<string>, origin: string) => {
    const stripeTab = window.open('about:blank', '_blank');
    if (!stripeTab) {
      toast.error('Allow pop-ups to open Stripe billing in a new tab, then try again.');
      return;
    }
    stripeTab.opener = null;
    setSubmitting(true);
    try {
      const url = new URL(await getUrl());
      if (url.origin !== origin) throw new Error('Stripe returned an invalid billing URL');
      stripeTab.location.replace(url.toString());
    } catch (error) {
      stripeTab.close();
      toast.error(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const startCheckout = () => openStripePage(
    async () => (await billingAPI.startCheckout(selectedVersion)).data.url,
    'https://checkout.stripe.com',
  );

  const changePlan = async () => {
    setSubmitting(true);
    try {
      await billingAPI.changePlan(selectedVersion);
      toast.success('Plan change submitted. Your subscription will update shortly.');
      const response = await billingAPI.getStatus();
      setStatus(response.data as BillingStatus);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const openPortal = () => openStripePage(
    async () => (await billingAPI.openPortal()).data.url,
    'https://billing.stripe.com',
  );

  const selectedPlan = plans.find((plan) => plan.planVersionId === selectedVersion);
  const trialEndsAt = status?.trialEndsAt ? new Date(status.trialEndsAt).getTime() : 0;
  const trialStillActive = status?.status === 'trial' && trialEndsAt > Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          SaaS plan and billing
        </CardTitle>
        <CardDescription>
          Manage your Travel CRM subscription. Customer invoice payments are configured separately under Integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading billing" />
        ) : status ? (
          <>
            <p className="text-sm text-muted-foreground">
              Account status: <span className="font-medium capitalize text-foreground">{status.status.replace(/_/g, ' ')}</span>
              {status.trialEndsAt && status.status === 'trial' && (
                <> · Trial ends {new Date(status.trialEndsAt).toLocaleDateString()}</>
              )}
              {status.cancelAtPeriodEnd && <> · Cancels at the end of the billing period</>}
              {status.planName && <> · Current plan: {status.planName}</>}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <select
                aria-label="Subscription plan"
                value={selectedVersion}
                onChange={(event) => setSelectedVersion(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
              >
                {plans.map((plan) => (
                  <option key={plan.planVersionId} value={plan.planVersionId}>
                    {plan.name} — {priceLabel(plan)}
                  </option>
                ))}
              </select>
              {status.hasSubscription ? (
                <>
                  <Button onClick={changePlan} disabled={submitting || !selectedPlan || selectedVersion === status.currentPlanVersionId}>
                    {submitting && <Loader2 className="animate-spin" />}
                    Change plan
                  </Button>
                  <Button variant="outline" onClick={openPortal} disabled={submitting}>
                    <ExternalLink />
                    Payment methods & invoices
                  </Button>
                </>
              ) : (
                <Button onClick={startCheckout} disabled={submitting || !selectedPlan}>
                  {submitting ? <Loader2 className="animate-spin" /> : <CreditCard />}
                  Continue to secure checkout
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {status.hasSubscription
                ? 'Plan changes are billed by Stripe. Card details, receipts, and cancellation are managed in Stripe’s secure billing portal.'
                : trialStillActive
                  ? 'Stripe collects your card securely. Your active Growth trial is not charged today.'
                  : 'Stripe collects your card securely and charges the selected plan when you confirm checkout.'}
            </p>
          </>
        ) : (
          <p role="alert" className="text-sm text-destructive">Billing status is unavailable.</p>
        )}
      </CardContent>
    </Card>
  );
}

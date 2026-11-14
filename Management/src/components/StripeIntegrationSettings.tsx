import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { integrationAPI } from '../services/api';

type StripeStatus = {
  connected: boolean;
  status: string;
  configured: boolean;
  paymentsReady: boolean;
  account: {
    accountId: string;
    businessName: string | null;
    country: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    livemode: boolean | null;
  } | null;
  lastTestedAt: string | null;
  lastError: string | null;
};

export default function StripeIntegrationSettings() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = async () => {
    const response = await integrationAPI.getStripe();
    setStatus(response.data as StripeStatus);
  };

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('stripe');
    if (result === 'connected') toast.success('Stripe account connected');
    if (result === 'cancelled') toast.error('Stripe connection was cancelled');
    if (result === 'failed') toast.error('Stripe could not finish connecting. Try again.');
    if (result) {
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    loadStatus()
      .catch((error) => toast.error(error?.message || 'Could not load Stripe setup'))
      .finally(() => setLoading(false));
  }, []);

  const connect = async () => {
    const authTab = window.open('about:blank', '_blank');
    if (!authTab) {
      toast.error('Allow pop-ups to connect Stripe, then try again.');
      return;
    }
    authTab.opener = null;
    setConnecting(true);
    try {
      const response = await integrationAPI.startStripeConnect();
      const authorizationUrl = new URL(response.data?.authorizationUrl);
      if (authorizationUrl.origin !== 'https://connect.stripe.com') {
        throw new Error('Stripe did not provide a valid connection link');
      }
      authTab.location.replace(authorizationUrl.toString());
    } catch (error) {
      authTab.close();
      toast.error((error as Error)?.message || 'Could not start Stripe connection');
    } finally {
      setConnecting(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const response = await integrationAPI.testStripe();
      setStatus(response.data as StripeStatus);
      toast.success('Stripe connection verified');
    } catch (error) {
      toast.error((error as Error)?.message || 'Stripe connection could not be verified');
      await loadStatus().catch((loadError) => toast.error((loadError as Error)?.message || 'Could not refresh Stripe status'));
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect this agency’s Stripe account? Online payments through this account will stop.')) return;
    setDisconnecting(true);
    try {
      const response = await integrationAPI.disconnectStripe();
      setStatus(response.data as StripeStatus);
      toast.success('Stripe account disconnected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not disconnect Stripe');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="stripe-integration-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <PlugZap className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="stripe-integration-heading" className="font-semibold text-foreground">Stripe payments</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect this agency&apos;s own Stripe account for its payment setup.
            </p>
          </div>
          {status?.connected && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Connected
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading Stripe setup" />
        ) : (
          <>
            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {status?.connected
                ? `${status.account?.businessName || 'Stripe account'}${status.account?.country ? ` · ${status.account.country}` : ''}${status.account?.livemode === false ? ' · Test mode' : ''}`
                : 'Connect an existing Stripe account. Stripe will securely ask you to authorize this agency.'}
            </p>
            {status?.connected && status.account && (!status.account.chargesEnabled || !status.account.payoutsEnabled) && (
              <p role="status" className="text-sm text-muted-foreground">
                Stripe is connected, but payments or payouts are not fully enabled on this account. Complete any outstanding steps in Stripe.
              </p>
            )}
            {status?.connected && (
              <p role="status" className="text-sm text-muted-foreground">
                {status.paymentsReady
                  ? 'Online invoice checkout and payment reconciliation are ready.'
                  : 'Account connected. Online invoice checkout is not ready yet.'}
              </p>
            )}
            {status?.connected && !status.paymentsReady && (
              <p role="status" className="text-sm text-warning">
                Online checkout needs Lushware&apos;s webhook and public Client URL configured, and charges enabled on this Stripe account.
              </p>
            )}
            {status?.lastError && <p role="alert" className="text-sm text-destructive">{status.lastError}</p>}
            {!status?.configured && (
              <p role="status" className="text-sm text-muted-foreground">
                Stripe Connect has not been configured by Lushware yet.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!status?.connected ? (
                <Button type="button" onClick={connect} disabled={connecting || !status?.configured} className="gap-2">
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {connecting ? 'Opening Stripe…' : status?.configured ? 'Connect Stripe' : 'Setup required'}
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={test} disabled={testing || disconnecting} className="gap-2">
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {testing ? 'Testing…' : 'Test connection'}
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || testing} className="gap-2 text-destructive">
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

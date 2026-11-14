import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { getStripePaymentLink, createStripeCheckout, getStripeCheckoutStatus } from '../services/api/stripePayments';

type PaymentLink = Awaited<ReturnType<typeof getStripePaymentLink>>;

function formatCurrency(minor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100);
}

function parseAmountMinor(value: string) {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

export default function StripeInvoicePaymentPage() {
  const { token = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getStripePaymentLink(token)
      .then((data) => {
        if (!active) return;
        setPaymentLink(data);
        setAmount((data.outstandingMinor / 100).toFixed(2));
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'This payment link is unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  const submitPayment = async () => {
    if (!paymentLink) return;
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor === null || amountMinor < 50 || amountMinor > paymentLink.outstandingMinor) {
      setError(`Enter an amount between ${formatCurrency(50, paymentLink.currency)} and ${formatCurrency(paymentLink.outstandingMinor, paymentLink.currency)}.`);
      return;
    }
    setError('');
    setPaying(true);
    try {
      const checkoutUrl = await createStripeCheckout(token, amountMinor);
      window.location.assign(checkoutUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start secure checkout. Please try again.');
      setPaying(false);
    }
  };

  return (
    <main className="mx-auto min-h-[60vh] max-w-xl px-4 py-16">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Secure invoice payment</p>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Pay your invoice</h1>
        {loading ? (
          <div className="mt-8 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading payment details…
          </div>
        ) : error && !paymentLink ? (
          <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>
        ) : paymentLink?.status === 'paid' ? (
          <p className="mt-6 text-sm text-muted-foreground">This invoice is already paid. Thank you.</p>
        ) : paymentLink ? (
          <>
            <div className="mt-6 rounded-xl bg-muted/50 p-4">
              <p className="text-sm text-muted-foreground">Invoice</p>
              <p className="font-semibold text-foreground">{paymentLink.invoiceNumber}</p>
              <p className="mt-4 text-sm text-muted-foreground">Remaining balance</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(paymentLink.outstandingMinor, paymentLink.currency)}
              </p>
            </div>
            <label htmlFor="stripe-payment-amount" className="mt-6 block text-sm font-medium text-foreground">
              Amount to pay ({paymentLink.currency})
            </label>
            <input
              id="stripe-payment-amount"
              type="number"
              inputMode="decimal"
              min="0.50"
              max={(paymentLink.outstandingMinor / 100).toFixed(2)}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3 text-foreground"
              disabled={paying}
            />
            {searchParams.get('cancelled') && (
              <p className="mt-3 text-sm text-muted-foreground">Checkout was cancelled. You can choose an amount and try again.</p>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
            <Button type="button" onClick={submitPayment} disabled={paying} className="mt-6 w-full">
              {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {paying ? 'Opening secure checkout…' : 'Continue to Stripe'}
            </Button>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Your payment is processed securely by Stripe.
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}

export function StripePaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';
  const [status, setStatus] = useState<'pending' | 'paid' | 'expired' | 'failed' | 'error'>('pending');
  const [loading, setLoading] = useState(Boolean(sessionId));

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      setLoading(false);
      return undefined;
    }
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const nextStatus = await getStripeCheckoutStatus(sessionId);
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus === 'paid' || nextStatus === 'expired' || nextStatus === 'failed' || attempts >= 4) {
          setLoading(false);
          return;
        }
      } catch {
        if (active) {
          setStatus('error');
          setLoading(false);
        }
        return;
      }
      attempts += 1;
      timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return (
    <main className="mx-auto min-h-[60vh] max-w-xl px-4 py-16">
      <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
        {loading && <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />}
        <h1 className="mt-4 text-2xl font-bold text-foreground">
          {status === 'paid' ? 'Payment confirmed'
            : status === 'expired' ? 'Checkout expired'
              : status === 'failed' ? 'Payment failed' : 'Payment received'}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {status === 'paid'
            ? 'Your payment has been added to the invoice.'
            : status === 'expired'
              ? 'This checkout session expired. Please reopen the invoice payment link.'
              : status === 'failed'
                ? 'The payment did not complete. Please reopen the invoice payment link and try again.'
              : status === 'error'
                ? 'We could not confirm the payment status. The agency will reconcile it shortly.'
                : 'Your payment is being confirmed. This page will update automatically.'}
        </p>
      </section>
    </main>
  );
}

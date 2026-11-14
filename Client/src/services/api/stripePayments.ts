import { z } from 'zod';
import httpClient from '../http/client';

const paymentLinkSchema = z.object({
  status: z.enum(['payable', 'paid']),
  invoiceNumber: z.string(),
  currency: z.string().length(3),
  outstandingMinor: z.number().int().nonnegative(),
});

export async function getStripePaymentLink(token: string) {
  const response = await httpClient.get(`/integrations/stripe/payment-links/${encodeURIComponent(token)}`);
  return paymentLinkSchema.parse(response.data?.data);
}

export async function createStripeCheckout(token: string, amountMinor: number) {
  const response = await httpClient.post(
    `/integrations/stripe/payment-links/${encodeURIComponent(token)}/checkout`,
    { amountMinor },
  );
  const data = z.object({ url: z.string().url() }).parse(response.data?.data);
  const url = new URL(data.url);
  if (url.origin !== 'https://checkout.stripe.com') {
    throw new Error('Stripe returned an invalid checkout link.');
  }
  return url.toString();
}

export async function getStripeCheckoutStatus(sessionId: string) {
  const response = await httpClient.get(
    `/integrations/stripe/checkout-sessions/${encodeURIComponent(sessionId)}`,
  );
  return z.object({ status: z.enum(['pending', 'paid', 'expired', 'failed']) }).parse(response.data?.data).status;
}

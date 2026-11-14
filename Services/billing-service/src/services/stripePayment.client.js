const INTEGRATION_SERVICE_URL = process.env.INTEGRATION_SERVICE_URL || 'http://localhost:3015';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

export async function createStripeInvoicePaymentLink({ invoiceId, tenantId, fetchImpl = fetch }) {
  if (!INTERNAL_EVENTS_TOKEN) throw new Error('Stripe payment link service is not configured');
  const response = await fetchImpl(`${INTEGRATION_SERVICE_URL}/api/v1/integrations/internal/stripe/payment-links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({ invoiceId }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) {
    throw new Error('Stripe payment link could not be created');
  }
  return result.data;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));

const AGENCY = '00000000-0000-4000-8000-000000000003';
const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { url: 'https://pay.test/x' } }) });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('INTERNAL_EVENTS_TOKEN', 'internal-token');
});

describe('createStripeInvoicePaymentLink', () => {
  it('asks integration-service for a link for this agency\'s invoice', async () => {
    const { createStripeInvoicePaymentLink } = await import('../stripePayment.client.js');
    const fetchImpl = okFetch();

    const link = await createStripeInvoicePaymentLink({ invoiceId: 'inv-1', tenantId: AGENCY, fetchImpl });

    expect(link).toEqual({ url: 'https://pay.test/x' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ invoiceId: 'inv-1' });
    expect(fetchImpl.mock.calls[0][1].headers['x-tenant-id']).toBe(AGENCY);
  });

  it('sends a Google ID token for integration-service', async () => {
    const { createStripeInvoicePaymentLink } = await import('../stripePayment.client.js');
    const fetchImpl = okFetch();

    await createStripeInvoicePaymentLink({ invoiceId: 'inv-1', tenantId: AGENCY, fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
  });

  it('fails when integration-service refuses', async () => {
    const { createStripeInvoicePaymentLink } = await import('../stripePayment.client.js');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    await expect(createStripeInvoicePaymentLink({ invoiceId: 'inv-1', tenantId: AGENCY, fetchImpl })).rejects.toThrow(/could not be created/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDbQuery,
  mockDbTransaction,
  mockResolveLink,
  mockResolveSession,
  mockDecryptSecret,
  mockFindStripeIntegration,
  mockCreateCheckoutSession,
  mockExpireCheckoutSession,
  mockVerifyWebhook,
} = vi.hoisted(() => ({
  mockDbQuery: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockResolveLink: vi.fn(),
  mockResolveSession: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockFindStripeIntegration: vi.fn(),
  mockCreateCheckoutSession: vi.fn(),
  mockExpireCheckoutSession: vi.fn(),
  mockVerifyWebhook: vi.fn(),
}));

vi.mock('../db.js', () => ({
  tenantDb: {
    query: mockDbQuery,
    transaction: mockDbTransaction,
    resolveStripePaymentLink: mockResolveLink,
    resolveStripeCheckoutSession: mockResolveSession,
  },
}));
vi.mock('../crypto.js', () => ({ decryptSecret: mockDecryptSecret }));
vi.mock('../stripe.controller.js', () => ({ findStripeIntegration: mockFindStripeIntegration }));
vi.mock('../stripe.js', () => ({
  createStripeCheckoutSession: mockCreateCheckoutSession,
  expireStripeCheckoutSession: mockExpireCheckoutSession,
  stripeClientBaseUrl: vi.fn(() => 'https://client.example.test'),
  stripePaymentsConfigured: vi.fn(() => true),
  verifyStripeWebhookSignature: mockVerifyWebhook,
}));

import {
  createPublicStripeCheckout,
  createStripePaymentLink,
  handleStripeWebhook,
} from '../stripePayments.controller.js';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_TOKEN = 'a'.repeat(43);
const LINK = {
  tenantId: TENANT_ID,
  paymentLinkId: '22222222-2222-4222-8222-222222222222',
  invoiceId: '33333333-3333-4333-8333-333333333333',
  integrationId: '44444444-4444-4444-8444-444444444444',
  accountId: 'acct_agency123',
};
const INVOICE_SUMMARY = {
  id: LINK.invoiceId,
  invoiceNumber: 'INV-001',
  currency: 'USD',
  status: 'sent',
  outstandingMinor: 12500,
  customerEmail: 'customer@example.test',
};

function response() {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json: vi.fn(function json(body) { this.body = body; return this; }),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
  process.env.BILLING_SERVICE_URL = 'http://billing.test';
  process.env.CLIENT_URL = 'https://client.example.test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  mockDbQuery.mockResolvedValue({ rows: [] });
  mockDbTransaction.mockImplementation((callback) => callback({ query: mockDbQuery }));
  mockResolveLink.mockResolvedValue(LINK);
  mockResolveSession.mockResolvedValue({
    ...LINK,
    status: 'open',
    linkStatus: 'active',
    amountMinor: 2500,
    currency: 'USD',
  });
  mockDecryptSecret.mockResolvedValue({ accessToken: 'agency-token' });
  mockFindStripeIntegration.mockResolvedValue({
    id: LINK.integrationId,
    status: 'connected',
    config: { accountId: LINK.accountId, chargesEnabled: true },
    secretCiphertext: Buffer.from('encrypted'),
  });
  mockCreateCheckoutSession.mockResolvedValue({
    id: 'cs_test_session123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_session123',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  mockExpireCheckoutSession.mockResolvedValue({});
});

describe('Stripe invoice payment links', () => {
  it('creates a short-lived URL token and stores only its hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: INVOICE_SUMMARY,
    }), { status: 200 })));
    const req = { body: { invoiceId: LINK.invoiceId }, headers: {}, requestId: 'req-1' };
    const res = response();

    await runWithTenant(TENANT_ID, () => createStripePaymentLink(req, res));

    const data = res.body.data;
    expect(data.available).toBe(true);
    expect(data.url).toMatch(/^https:\/\/client\.example\.test\/pay\/invoice\/[A-Za-z0-9_-]{43}$/);
    const insert = mockDbQuery.mock.calls.find(([query]) => query.includes('INSERT INTO crm_integrations."StripePaymentLink"'));
    expect(insert[1][5]).toHaveLength(64);
    expect(insert[1][5]).not.toBe(data.url.split('/').pop());
  });

  it('creates a Checkout Session only for an amount within the live invoice balance', async () => {
    mockResolveLink.mockResolvedValue(LINK);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: INVOICE_SUMMARY,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const req = {
      params: { token: PAYMENT_TOKEN },
      body: { amountMinor: 5000 },
      requestId: 'req-2',
      headers: {},
    };
    const res = response();

    await createPublicStripeCheckout(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.url).toBe('https://checkout.stripe.com/c/pay/cs_test_session123');
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith('agency-token', expect.objectContaining({
      amountMinor: 5000,
      currency: 'USD',
      invoiceId: LINK.invoiceId,
    }));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/payment-summary'),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-tenant-id': TENANT_ID }) }),
    );
  });

  it('rejects a partial amount above the current balance without calling Stripe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: INVOICE_SUMMARY,
    }), { status: 200 })));
    const req = { params: { token: PAYMENT_TOKEN }, body: { amountMinor: 12501 }, headers: {} };
    const res = response();

    await createPublicStripeCheckout(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_PAYMENT_AMOUNT');
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it('does not use a newly connected Stripe account for an old payment link', async () => {
    mockFindStripeIntegration.mockResolvedValue({
      id: LINK.integrationId,
      status: 'connected',
      config: { accountId: 'acct_newagency456', chargesEnabled: true },
      secretCiphertext: Buffer.from('encrypted'),
    });
    const req = { params: { token: PAYMENT_TOKEN }, body: { amountMinor: 2500 }, headers: {} };
    const res = response();

    await createPublicStripeCheckout(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('STRIPE_ACCOUNT_NOT_READY');
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it('records a paid connected-account Checkout webhook and updates session state', async () => {
    const event = {
      id: 'evt_paid',
      type: 'checkout.session.completed',
      account: LINK.accountId,
      data: { object: {
        id: 'cs_test_session123',
        payment_status: 'paid',
        amount_total: 2500,
        currency: 'usd',
        payment_intent: 'pi_test123',
      } },
    };
    mockVerifyWebhook.mockReturnValue(event);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: { ...INVOICE_SUMMARY, status: 'paid', outstandingMinor: 0 },
      }), { status: 200 })));
    const req = {
      body: Buffer.from('{}'),
      headers: { 'stripe-signature': 'verified' },
      log: { error: vi.fn() },
    };
    const res = response();

    await handleStripeWebhook(req, res);

    expect(res.body).toEqual({ received: true });
    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE crm_integrations."StripeCheckoutSession"'),
      expect.arrayContaining(['paid', 'pi_test123', TENANT_ID, 'cs_test_session123']),
    );
  });
});

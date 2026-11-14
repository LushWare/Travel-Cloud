import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStripeCheckoutSession,
  createStripeOAuthState,
  deauthorizeStripeAccount,
  exchangeStripeCode,
  getStripeAccount,
  stripePaymentsConfigured,
  stripeAuthorizationUrl,
  stripeOAuthCallbackUrl,
  verifyStripeOAuthState,
  verifyStripeWebhookSignature,
} from '../stripe.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRIPE_CLIENT_ID;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.PUBLIC_API_URL;
  delete process.env.CLIENT_URL;
  delete process.env.NODE_ENV;
});

function configureStripe() {
  process.env.STRIPE_CLIENT_ID = 'ca_test_platform';
  process.env.STRIPE_SECRET_KEY = 'sk_test_platform_secret';
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  process.env.CLIENT_URL = 'https://client.example.test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
}

describe('Stripe Connect OAuth', () => {
  it('creates a short-lived, tamper-resistant state bound to the agency', () => {
    configureStripe();
    const state = createStripeOAuthState(TENANT_ID);
    const [payload, signature] = state.split('.');
    const changed = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;

    expect(verifyStripeOAuthState(state)?.tenantId).toBe(TENANT_ID);
    expect(verifyStripeOAuthState(`${payload}.${changed}`)).toBeNull();
    expect(verifyStripeOAuthState(`${state}.extra`)).toBeNull();
  });

  it('builds the authorization URL with the registered callback and read-write scope', () => {
    configureStripe();

    const url = new URL(stripeAuthorizationUrl('signed-state'));

    expect(url.origin).toBe('https://connect.stripe.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ca_test_platform');
    expect(url.searchParams.get('scope')).toBe('read_write');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.test/api/v1/integrations/stripe/callback',
    );
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(stripeOAuthCallbackUrl()).toBe('https://api.example.test/api/v1/integrations/stripe/callback');
  });

  it('requires HTTPS for the callback URL in production', () => {
    configureStripe();
    process.env.PUBLIC_API_URL = 'http://api.example.test';
    process.env.NODE_ENV = 'production';

    expect(() => stripeOAuthCallbackUrl()).toThrow('must use HTTPS');
  });

  it('exchanges the authorization code without exposing the platform key in the URL', async () => {
    configureStripe();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'acct_access_token',
      stripe_user_id: 'acct_123',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(exchangeStripeCode('oauth-code')).resolves.toEqual({
      accessToken: 'acct_access_token',
      accountId: 'acct_123',
    });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://connect.stripe.com/oauth/token');
    expect(options.body.get('code')).toBe('oauth-code');
    expect(options.body.get('client_secret')).toBe('sk_test_platform_secret');
  });

  it('rejects malformed connected account responses', async () => {
    configureStripe();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'acct_access_token',
      stripe_user_id: 'not-an-account',
    }), { status: 200 })));

    await expect(exchangeStripeCode('oauth-code')).rejects.toThrow('invalid connected account response');
  });

  it('retrieves the connected account using its encrypted OAuth access token', async () => {
    configureStripe();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'acct_123',
      country: 'US',
      charges_enabled: true,
      payouts_enabled: true,
      livemode: false,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const account = await getStripeAccount('acct_access_token');

    expect(account.id).toBe('acct_123');
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer acct_access_token');
  });

  it('revokes a connected account without putting credentials in the URL', async () => {
    configureStripe();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      stripe_user_id: 'acct_123',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await deauthorizeStripeAccount('acct_123');

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://connect.stripe.com/oauth/deauthorize');
    expect(options.body.get('stripe_user_id')).toBe('acct_123');
    expect(options.body.get('client_secret')).toBe('sk_test_platform_secret');
  });

  it('creates a connected-account Checkout Session with a checked Stripe URL', async () => {
    configureStripe();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'cs_test_abc123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      expires_at: 1_800_000_000,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const session = await createStripeCheckoutSession('connected-access-token', {
      amountMinor: 12500,
      cancelUrl: 'https://client.example.test/pay/invoice/token',
      currency: 'USD',
      customerEmail: 'customer@example.test',
      invoiceId: 'inv-123',
      invoiceNumber: 'INV-001',
      paymentLinkId: 'link-123',
      successUrl: 'https://client.example.test/payment/success?session_id={CHECKOUT_SESSION_ID}',
    });

    expect(session).toEqual({
      id: 'cs_test_abc123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc123',
      expiresAt: new Date(1_800_000_000_000),
    });
    expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer connected-access-token');
    expect(fetch.mock.calls[0][1].body.get('line_items[0][price_data][unit_amount]')).toBe('12500');
    expect(fetch.mock.calls[0][1].body.get('metadata[invoice_id]')).toBe('inv-123');
  });

  it('requires a webhook secret and public client URL before enabling online payments', () => {
    configureStripe();
    expect(stripePaymentsConfigured()).toBe(true);

    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(stripePaymentsConfigured()).toBe(false);
  });

  it('verifies a recent Stripe webhook signature and rejects stale signatures', () => {
    const payload = Buffer.from(JSON.stringify({
      id: 'evt_123',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    }));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'whsec_test_secret')
      .update(`${timestamp}.`)
      .update(payload)
      .digest('hex');
    const header = `t=${timestamp},v1=${signature}`;

    expect(verifyStripeWebhookSignature(payload, header, 'whsec_test_secret')?.id).toBe('evt_123');
    expect(verifyStripeWebhookSignature(payload, `t=${timestamp - 600},v1=${signature}`, 'whsec_test_secret')).toBeNull();
    expect(verifyStripeWebhookSignature(payload, header, 'wrong_secret')).toBeNull();
  });
});

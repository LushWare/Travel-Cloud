import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx } = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  const prisma = {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return { prisma, tx };
});

vi.mock('../../db/client.js', () => ({ default: prisma }));

import {
  changeSubscriptionPlan,
  createSubscriptionCheckout,
  processStripeEvent,
  verifyStripeSignature,
} from '../stripeBilling.service.js';

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((work) => work(tx));
  tx.$executeRaw.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('verifyStripeSignature', () => {
  it('accepts a current signature and rejects changed or stale payloads', () => {
    const secret = 'whsec_test';
    const timestamp = 1_800_000_000;
    const raw = Buffer.from('{"id":"evt_1","type":"test","data":{}}');
    const digest = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(raw)
      .digest('hex');
    const header = `t=${timestamp},v1=${digest}`;

    expect(verifyStripeSignature(raw, header, secret, timestamp)).toEqual({
      id: 'evt_1', type: 'test', data: {},
    });
    expect(verifyStripeSignature(Buffer.from('tampered'), header, secret, timestamp)).toBeNull();
    expect(verifyStripeSignature(raw, header, secret, timestamp + 301)).toBeNull();
  });
});

describe('processStripeEvent', () => {
  it('clears pending checkout state after Stripe completes checkout', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'evt_checkout' }]);

    await processStripeEvent({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          client_reference_id: 'tenant-1',
          metadata: { tenantId: 'tenant-1' },
        },
      },
    });

    const updateSql = tx.$executeRaw.mock.calls[0][0].join('');
    expect(updateSql).toContain('"stripeCheckoutSessionId" = NULL');
    expect(updateSql).toContain('"stripeCheckoutPlanVersionId" = NULL');
    expect(tx.$executeRaw.mock.calls[0]).toContain('sub_1');
  });

  it('does not process a webhook event twice', async () => {
    tx.$queryRaw.mockResolvedValue([]);

    await expect(processStripeEvent({
      id: 'evt_duplicate',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    })).resolves.toEqual({ duplicate: true });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('marks a failed invoice past due without replacing the original grace-period start', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'evt_failed' }]);

    await processStripeEvent({
      id: 'evt_failed',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    });

    const updateSql = tx.$executeRaw.mock.calls[0][0].join('');
    expect(updateSql).toContain('"pastDueAt" = COALESCE("pastDueAt", NOW())');
    expect(updateSql).toContain('"stripeSubscriptionId" = ');
    expect(tx.$executeRaw.mock.calls[0]).toContain('cus_1');
    expect(tx.$executeRaw.mock.calls[0]).toContain('sub_1');
  });

  it('leaves a closed agency alone when its cancelled subscription is reported', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'evt_deleted' }]);

    await processStripeEvent({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    });

    const updateSql = tx.$executeRaw.mock.calls.map((call) => call[0].join('')).find((text) => text.includes('UPDATE crm_platform."Tenant"'));
    expect(updateSql).toContain("status NOT IN ('pending_deletion', 'deleted')");
  });

  it('never reopens a closed agency when a late invoice payment arrives', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'canceled', items: { data: [] } }) }));
    tx.$queryRaw.mockResolvedValue([{ id: 'evt_paid' }]);

    await processStripeEvent({
      id: 'evt_paid',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    });

    const updateSql = tx.$executeRaw.mock.calls.map((call) => call[0].join('')).find((text) => text.includes('"billingSuspended" = false'));
    expect(updateSql).toContain("status NOT IN ('pending_deletion', 'deleted')");
  });

  it('applies the paid plan only after Stripe confirms an active invoice', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'active',
        items: { data: [{ price: { id: 'price_growth' } }] },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'evt_paid' }])
      .mockResolvedValueOnce([{ planVersionId: '00000000-0000-4000-8000-000000000003' }]);

    await processStripeEvent({
      id: 'evt_paid',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    });

    expect(fetch.mock.calls[0][0].toString()).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw.mock.calls[1][0].join('')).toContain('UPDATE crm_platform."TenantPlan"');
  });

  it('does not assign a paid plan when the tenant update is rejected', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'active',
        items: { data: [{ price: { id: 'price_growth' } }] },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'evt_paid_manual_suspend' }])
      .mockResolvedValueOnce([{ planVersionId: '00000000-0000-4000-8000-000000000003' }]);
    tx.$executeRaw.mockResolvedValueOnce(0);

    await processStripeEvent({
      id: 'evt_paid_manual_suspend',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('subscription checkout', () => {
  const growthPlan = {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Growth',
    version: 1,
    priceMinorUnits: 14900,
    currency: 'USD',
    billingInterval: 'monthly',
    key: 'growth',
  };

  it('reuses an open checkout session for the selected plan', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('MANAGEMENT_URL', 'https://app.example.com');
    prisma.$queryRaw.mockResolvedValueOnce([growthPlan]);
    tx.$queryRaw.mockResolvedValueOnce([{
      id: 'tenant-1',
      name: 'Agency',
      trialEndsAt: null,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: 'cs_open',
      stripeCheckoutPlanVersionId: '00000000-0000-4000-8000-000000000003',
      stripeCheckoutGeneration: 1,
    }]);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'open', url: 'https://checkout.stripe.com/open' }),
    });
    vi.stubGlobal('fetch', fetch);

    await expect(createSubscriptionCheckout({
      tenantId: 'tenant-1',
      owner: { name: 'Owner', email: 'owner@example.com' },
      planVersionId: '00000000-0000-4000-8000-000000000003',
    })).resolves.toEqual({ url: 'https://checkout.stripe.com/open' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].toString()).toContain('/checkout/sessions/cs_open');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('clears a missing saved checkout session and starts a fresh checkout', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('MANAGEMENT_URL', 'https://app.example.com');
    prisma.$queryRaw
      .mockResolvedValueOnce([growthPlan])
      .mockResolvedValueOnce([{
        stripeProductId: 'prod_old',
        stripePriceId: 'price_old',
      }])
      .mockResolvedValueOnce([{
        stripeProductId: 'prod_new',
        stripePriceId: 'price_new',
      }]);
    tx.$queryRaw.mockResolvedValueOnce([{
      id: 'tenant-1',
      name: 'Agency',
      trialEndsAt: null,
      stripeCustomerId: 'cus_old',
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: 'cs_missing',
      stripeCheckoutPlanVersionId: growthPlan.id,
      stripeCheckoutGeneration: 1,
    }]);
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: 'No such checkout session',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: 'No such price',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prod_new' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'price_new' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: 'No such customer',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cus_new' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.com/new' }),
      });
    vi.stubGlobal('fetch', fetch);

    await expect(createSubscriptionCheckout({
      tenantId: 'tenant-1',
      owner: { name: 'Owner', email: 'owner@example.com' },
      planVersionId: growthPlan.id,
    })).resolves.toEqual({
      url: 'https://checkout.stripe.com/new',
      recoveredStaleCheckout: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 10_000, timeout: 90_000 },
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain('"stripeCheckoutSessionId" = NULL');
    expect(tx.$executeRaw.mock.calls[0]).toContain('cs_missing');
    expect(tx.$executeRaw.mock.calls[1][0].join('')).toContain('"stripeCustomerId" = NULL');
    expect(tx.$executeRaw.mock.calls[1]).toContain('cus_old');
    expect(tx.$executeRaw.mock.calls[2]).toContain('cus_new');
    expect(tx.$executeRaw.mock.calls[2]).toContain('cs_new');
    const priceInsert = prisma.$executeRaw.mock.calls.find(([query]) =>
      query.join('').includes('INSERT INTO crm_platform."StripePlanPrice"'));
    expect(priceInsert[0].join('')).toContain('ON CONFLICT DO NOTHING');
    expect(priceInsert[0].join('')).not.toContain('ON CONFLICT ("planVersionId")');
    expect(fetch.mock.calls[3][1].headers['Idempotency-Key']).toBe('travel-crm-price-00000000-0000-4000-8000-000000000003');
    expect(fetch.mock.calls[5][1].headers['Idempotency-Key']).toBe('travel-crm-customer-tenant-1-recovery-2');
    const checkoutFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify([growthPlan.id, 'cus_new', 'price_new']))
      .digest('hex');
    expect(fetch.mock.calls[6][1].headers['Idempotency-Key'])
      .toBe(`travel-crm-checkout-tenant-1-2-${checkoutFingerprint}`);
    expect(fetch.mock.calls[6][1].body).not.toContain('expires_at');
    expect(fetch.mock.calls[6][1].body).toContain('customer=cus_new');
    expect(fetch.mock.calls[6][1].body).toContain('line_items%5B0%5D%5Bprice%5D=price_new');
  });

  it('logs Stripe error code and parameter when checkout session creation is rejected', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('MANAGEMENT_URL', 'https://app.example.com');
    prisma.$queryRaw
      .mockResolvedValueOnce([growthPlan])
      .mockResolvedValueOnce([{ stripePriceId: 'price_growth' }]);
    tx.$queryRaw.mockResolvedValueOnce([{
      id: 'tenant-1',
      name: 'Agency',
      trialEndsAt: null,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      stripeCheckoutPlanVersionId: null,
      stripeCheckoutGeneration: 0,
    }]);
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          type: 'invalid_request_error',
          code: 'resource_missing',
          param: 'line_items[0][price]',
          message: 'No such price',
        },
      }),
    });
    vi.stubGlobal('fetch', fetch);

    await expect(createSubscriptionCheckout({
      tenantId: 'tenant-1',
      owner: { name: 'Owner', email: 'owner@example.com' },
      planVersionId: growthPlan.id,
    })).rejects.toThrow(
      'Stripe request failed (400; type=invalid_request_error; code=resource_missing; param=line_items[0][price])',
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('expires a different open session before creating checkout for the selected plan', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    vi.stubEnv('MANAGEMENT_URL', 'https://app.example.com');
    prisma.$queryRaw
      .mockResolvedValueOnce([growthPlan])
      .mockResolvedValueOnce([{ stripePriceId: 'price_growth' }]);
    tx.$queryRaw.mockResolvedValueOnce([{
      id: 'tenant-1',
      name: 'Agency',
      trialEndsAt: null,
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: 'cs_old',
      stripeCheckoutPlanVersionId: '00000000-0000-4000-8000-000000000002',
      stripeCheckoutGeneration: 1,
    }]);
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'open', url: 'https://checkout.stripe.com/old' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'expired' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.com/new' }),
      });
    vi.stubGlobal('fetch', fetch);

    await expect(createSubscriptionCheckout({
      tenantId: 'tenant-1',
      owner: { name: 'Owner', email: 'owner@example.com' },
      planVersionId: growthPlan.id,
    })).resolves.toEqual({ url: 'https://checkout.stripe.com/new' });

    expect(fetch.mock.calls[1][0].toString()).toContain('/checkout/sessions/cs_old/expire');
    const checkoutFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify([growthPlan.id, 'cus_1', 'price_growth']))
      .digest('hex');
    expect(fetch.mock.calls[2][1].headers['Idempotency-Key'])
      .toBe(`travel-crm-checkout-tenant-1-2-${checkoutFingerprint}`);
    expect(tx.$executeRaw.mock.calls[0]).toContain('cs_new');
  });

  it('changes the Stripe subscription item to the mapped plan price', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_secret');
    prisma.$queryRaw
      .mockResolvedValueOnce([{ stripeSubscriptionId: 'sub_1' }])
      .mockResolvedValueOnce([{
        id: '00000000-0000-4000-8000-000000000004',
        name: 'Pro',
        version: 1,
        priceMinorUnits: 34900,
        currency: 'USD',
        billingInterval: 'monthly',
        key: 'pro',
      }])
      .mockResolvedValueOnce([{ stripePriceId: 'price_pro' }]);
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: { data: [{ id: 'si_1' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'sub_1' }),
      });
    vi.stubGlobal('fetch', fetch);

    await expect(changeSubscriptionPlan({
      tenantId: 'tenant-1',
      planVersionId: '00000000-0000-4000-8000-000000000004',
    })).resolves.toEqual({ updated: true });

    const updateForm = new URLSearchParams(fetch.mock.calls[1][1].body);
    expect(updateForm.get('items[0][price]')).toBe('price_pro');
    expect(updateForm.get('proration_behavior')).toBe('always_invoice');
  });
});

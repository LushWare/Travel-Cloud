import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, checkout, portal, changePlan } = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn() },
  checkout: vi.fn(),
  portal: vi.fn(),
  changePlan: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ default: prisma }));
vi.mock('../../services/stripeBilling.service.js', () => ({
  createSubscriptionCheckout: checkout,
  createBillingPortal: portal,
  changeSubscriptionPlan: changePlan,
  processStripeEvent: vi.fn(),
  verifyStripeSignature: vi.fn(),
}));

import { startBillingCheckout } from '../billing.controller.js';

async function call(handler, overrides = {}) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  let error;
  await handler({
    body: { planVersionId: '00000000-0000-4000-8000-000000000001' },
    headers: {
      'x-user-id': 'owner-id',
      'x-user-name': 'Alex Owner',
      'x-user-email': 'alex@example.com',
      'x-tenant-id': '00000000-0000-4000-8000-000000000002',
    },
    log: { error: vi.fn() },
    ...overrides,
  }, res, (caught) => { error = caught; });
  return { res, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$queryRaw.mockResolvedValue([{ isOwner: true, membershipStatus: 'active', tenantStatus: 'trial' }]);
  checkout.mockResolvedValue({ url: 'https://checkout.stripe.test/session' });
});

describe('startBillingCheckout', () => {
  it('starts checkout only for the authenticated agency owner', async () => {
    const { res, error } = await call(startBillingCheckout);

    expect(error).toBeUndefined();
    expect(checkout).toHaveBeenCalledWith({
      tenantId: '00000000-0000-4000-8000-000000000002',
      owner: { name: 'Alex Owner', email: 'alex@example.com' },
      planVersionId: '00000000-0000-4000-8000-000000000001',
    });
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { url: 'https://checkout.stripe.test/session' },
    });
  });

  it('logs stale-session recovery without exposing internal recovery metadata', async () => {
    const warn = vi.fn();
    checkout.mockResolvedValue({
      url: 'https://checkout.stripe.test/session',
      recoveredStaleCheckout: true,
    });

    const { res, error } = await call(startBillingCheckout, {
      log: { error: vi.fn(), warn },
      requestId: 'request-1',
    });

    expect(error).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { url: 'https://checkout.stripe.test/session' },
    });
    expect(warn).toHaveBeenCalledWith(
      { tenantId: '00000000-0000-4000-8000-000000000002', requestId: 'request-1' },
      'A stale Stripe checkout session was cleared before creating a new session',
    );
  });

  it('denies a non-owner before contacting Stripe', async () => {
    prisma.$queryRaw.mockResolvedValue([{ isOwner: false, membershipStatus: 'active', tenantStatus: 'trial' }]);

    const { error } = await call(startBillingCheckout);

    expect(error.statusCode).toBe(403);
    expect(checkout).not.toHaveBeenCalled();
  });

  it('rejects malformed plan identifiers before checking membership', async () => {
    const { error } = await call(startBillingCheckout, { body: { planVersionId: 'growth' } });

    expect(error.statusCode).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

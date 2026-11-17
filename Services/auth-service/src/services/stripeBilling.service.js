import crypto from 'node:crypto';
import prisma from '../db/client.js';

const STRIPE_API = 'https://api.stripe.com/v1';

class StripeRequestError extends Error {
  constructor(status, stripeError) {
    const diagnostics = [
      stripeError?.type && `type=${stripeError.type}`,
      stripeError?.code && `code=${stripeError.code}`,
      stripeError?.param && `param=${stripeError.param}`,
    ].filter(Boolean).join('; ');
    super(`Stripe request failed (${status}${diagnostics ? `; ${diagnostics}` : ''})`);
    this.name = 'StripeRequestError';
    this.status = status;
    this.code = stripeError?.code;
  }
}

function flattenForm(value, prefix = '') {
  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (child === undefined || child === null) continue;
    if (Array.isArray(child)) {
      child.forEach((item, index) => {
        if (item && typeof item === 'object') entries.push(...flattenForm(item, `${name}[${index}]`));
        else entries.push([`${name}[${index}]`, String(item)]);
      });
    } else if (typeof child === 'object') {
      entries.push(...flattenForm(child, name));
    } else {
      entries.push([name, String(child)]);
    }
  }
  return entries;
}

async function stripeRequest(path, { method = 'POST', params = {}, idempotencyKey } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('Stripe Billing is not configured');
  const form = new URLSearchParams(flattenForm(params));
  const url = new URL(`${STRIPE_API}/${path}`);
  const headers = { Authorization: `Bearer ${secret}` };
  const options = { method, headers, signal: AbortSignal.timeout(10_000) };
  if (method === 'GET') {
    url.search = form.toString();
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    options.body = form.toString();
  }
  const response = await fetch(url, options);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new StripeRequestError(response.status, result?.error);
  }
  return result;
}

function isMissingStripeResource(error) {
  return error instanceof StripeRequestError
    && error.status === 404
    && error.code === 'resource_missing';
}

async function getOrCreatePrice(plan, { validateStored = false } = {}) {
  let [stored] = await prisma.$queryRaw`
    SELECT "stripeProductId", "stripePriceId"
      FROM crm_platform."StripePlanPrice"
     WHERE "planVersionId" = ${plan.id}::uuid
     LIMIT 1
  `;
  if (stored && validateStored) {
    try {
      const currentPrice = await stripeRequest(`prices/${stored.stripePriceId}`, { method: 'GET' });
      if (currentPrice.active) return stored;
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error;
    }
    await prisma.$executeRaw`
      DELETE FROM crm_platform."StripePlanPrice"
       WHERE "planVersionId" = ${plan.id}::uuid
         AND "stripePriceId" = ${stored.stripePriceId}
    `;
    stored = null;
  }
  if (stored) return stored;

  const product = await stripeRequest('products', {
    params: {
      name: `${plan.name} (v${plan.version})`,
      metadata: { planKey: plan.key, planVersionId: plan.id },
    },
    idempotencyKey: `travel-crm-product-${plan.id}`,
  });
  const price = await stripeRequest('prices', {
    params: {
      product: product.id,
      currency: plan.currency.trim().toLowerCase(),
      unit_amount: plan.priceMinorUnits,
      recurring: { interval: plan.billingInterval === 'annual' ? 'year' : 'month' },
      metadata: { planKey: plan.key, planVersionId: plan.id },
    },
    idempotencyKey: `travel-crm-price-${plan.id}`,
  });

  await prisma.$executeRaw`
    INSERT INTO crm_platform."StripePlanPrice" ("planVersionId", "stripeProductId", "stripePriceId")
    VALUES (${plan.id}::uuid, ${product.id}, ${price.id})
    ON CONFLICT DO NOTHING
  `;
  const [saved] = await prisma.$queryRaw`
    SELECT "stripeProductId", "stripePriceId"
      FROM crm_platform."StripePlanPrice"
     WHERE "planVersionId" = ${plan.id}::uuid
     LIMIT 1
  `;
  if (!saved) throw new Error('The plan price could not be loaded');
  return saved;
}

export async function createSubscriptionCheckout({ tenantId, owner, planVersionId }) {
  const [plan] = await prisma.$queryRaw`
    SELECT pv.id, pv.name, pv.version, pv."priceMinorUnits", pv.currency, pv."billingInterval", p.key
      FROM crm_platform."PlanVersion" pv
      JOIN crm_platform."Plan" p ON p.id = pv."planId"
     WHERE pv.id = ${planVersionId}::uuid
       AND p."archivedAt" IS NULL
       AND p.key <> 'internal'
       AND pv."priceMinorUnits" IS NOT NULL
       AND pv."billingInterval" IN ('monthly', 'annual')
     LIMIT 1
  `;
  if (!plan) throw new Error('Choose an available paid plan');
  const baseUrl = process.env.MANAGEMENT_URL;
  if (!baseUrl) throw new Error('Management billing return URL is not configured');
  return prisma.$transaction(async (tx) => {
    const [tenant] = await tx.$queryRaw`
      SELECT t.id, t.name, t.status::text AS status, t."trialEndsAt", t."stripeCustomerId",
             t."stripeSubscriptionId", t."stripeCheckoutSessionId",
             t."stripeCheckoutPlanVersionId", t."stripeCheckoutGeneration"
        FROM crm_platform."Tenant" t
       WHERE t.id = ${tenantId}::uuid
       FOR UPDATE
    `;
    if (!tenant) throw new Error('The agency could not be found');
    if (tenant.stripeSubscriptionId) throw new Error('An existing subscription is already linked');

    let recoveredStaleCheckout = false;
    if (tenant.stripeCheckoutSessionId) {
      try {
        const previous = await stripeRequest(`checkout/sessions/${tenant.stripeCheckoutSessionId}`, { method: 'GET' });
        if (previous.status === 'open' && tenant.stripeCheckoutPlanVersionId === plan.id) {
          return { url: previous.url };
        }
        if (previous.status === 'open') {
          await stripeRequest(`checkout/sessions/${tenant.stripeCheckoutSessionId}/expire`);
        } else if (previous.status === 'complete') {
          throw new Error('The existing checkout is still being processed');
        }
      } catch (error) {
        if (!isMissingStripeResource(error)) throw error;
        await tx.$executeRaw`
          UPDATE crm_platform."Tenant"
             SET "stripeCheckoutSessionId" = NULL,
                 "stripeCheckoutPlanVersionId" = NULL,
                 "updatedAt" = NOW()
           WHERE id = ${tenantId}::uuid
             AND "stripeCheckoutSessionId" = ${tenant.stripeCheckoutSessionId}
        `;
        recoveredStaleCheckout = true;
      }
    }

    const generation = (tenant.stripeCheckoutGeneration || 0) + 1;
    const { stripePriceId } = await getOrCreatePrice(plan, {
      validateStored: recoveredStaleCheckout,
    });
    let stripeCustomerId = tenant.stripeCustomerId;
    if (recoveredStaleCheckout && stripeCustomerId) {
      try {
        const customer = await stripeRequest(`customers/${stripeCustomerId}`, { method: 'GET' });
        if (customer.deleted) stripeCustomerId = null;
      } catch (error) {
        if (!isMissingStripeResource(error)) throw error;
        stripeCustomerId = null;
      }
      if (!stripeCustomerId) {
        await tx.$executeRaw`
          UPDATE crm_platform."Tenant"
             SET "stripeCustomerId" = NULL,
                 "updatedAt" = NOW()
           WHERE id = ${tenantId}::uuid
             AND "stripeCustomerId" = ${tenant.stripeCustomerId}
        `;
      }
    }
    const customerId = stripeCustomerId || (await stripeRequest('customers', {
      params: {
        email: owner.email,
        name: owner.name,
        metadata: { tenantId },
      },
      idempotencyKey: recoveredStaleCheckout
        ? `travel-crm-customer-${tenantId}-recovery-${generation}`
        : `travel-crm-customer-${tenantId}`,
    })).id;
    const trialEnd = tenant.trialEndsAt && new Date(tenant.trialEndsAt).getTime() > Date.now()
      ? Math.floor(new Date(tenant.trialEndsAt).getTime() / 1000)
      : undefined;
    const checkoutFingerprint = crypto.createHash('sha256')
      .update(JSON.stringify([plan.id, customerId, stripePriceId]))
      .digest('hex');
    const session = await stripeRequest('checkout/sessions', {
      params: {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: tenantId,
        line_items: [{ price: stripePriceId, quantity: 1 }],
        success_url: `${baseUrl}/settings?billing=success`,
        cancel_url: `${baseUrl}/settings?billing=cancelled`,
        metadata: { tenantId, planVersionId: plan.id },
        subscription_data: {
          ...(trialEnd && { trial_end: trialEnd }),
          metadata: { tenantId, planVersionId: plan.id },
        },
      },
      idempotencyKey: `travel-crm-checkout-${tenantId}-${generation}-${checkoutFingerprint}`,
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    await tx.$executeRaw`
      UPDATE crm_platform."Tenant"
         SET "stripeCustomerId" = ${customerId},
             "stripeCheckoutSessionId" = ${session.id},
             "stripeCheckoutPlanVersionId" = ${plan.id}::uuid,
             "stripeCheckoutGeneration" = ${generation},
             "updatedAt" = NOW()
       WHERE id = ${tenantId}::uuid
    `;
    return recoveredStaleCheckout
      ? { url: session.url, recoveredStaleCheckout: true }
      : { url: session.url };
  }, { maxWait: 10_000, timeout: 90_000 });
}

export async function createBillingPortal({ tenantId, returnUrl }) {
  const [tenant] = await prisma.$queryRaw`
    SELECT "stripeCustomerId" FROM crm_platform."Tenant"
     WHERE id = ${tenantId}::uuid LIMIT 1
  `;
  if (!tenant?.stripeCustomerId) throw new Error('Add a payment method by starting checkout first');
  const session = await stripeRequest('billing_portal/sessions', {
    params: { customer: tenant.stripeCustomerId, return_url: returnUrl },
  });
  if (!session.url) throw new Error('Stripe did not return a billing portal URL');
  return { url: session.url };
}

export async function changeSubscriptionPlan({ tenantId, planVersionId }) {
  const [tenant] = await prisma.$queryRaw`
    SELECT "stripeSubscriptionId"
      FROM crm_platform."Tenant"
     WHERE id = ${tenantId}::uuid
     LIMIT 1
  `;
  if (!tenant?.stripeSubscriptionId) throw new Error('Start a subscription before changing plans');
  const [plan] = await prisma.$queryRaw`
    SELECT pv.id, pv.name, pv.version, pv."priceMinorUnits", pv.currency, pv."billingInterval", p.key
      FROM crm_platform."PlanVersion" pv
      JOIN crm_platform."Plan" p ON p.id = pv."planId"
     WHERE pv.id = ${planVersionId}::uuid
       AND p."archivedAt" IS NULL
       AND p.key <> 'internal'
       AND pv."priceMinorUnits" IS NOT NULL
       AND pv."billingInterval" IN ('monthly', 'annual')
     LIMIT 1
  `;
  if (!plan) throw new Error('Choose an available paid plan');
  const { stripePriceId } = await getOrCreatePrice(plan);
  const subscription = await stripeRequest(`subscriptions/${tenant.stripeSubscriptionId}`, { method: 'GET' });
  const itemId = subscription.items?.data?.[0]?.id;
  if (!itemId) throw new Error('The active subscription has no plan item');
  await stripeRequest(`subscriptions/${tenant.stripeSubscriptionId}`, {
    params: {
      items: [{ id: itemId, price: stripePriceId }],
      proration_behavior: 'always_invoice',
    },
    idempotencyKey: `travel-crm-change-plan-${tenant.stripeSubscriptionId}-${plan.id}-${Math.floor(Date.now() / 60000)}`,
  });
  return { updated: true };
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || !signatureHeader || !secret) return null;
  const parts = signatureHeader.split(',').reduce((result, part) => {
    const [key, value] = part.split('=', 2);
    if (key && value) result[key] = [...(result[key] || []), value];
    return result;
  }, {});
  const timestamp = Number(parts.t?.[0]);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const matches = (parts.v1 || []).some((candidate) => {
    if (!/^[\da-f]{64}$/i.test(candidate)) return false;
    const actual = Buffer.from(candidate, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
  if (!matches) return null;
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

export async function processStripeEvent(event) {
  const object = event.data?.object || {};
  const invoiceSubscription = object.subscription || object.parent?.subscription_details?.subscription;
  const invoiceSubscriptionId = typeof invoiceSubscription === 'string'
    ? invoiceSubscription
    : invoiceSubscription?.id;
  const paidSubscription = event.type === 'invoice.payment_succeeded' && invoiceSubscriptionId
    ? await stripeRequest(`subscriptions/${invoiceSubscriptionId}`, { method: 'GET' })
    : null;
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$queryRaw`
      INSERT INTO crm_platform."StripeWebhookEvent" (id, type)
      VALUES (${event.id}, ${event.type})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (!inserted.length) return { duplicate: true };

    const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    if (event.type === 'checkout.session.completed') {
      const tenantId = object.metadata?.tenantId || object.client_reference_id;
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (tenantId && subscriptionId && customerId) {
        await tx.$executeRaw`
          UPDATE crm_platform."Tenant"
             SET "stripeCustomerId" = ${customerId},
                 "stripeSubscriptionId" = ${subscriptionId},
                 "stripeCheckoutSessionId" = NULL,
                 "stripeCheckoutPlanVersionId" = NULL,
                 "updatedAt" = NOW()
           WHERE id = ${tenantId}::uuid
        `;
      }
    } else if (event.type === 'invoice.payment_failed') {
      await tx.$executeRaw`
        UPDATE crm_platform."Tenant"
           SET status = 'past_due',
               "pastDueAt" = COALESCE("pastDueAt", NOW()),
               "pastDueReminderLevel" = CASE WHEN status = 'past_due' THEN "pastDueReminderLevel" ELSE 0 END,
               "updatedAt" = NOW()
         WHERE "stripeCustomerId" = ${customerId}
           AND "stripeSubscriptionId" = ${invoiceSubscriptionId}
           AND status IN ('trial', 'active', 'past_due')
      `;
    } else if (event.type === 'invoice.payment_succeeded') {
      const restoredTenantCount = await tx.$executeRaw`
        UPDATE crm_platform."Tenant"
           SET status = CASE WHEN "trialEndsAt" > NOW() THEN 'trial'::crm_platform."TenantStatus"
                             ELSE 'active'::crm_platform."TenantStatus" END,
               "pastDueAt" = NULL,
               "pastDueReminderLevel" = 0,
               "billingSuspended" = false,
               "updatedAt" = NOW()
         WHERE "stripeCustomerId" = ${customerId}
           AND "stripeSubscriptionId" = ${invoiceSubscriptionId}
           AND (status IN ('trial', 'active', 'past_due') OR "billingSuspended")
           AND status NOT IN ('pending_deletion', 'deleted')
      `;
      const paidPriceId = paidSubscription?.status === 'active'
        ? paidSubscription.items?.data?.[0]?.price?.id
        : null;
      if (restoredTenantCount > 0 && paidPriceId) {
        const [price] = await tx.$queryRaw`
          SELECT "planVersionId" FROM crm_platform."StripePlanPrice"
           WHERE "stripePriceId" = ${paidPriceId} LIMIT 1
        `;
        if (price?.planVersionId) {
          await tx.$executeRaw`
            UPDATE crm_platform."TenantPlan"
               SET "planVersionId" = ${price.planVersionId}::uuid,
                   "priceMinorUnits" = (
                     SELECT "priceMinorUnits" FROM crm_platform."PlanVersion" WHERE id = ${price.planVersionId}::uuid
                   ),
                   currency = (
                     SELECT currency FROM crm_platform."PlanVersion" WHERE id = ${price.planVersionId}::uuid
                   ),
                   "assignedAt" = NOW(),
                   "updatedAt" = NOW()
             WHERE "tenantId" = (
               SELECT id FROM crm_platform."Tenant"
                WHERE "stripeCustomerId" = ${customerId}
                  AND "stripeSubscriptionId" = ${invoiceSubscriptionId}
                LIMIT 1
             )
          `;
        }
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscriptionId = object.id;
      const currentPeriodEnd = object.current_period_end
        ? new Date(object.current_period_end * 1000)
        : null;
      const subscriptionStatus = event.type === 'customer.subscription.deleted' ? 'canceled' : object.status;
      await tx.$executeRaw`
        UPDATE crm_platform."Tenant"
           SET status = CASE
                 WHEN ${subscriptionStatus} = 'canceled' THEN 'suspended'::crm_platform."TenantStatus"
                 WHEN ${subscriptionStatus} IN ('past_due', 'unpaid', 'incomplete_expired') THEN 'past_due'::crm_platform."TenantStatus"
                 WHEN ${subscriptionStatus} = 'trialing' THEN 'trial'::crm_platform."TenantStatus"
                 WHEN ${subscriptionStatus} = 'active' THEN status
                 ELSE status
               END,
               "pastDueAt" = CASE WHEN ${subscriptionStatus} IN ('past_due', 'unpaid', 'incomplete_expired')
                                  THEN COALESCE("pastDueAt", NOW()) ELSE "pastDueAt" END,
               "subscriptionCurrentPeriodEnd" = ${currentPeriodEnd},
               "stripeCustomerId" = COALESCE("stripeCustomerId", ${customerId}),
               "stripeSubscriptionId" = CASE WHEN ${subscriptionStatus} = 'canceled' THEN NULL ELSE ${subscriptionId} END,
               "cancelAtPeriodEnd" = CASE WHEN ${subscriptionStatus} = 'canceled' THEN false ELSE ${Boolean(object.cancel_at_period_end)} END,
               "billingSuspended" = CASE
                 WHEN ${subscriptionStatus} = 'canceled' AND status <> 'suspended' THEN true
                 ELSE "billingSuspended"
               END,
               "updatedAt" = NOW()
         WHERE "stripeSubscriptionId" = ${subscriptionId}
           AND (status <> 'suspended' OR "billingSuspended" OR ${subscriptionStatus} = 'canceled')
           -- A closed agency cancels its own subscription; the resulting event must not reopen or suspend it.
           AND status NOT IN ('pending_deletion', 'deleted')
      `;
    }
    return { duplicate: false };
  });
}

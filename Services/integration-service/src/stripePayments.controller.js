import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireTenantId, runWithTenant } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret } from './crypto.js';
import { findStripeIntegration } from './stripe.controller.js';
import {
  createStripeCheckoutSession,
  expireStripeCheckoutSession,
  stripeClientBaseUrl,
  stripePaymentsConfigured,
  verifyStripeWebhookSignature,
} from './stripe.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);
const sessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/);
const createLinkSchema = z.object({ invoiceId: z.string().uuid() }).strict();
const checkoutSchema = z.object({ amountMinor: z.number().int().min(50).max(999_999_999) }).strict();
const PAYMENT_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'AUD', 'INR', 'LKR']);

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function integrationBaseUrl() {
  const value = process.env.BILLING_SERVICE_URL ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3006');
  if (!value) throw new Error('Billing service URL is not configured');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Billing service URL is invalid');
  return url.toString().replace(/\/+$/, '');
}

async function callBilling(path, tenantId, body) {
  const internalToken = process.env.INTERNAL_EVENTS_TOKEN;
  if (!internalToken) throw new Error('Internal service token is not configured');
  const response = await fetch(`${integrationBaseUrl()}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-internal-token': internalToken,
      'x-tenant-id': tenantId,
      ...(body && { 'content-type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.success !== true) {
    const error = new Error('Billing service could not process the Stripe payment request');
    error.status = response.status;
    throw error;
  }
  return result.data;
}

async function getInvoicePaymentSummary(tenantId, invoiceId) {
  return callBilling(
    `/api/v1/billing/invoices/internal/${encodeURIComponent(invoiceId)}/payment-summary`,
    tenantId,
  );
}

async function createLink(tenantId, invoiceId) {
  if (!stripePaymentsConfigured()) return { available: false, reason: 'stripe_setup_incomplete' };
  const integration = await findStripeIntegration(tenantId);
  if (
    !integration ||
    integration.status !== 'connected' ||
    integration.config?.chargesEnabled !== true ||
    !integration.config?.accountId
  ) {
    return { available: false, reason: 'stripe_account_not_ready' };
  }
  const summary = await getInvoicePaymentSummary(tenantId, invoiceId);
  if (!summary || !PAYMENT_CURRENCIES.has(summary.currency)) {
    return { available: false, reason: 'invoice_currency_unsupported' };
  }
  if (!Number.isSafeInteger(summary.outstandingMinor) || summary.outstandingMinor <= 0) {
    return { available: false, reason: 'invoice_not_payable' };
  }

  const token = randomBytes(32).toString('base64url');
  const linkId = randomUUID();
  await tenantDb.transaction(async (db) => {
    await db.query(
      `INSERT INTO crm_integrations."StripePaymentLink"
         (id, "tenantId", "integrationId", "accountId", "invoiceId", "tokenHash", status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [linkId, tenantId, integration.id, integration.config.accountId, invoiceId, hashToken(token)],
    );
  });
  return {
    available: true,
    url: `${stripeClientBaseUrl()}/pay/invoice/${token}`,
  };
}

export async function createStripePaymentLink(req, res) {
  const parsed = createLinkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'A valid invoice is required.' });
  }
  const tenantId = requireTenantId();
  const result = await createLink(tenantId, parsed.data.invoiceId);
  return res.json({ success: true, data: result });
}

export async function getPublicStripePaymentLink(req, res) {
  const parsed = tokenSchema.safeParse(req.params.token);
  if (!parsed.success) return res.status(404).json({ success: false, code: 'PAYMENT_LINK_NOT_FOUND' });
  const link = await tenantDb.resolveStripePaymentLink(hashToken(parsed.data));
  if (!link || !link.accountId) {
    return res.status(404).json({ success: false, code: 'PAYMENT_LINK_NOT_FOUND', message: 'This payment link is unavailable.' });
  }
  const summary = await getInvoicePaymentSummary(link.tenantId, link.invoiceId);
  if (summary.status === 'cancelled' || summary.status === 'draft') {
    return res.status(410).json({ success: false, code: 'INVOICE_NOT_PAYABLE', message: 'This invoice is no longer available for payment.' });
  }
  if (!Number.isSafeInteger(summary.outstandingMinor) || summary.outstandingMinor <= 0) {
    return res.json({
      success: true,
      data: { status: 'paid', invoiceNumber: summary.invoiceNumber, currency: summary.currency, outstandingMinor: 0 },
    });
  }
  if (!PAYMENT_CURRENCIES.has(summary.currency)) {
    return res.status(422).json({ success: false, code: 'UNSUPPORTED_CURRENCY', message: 'Online payment is unavailable for this invoice currency.' });
  }
  return res.json({
    success: true,
    data: {
      status: 'payable',
      invoiceNumber: summary.invoiceNumber,
      currency: summary.currency,
      outstandingMinor: summary.outstandingMinor,
    },
  });
}

async function activeCheckout(invoiceId, tenantId) {
  const result = await tenantDb.query(
    `SELECT "sessionId", "amountMinor", currency, "checkoutUrl", "expiresAt"
       FROM crm_integrations."StripeCheckoutSession"
      WHERE "tenantId" = $1 AND "invoiceId" = $2 AND status = 'open'
      ORDER BY "createdAt" DESC
      LIMIT 1`,
    [tenantId, invoiceId],
  );
  return result.rows[0] || null;
}

async function expireLocalSession(tenantId, sessionId) {
  await tenantDb.query(
    `UPDATE crm_integrations."StripeCheckoutSession"
        SET status = 'expired', "updatedAt" = now()
      WHERE "tenantId" = $1 AND "sessionId" = $2 AND status = 'open'`,
    [tenantId, sessionId],
  );
}

export async function createPublicStripeCheckout(req, res) {
  const token = tokenSchema.safeParse(req.params.token);
  const body = checkoutSchema.safeParse(req.body ?? {});
  if (!token.success || !body.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Enter a valid payment amount.' });
  }
  const link = await tenantDb.resolveStripePaymentLink(hashToken(token.data));
  if (!link || !link.accountId) {
    return res.status(404).json({ success: false, code: 'PAYMENT_LINK_NOT_FOUND', message: 'This payment link is unavailable.' });
  }
  if (!stripePaymentsConfigured()) {
    return res.status(503).json({ success: false, code: 'STRIPE_PAYMENTS_UNAVAILABLE', message: 'Online payments are temporarily unavailable.' });
  }

  const result = await runWithTenant(link.tenantId, async () => {
    const integration = await findStripeIntegration(link.tenantId);
    if (
      !integration ||
      integration.status !== 'connected' ||
      integration.config?.accountId !== link.accountId ||
      integration.config?.chargesEnabled !== true
    ) {
      return { status: 409, body: { success: false, code: 'STRIPE_ACCOUNT_NOT_READY', message: 'This agency cannot accept online payments right now.' } };
    }

    const summary = await getInvoicePaymentSummary(link.tenantId, link.invoiceId);
    if (
      summary.status === 'draft' ||
      summary.status === 'cancelled' ||
      !Number.isSafeInteger(summary.outstandingMinor) ||
      summary.outstandingMinor <= 0
    ) {
      return { status: 409, body: { success: false, code: 'INVOICE_NOT_PAYABLE', message: 'This invoice is no longer available for payment.' } };
    }
    if (
      !PAYMENT_CURRENCIES.has(summary.currency) ||
      body.data.amountMinor > summary.outstandingMinor ||
      body.data.amountMinor < 50
    ) {
      return { status: 400, body: { success: false, code: 'INVALID_PAYMENT_AMOUNT', message: 'Choose an amount within the invoice balance.' } };
    }

    const secret = await decryptSecret(integration);
    const existing = await activeCheckout(link.invoiceId, link.tenantId);
    if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
      if (Number(existing.amountMinor) === body.data.amountMinor && existing.currency === summary.currency) {
        return { status: 200, body: { success: true, data: { url: existing.checkoutUrl } } };
      }
      try {
        await expireStripeCheckoutSession(secret.accessToken, existing.sessionId);
      } catch {
        return { status: 409, body: { success: false, code: 'CHECKOUT_ALREADY_OPEN', message: 'A checkout is already open for this payment link. Finish or close it before choosing another amount.' } };
      }
      await expireLocalSession(link.tenantId, existing.sessionId);
    } else if (existing) {
      await expireLocalSession(link.tenantId, existing.sessionId);
    }

    const clientBase = stripeClientBaseUrl();
    const session = await createStripeCheckoutSession(secret.accessToken, {
      amountMinor: body.data.amountMinor,
      cancelUrl: `${clientBase}/pay/invoice/${token.data}?cancelled=1`,
      currency: summary.currency,
      customerEmail: summary.customerEmail || undefined,
      invoiceId: link.invoiceId,
      invoiceNumber: summary.invoiceNumber,
      paymentLinkId: link.paymentLinkId,
      successUrl: `${clientBase}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    });
    try {
      await tenantDb.transaction(async (db) => {
        await db.query(
          `INSERT INTO crm_integrations."StripeCheckoutSession"
             (id, "tenantId", "paymentLinkId", "invoiceId", "sessionId", "accountId", "amountMinor",
              currency, "checkoutUrl", status, "expiresAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10)`,
          [
            randomUUID(), link.tenantId, link.paymentLinkId, link.invoiceId, session.id,
            link.accountId, body.data.amountMinor, summary.currency, session.url, session.expiresAt,
          ],
        );
      });
    } catch (error) {
      try {
        await expireStripeCheckoutSession(secret.accessToken, session.id);
      } catch (expireError) {
        req.log?.error?.({ tenantId: link.tenantId, err: expireError }, 'Orphan Stripe Checkout Session could not be expired');
      }
      if (error?.code === '23505') {
        return { status: 409, body: { success: false, code: 'CHECKOUT_ALREADY_OPEN', message: 'A checkout is already open for this payment link. Finish or close it before choosing another amount.' } };
      }
      throw error;
    }
    return { status: 200, body: { success: true, data: { url: session.url } } };
  }, req.requestId);
  return res.status(result.status).json(result.body);
}

export async function getPublicStripeCheckoutStatus(req, res) {
  const parsed = sessionIdSchema.safeParse(req.params.sessionId);
  if (!parsed.success) return res.status(404).json({ success: false, code: 'CHECKOUT_NOT_FOUND' });
  const session = await tenantDb.resolveStripeCheckoutSession(parsed.data);
  if (!session) return res.status(404).json({ success: false, code: 'CHECKOUT_NOT_FOUND' });
  return res.json({
    success: true,
    data: {
      status: session.status === 'paid' ? 'paid'
        : session.status === 'expired' ? 'expired'
          : session.status === 'failed' ? 'failed' : 'pending',
    },
  });
}

async function updateCheckoutStatus(tenantId, sessionId, status, paymentIntentId = null, linkStatus = null) {
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."StripeCheckoutSession"
          SET status = $1, "paymentIntentId" = COALESCE($2, "paymentIntentId"), "updatedAt" = now()
        WHERE "tenantId" = $3 AND "sessionId" = $4`,
      [status, paymentIntentId, tenantId, sessionId],
    );
    if (linkStatus) {
      await db.query(
        `UPDATE crm_integrations."StripePaymentLink"
            SET status = $1, "updatedAt" = now()
          WHERE "tenantId" = $2
            AND id = (SELECT "paymentLinkId" FROM crm_integrations."StripeCheckoutSession"
                       WHERE "tenantId" = $2 AND "sessionId" = $3)`,
        [linkStatus, tenantId, sessionId],
      );
    }
  });
}

async function reconcileCheckoutPayment(session, mapping) {
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  await callBilling(
    `/api/v1/billing/invoices/internal/${encodeURIComponent(mapping.invoiceId)}/stripe-payment`,
    mapping.tenantId,
    {
      checkoutSessionId: session.id,
      paymentIntentId: paymentIntentId || null,
      amountMinor: session.amount_total,
      currency: session.currency?.toUpperCase(),
    },
  );
  const summary = await getInvoicePaymentSummary(mapping.tenantId, mapping.invoiceId);
  await updateCheckoutStatus(
    mapping.tenantId,
    session.id,
    'paid',
    paymentIntentId || null,
    summary.outstandingMinor <= 0 ? 'paid' : null,
  );
}

export async function handleStripeWebhook(req, res) {
  const event = verifyStripeWebhookSignature(
    req.body,
    req.headers['stripe-signature'],
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  if (!event) {
    return res.status(process.env.STRIPE_WEBHOOK_SECRET ? 400 : 503)
      .json({ success: false, code: 'INVALID_STRIPE_WEBHOOK' });
  }

  if (![
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
  ].includes(event.type)) {
    return res.json({ received: true });
  }
  const session = event.data.object;
  const sessionId = session?.id;
  const mapping = typeof sessionId === 'string'
    ? await tenantDb.resolveStripeCheckoutSession(sessionId)
    : null;
  if (!mapping) return res.json({ received: true });
  if (event.account !== mapping.accountId) {
    req.log?.error?.({ providerEventId: event.id }, 'Stripe webhook connected account did not match checkout');
    return res.status(400).json({ success: false, code: 'STRIPE_ACCOUNT_MISMATCH' });
  }
  if (mapping.status === 'paid' || mapping.status === 'expired') return res.json({ received: true });

  return runWithTenant(mapping.tenantId, async () => {
    if (event.type === 'checkout.session.expired') {
      await updateCheckoutStatus(mapping.tenantId, sessionId, 'expired');
      return res.json({ received: true });
    }
    if (event.type === 'checkout.session.async_payment_failed') {
      await updateCheckoutStatus(mapping.tenantId, sessionId, 'failed');
      return res.json({ received: true });
    }
    if (session.payment_status !== 'paid') return res.json({ received: true });
    if (
      Number(session.amount_total) !== Number(mapping.amountMinor) ||
      typeof session.currency !== 'string' ||
      session.currency.toUpperCase() !== mapping.currency
    ) {
      req.log?.error?.({ providerEventId: event.id }, 'Stripe webhook payment amount did not match checkout');
      return res.status(400).json({ success: false, code: 'STRIPE_PAYMENT_MISMATCH' });
    }

    await reconcileCheckoutPayment(session, mapping);
    return res.json({ received: true });
  }, req.requestId);
}

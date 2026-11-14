import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const STRIPE_CONNECT = 'https://connect.stripe.com';
const STRIPE_API = 'https://api.stripe.com';
const oauthStateSchema = z.object({
  tenantId: z.string().uuid(),
  nonce: z.string().min(32).max(128),
  expiresAt: z.number().int().positive(),
});
const accountSchema = z.object({
  id: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  country: z.string().length(2).nullable().optional(),
  business_profile: z.object({ name: z.string().nullable().optional() }).passthrough().nullable().optional(),
  settings: z.object({
    dashboard: z.object({ display_name: z.string().nullable().optional() }).passthrough().optional(),
  }).passthrough().optional(),
  charges_enabled: z.boolean(),
  payouts_enabled: z.boolean(),
  livemode: z.boolean().optional(),
}).passthrough();

export class StripeConnectError extends Error {
  constructor(status, code) {
    super(`Stripe Connect request failed with status ${status}`);
    this.name = 'StripeConnectError';
    this.status = status;
    this.providerCode = code || null;
  }
}

export function stripeConnectConfigured() {
  return Boolean(process.env.STRIPE_CLIENT_ID && process.env.STRIPE_SECRET_KEY);
}

export function stripePaymentsConfigured() {
  return stripeConnectConfigured() && Boolean(process.env.STRIPE_WEBHOOK_SECRET) && Boolean(clientBaseUrl());
}

function clientBaseUrl() {
  const value = process.env.CLIENT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function stripeClientBaseUrl() {
  const value = clientBaseUrl();
  if (!value) throw new Error('Public client URL must be configured and use HTTPS in production');
  return value;
}

function stripeConfig() {
  const clientId = process.env.STRIPE_CLIENT_ID;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!clientId || !secretKey) throw new Error('Stripe Connect is not configured');
  return { clientId, secretKey };
}

function publicApiBaseUrl() {
  const value = process.env.PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!value) throw new Error('Public API URL is not configured');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Public API URL must use HTTP or HTTPS');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Public API URL must use HTTPS in production');
  }
  return url.toString().replace(/\/+$/, '');
}

export function stripeOAuthCallbackUrl() {
  return `${publicApiBaseUrl()}/api/v1/integrations/stripe/callback`;
}

export function createStripeOAuthState(tenantId, expiresAt = Date.now() + 10 * 60 * 1000) {
  const { secretKey } = stripeConfig();
  const claims = {
    tenantId,
    nonce: randomBytes(32).toString('base64url'),
    expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secretKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyStripeOAuthState(state) {
  if (typeof state !== 'string' || state.length > 2048) return null;
  const [payload, receivedSignature, extra] = state.split('.');
  if (!payload || !receivedSignature || extra !== undefined) return null;
  const { secretKey } = stripeConfig();
  const expected = createHmac('sha256', secretKey).update(payload).digest();
  let received;
  try {
    received = Buffer.from(receivedSignature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claims = oauthStateSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function stripeAuthorizationUrl(state) {
  const { clientId } = stripeConfig();
  const url = new URL(`${STRIPE_CONNECT}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'read_write');
  url.searchParams.set('redirect_uri', stripeOAuthCallbackUrl());
  url.searchParams.set('state', state);
  return url.toString();
}

async function providerResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data?.error) {
    throw new StripeConnectError(response.status, data?.error?.code || data?.error);
  }
  return data;
}

export async function exchangeStripeCode(code) {
  const { secretKey } = stripeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_secret: secretKey,
  });
  const response = await fetch(`${STRIPE_CONNECT}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await providerResponse(response);
  if (typeof data.access_token !== 'string' || !data.access_token ||
      typeof data.stripe_user_id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(data.stripe_user_id)) {
    throw new Error('Stripe returned an invalid connected account response');
  }
  return { accessToken: data.access_token, accountId: data.stripe_user_id };
}

export async function getStripeAccount(accessToken) {
  const response = await fetch(`${STRIPE_API}/v1/account`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await providerResponse(response);
  return accountSchema.parse(data);
}

export async function deauthorizeStripeAccount(accountId) {
  const { clientId, secretKey } = stripeConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    stripe_user_id: accountId,
    client_secret: secretKey,
  });
  const response = await fetch(`${STRIPE_CONNECT}/oauth/deauthorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return providerResponse(response);
}

export async function createStripeCheckoutSession(accessToken, {
  amountMinor,
  cancelUrl,
  currency,
  customerEmail,
  invoiceId,
  invoiceNumber,
  paymentLinkId,
  successUrl,
}) {
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: invoiceId,
    'line_items[0][price_data][currency]': currency.toLowerCase(),
    'line_items[0][price_data][product_data][name]': `Invoice ${invoiceNumber}`,
    'line_items[0][price_data][unit_amount]': String(amountMinor),
    'line_items[0][quantity]': '1',
    'metadata[invoice_id]': invoiceId,
    'metadata[payment_link_id]': paymentLinkId,
    'payment_intent_data[metadata][invoice_id]': invoiceId,
    'payment_intent_data[metadata][payment_link_id]': paymentLinkId,
  });
  if (customerEmail) body.set('customer_email', customerEmail);
  const response = await fetch(`${STRIPE_API}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await providerResponse(response);
  if (
    typeof data.id !== 'string' ||
    !/^cs_(test|live)_[A-Za-z0-9]+$/.test(data.id) ||
    typeof data.url !== 'string' ||
    typeof data.expires_at !== 'number'
  ) {
    throw new Error('Stripe returned an invalid Checkout Session');
  }
  const checkoutUrl = new URL(data.url);
  if (checkoutUrl.origin !== 'https://checkout.stripe.com') {
    throw new Error('Stripe returned an invalid Checkout URL');
  }
  return { id: data.id, url: checkoutUrl.toString(), expiresAt: new Date(data.expires_at * 1000) };
}

export async function expireStripeCheckoutSession(accessToken, sessionId) {
  const response = await fetch(`${STRIPE_API}/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  return providerResponse(response);
}

export function verifyStripeWebhookSignature(payload, signature, secret, now = Date.now()) {
  if (!Buffer.isBuffer(payload) || typeof signature !== 'string' || !secret) return null;
  const parts = signature.split(',').map((part) => part.split('=', 2));
  const timestampText = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  const timestamp = Number(timestampText);
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > 300 || signatures.length === 0) {
    return null;
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(payload)
    .digest();
  const valid = signatures.some((value) => {
    let received;
    try {
      received = Buffer.from(value, 'hex');
    } catch {
      return false;
    }
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!valid) return null;
  try {
    const event = JSON.parse(payload.toString('utf8'));
    return typeof event.id === 'string' && typeof event.type === 'string' && event.data?.object
      ? event
      : null;
  } catch {
    return null;
  }
}

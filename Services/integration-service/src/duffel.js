import { z } from 'zod';

// An agency's own Duffel account (flight search and booking). Tickets are paid from that
// account's Duffel balance, never Lushware's.

const DUFFEL_BASE_URL = 'https://api.duffel.com';
const TIMEOUT_MS = 10_000;

// Booking updates flight-service acts on (see flight-service duffelWebhook.controller.js).
export const DUFFEL_WEBHOOK_EVENTS = [
  'order.created',
  'order.creation_failed',
  'air.order.changed',
  'order.airline_initiated_change_detected',
  'order_cancellation.confirmed',
];

export const duffelTokenSchema = z.object({
  accessToken: z.string().trim().regex(/^duffel_(test|live)_[A-Za-z0-9_-]{10,256}$/),
}).strict();

/** 'test' or 'live', from the token's own prefix. */
export const duffelModeOf = (accessToken) => (accessToken.startsWith('duffel_live_') ? 'live' : 'test');

async function duffelRequest(accessToken, path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${DUFFEL_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'duffel-version': 'v2',
      accept: 'application/json',
      ...(body && { 'content-type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const error = new Error(`Duffel ${method} ${path.split('?')[0]} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

/** Throws unless Duffel accepts the token. Reads one airline, the cheapest call any token may make. */
export async function verifyDuffelToken(accessToken, options) {
  await duffelRequest(accessToken, '/air/airlines?limit=1', options);
}

/**
 * Registers our booking-update address in the agency's Duffel account. Duffel shows the signing
 * secret only here, once. Duffel allows one webhook per mode and refuses localhost, so a caller
 * must treat failure as "no automatic updates", not as a failed connection.
 */
export async function createDuffelWebhook(accessToken, url, options) {
  const result = await duffelRequest(accessToken, '/air/webhooks', {
    ...options,
    method: 'POST',
    body: { data: { url, events: DUFFEL_WEBHOOK_EVENTS } },
  });
  const webhook = result?.data;
  if (!webhook?.id || !webhook?.secret) throw new Error('Duffel did not return the webhook secret');
  return { id: webhook.id, secret: webhook.secret };
}

export async function deleteDuffelWebhook(accessToken, webhookId, options) {
  await duffelRequest(accessToken, `/air/webhooks/${encodeURIComponent(webhookId)}`, { ...options, method: 'DELETE' });
}

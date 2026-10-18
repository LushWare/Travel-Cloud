const LEAD_SERVICE_URL = process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

/**
 * Hand a mapped Facebook Lead Ads submission to lead-service, which owns
 * lead creation/dedup/assignment. notification-service must not write to
 * lead-service's tables directly.
 */
export async function submitFacebookLead({ leadgenId, name, email, phone, message, source, fetchImpl = fetch }) {
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/facebook-lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
    },
    body: JSON.stringify({ leadgenId, name, email, phone, message, source }),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit Facebook lead to lead-service (status ${res.status})`);
  }
  return res.json();
}

/**
 * Log an inbound WhatsApp message or an outbound delivery-status callback
 * onto the matching lead's timeline. lead-service resolves `phone` to a
 * lead itself and no-ops (not an error) when nothing matches, so an
 * unrecognized number never fails the webhook.
 */
export async function logWhatsappCommunication({ phone, notes, occurredAt, fetchImpl = fetch }) {
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/communication-logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
    },
    body: JSON.stringify({ phone, type: 'whatsapp', notes, occurredAt }),
  });
  if (!res.ok) {
    throw new Error(`Failed to log WhatsApp communication to lead-service (status ${res.status})`);
  }
  return res.json();
}

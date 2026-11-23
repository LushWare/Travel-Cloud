import { cloudRunAuthHeader } from './cloudRunAuth.js';

const LEAD_SERVICE_URL = process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

/**
 * Emit a lifecycle event to lead-service. The lead service owns lifecycle
 * transitions; billing only reports document/payment facts.
 */
export async function emitLeadEvent({
  type,
  leadId,
  payload = {},
  id,
  occurredAt,
  fetchImpl = fetch,
}) {
  const eventId = id || `${type}-${leadId}-${Date.now()}`;
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      ...(await cloudRunAuthHeader(LEAD_SERVICE_URL)),
    },
    body: JSON.stringify({
      event: { id: eventId, type, leadId, payload, occurredAt: occurredAt || new Date().toISOString() },
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to emit ${type} event to lead-service`);
  }
  return res.json();
}

/**
 * Append a note to a lead's communications timeline (e.g. "Invoice INV-1
 * sent via WhatsApp"). Best-effort from the caller's perspective — a
 * document send has already succeeded by the time this runs, so a failure
 * here shouldn't be treated as a failed send by callers.
 */
export async function logLeadCommunication({ leadId, type, notes, fetchImpl = fetch }) {
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/communication-logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      ...(await cloudRunAuthHeader(LEAD_SERVICE_URL)),
    },
    body: JSON.stringify({ leadId, type, notes }),
  });
  if (!res.ok) {
    throw new Error(`Failed to log communication to lead-service (status ${res.status})`);
  }
  return res.json();
}

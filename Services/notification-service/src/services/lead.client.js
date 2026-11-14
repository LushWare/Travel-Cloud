import { isTenantId } from '../../../shared/tenancy/src/context.js';
import { getCloudRunAuthorization } from './cloudRunAuth.js';

const LEAD_SERVICE_URL = process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

export async function submitGoogleAdsLead({ tenantId, ...payload }, fetchImpl = fetch) {
  if (!isTenantId(tenantId)) throw new Error('Valid agency context is required for Google Ads leads');
  const authHeaders = await getCloudRunAuthorization(LEAD_SERVICE_URL);
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/google-ads-lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      'x-tenant-id': tenantId,
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit Google Ads lead to lead-service (status ${res.status})`);
  }
  return res.json();
}

/**
 * Log an inbound WhatsApp message or an outbound delivery-status callback
 * onto the matching lead's timeline. lead-service resolves `phone` to a
 * lead itself and no-ops (not an error) when nothing matches, so an
 * unrecognized number never fails the webhook.
 */
export async function logWhatsappCommunication({ tenantId, phone, notes, occurredAt, fetchImpl = fetch }) {
  if (!isTenantId(tenantId)) throw new Error('Valid agency context is required for WhatsApp communications');
  const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/communication-logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify({ phone, type: 'whatsapp', notes, occurredAt }),
  });
  if (!res.ok) {
    throw new Error(`Failed to log WhatsApp communication to lead-service (status ${res.status})`);
  }
  return res.json();
}

import { assertPlanFeature, metered } from './plan.service.js';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

/**
 * Free-form WhatsApp reply from an agent, sent via notification-service
 * (the only service holding Meta credentials). Only valid within Meta's
 * 24h session window — the caller is responsible for that check; Meta
 * itself is the authoritative enforcement.
 */
export async function sendWhatsappText({ to, body, fetchImpl = fetch }) {
  await assertPlanFeature('whatsapp');
  return metered('whatsapp', async () => {
    const res = await fetchImpl(`${NOTIFICATION_SERVICE_URL}/api/v1/notifications/internal/whatsapp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': INTERNAL_EVENTS_TOKEN,
      },
      body: JSON.stringify({ type: 'text', to, body, meta: { sourceService: 'lead-service', kind: 'agent-reply' } }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data?.message || `Failed to send WhatsApp reply (status ${res.status})`);
      err.statusCode = res.status;
      throw err;
    }
    return res.json();
  });
}

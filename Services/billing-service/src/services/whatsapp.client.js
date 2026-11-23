import { cloudRunAuthHeader } from './cloudRunAuth.js';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

/**
 * Send a pre-approved WhatsApp message template via notification-service,
 * which is the only service holding Meta Cloud API credentials.
 */
export async function sendWhatsappTemplate({
  to, templateName, languageCode, headerDocumentUrl, headerDocumentFilename, bodyParams, fetchImpl = fetch,
}) {
  const res = await fetchImpl(`${NOTIFICATION_SERVICE_URL}/api/v1/notifications/internal/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_EVENTS_TOKEN, ...(await cloudRunAuthHeader(NOTIFICATION_SERVICE_URL)) },
    body: JSON.stringify({
      type: 'template',
      to,
      templateName,
      languageCode,
      headerDocument: headerDocumentUrl ? { link: headerDocumentUrl, filename: headerDocumentFilename } : undefined,
      bodyParams,
      meta: { sourceService: 'billing-service', kind: templateName },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `Failed to send WhatsApp message via notification-service (status ${res.status})`);
  }
  return res.json();
}

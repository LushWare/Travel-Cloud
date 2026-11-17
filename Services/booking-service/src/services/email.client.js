import { cloudRunAuthHeader } from './cloudRunAuth.js';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';

export async function sendEmail({ to, subject, html, text, from, attachments, meta, fetchImpl = fetch }) {
  const res = await fetchImpl(`${NOTIFICATION_SERVICE_URL}/api/v1/notifications/internal/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': INTERNAL_EVENTS_TOKEN,
      // notification-service is private on Cloud Run; without this the call is refused at its edge.
      ...(await cloudRunAuthHeader(NOTIFICATION_SERVICE_URL)),
    },
    body: JSON.stringify({ to, subject, html, text, from, attachments, meta }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send email via notification-service (status ${res.status})`);
  }
  return res.json();
}

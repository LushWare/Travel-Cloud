import { cloudRunAuthHeader } from './cloudRunAuth.js';
import logger from '../config/logger.js';

const LEAD_SERVICE_URL = process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_EVENTS_TOKEN = process.env.INTERNAL_EVENTS_TOKEN || '';
const INTAKE_TIMEOUT_MS = 2000;

/**
 * Best-effort submission of a chatbot wizard lead to lead-service's internal
 * intake endpoint (`POST /leads/internal/intake`), gated by the same
 * `x-internal-token` header convention the notification-service/billing-service
 * clients use (see lead.client.js / events.client.js).
 *
 * Never throws past its own boundary: a 2-second timeout (AbortController),
 * non-2xx response, or network error is logged and surfaced as `{ ok: false }`,
 * so a caller doesn't need its own try/catch for the common cases. The intake
 * call is informational plumbing for the wizard turn — it must never affect
 * what gets returned to the customer.
 */
export async function submitLeadIntake(payload, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTAKE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${LEAD_SERVICE_URL}/api/v1/leads/internal/intake`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': INTERNAL_EVENTS_TOKEN,
        ...(await cloudRunAuthHeader(LEAD_SERVICE_URL)),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Failed to submit lead intake to lead-service — non-2xx response');
      return { ok: false };
    }

    const data = await res.json();
    return { ok: true, ...data };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    logger.error({ err, timeout: aborted ? INTAKE_TIMEOUT_MS : undefined }, 'Lead intake submission failed');
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

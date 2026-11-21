import { cloudRunAuthHeader } from '../utils/cloudRunAuth.js';
import logger from '../config/logger.js';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const maskEmail = (email) => `***@${String(email).split('@')[1] || ''}`;

const route = (booking) => {
  const segments = booking.segments || [];
  if (!segments.length) return '';
  return ` (${segments[0].origin} → ${segments[segments.length - 1].destination})`;
};

/**
 * Emails the rep who made the booking that the airline changed or cancelled it. Never throws:
 * the booking change is already saved, and a lost email must not make Duffel resend the event.
 */
export async function emailAirlineChange(booking, kind, { fetchImpl = fetch } = {}) {
  const to = booking.bookedByEmail;
  if (!to) {
    logger.warn({ bookingId: booking.id, kind }, 'Airline change on a booking with no rep email; shown in the CRM only');
    return false;
  }
  const base = process.env.NOTIFICATION_SERVICE_URL
    || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3008');
  if (!base) {
    logger.error({ bookingId: booking.id }, 'NOTIFICATION_SERVICE_URL is not set; airline change email not sent');
    return false;
  }
  const pnr = booking.pnr ? ` ${booking.pnr}` : '';
  const what = kind === 'cancelled' ? 'was cancelled outside the CRM' : 'was changed by the airline';
  const subject = `Action needed: flight booking${pnr} ${what}`;
  const managementUrl = (process.env.MANAGEMENT_URL || 'http://localhost:5174').replace(/\/$/, '');
  const text = [
    `Flight booking${pnr}${route(booking)} ${what}.`,
    kind === 'cancelled'
      ? 'Check the booking, then arrange the customer\'s refund or a new flight.'
      : 'Check the new times with the customer and offer a change or refund if they no longer suit.',
    `Open Flights > Bookings: ${managementUrl}/flights?tab=bookings`,
  ].join('\n\n');

  try {
    const url = `${base.replace(/\/$/, '')}/api/v1/notifications/internal/email`;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
        ...(await cloudRunAuthHeader(url)),
      },
      body: JSON.stringify({
        to, subject, text, html: escapeHtml(text).replace(/\n/g, '<br>'),
        meta: { sourceService: 'flight-service', kind: 'flight.airline_change' },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`notification-service returned ${response.status}`);
    logger.info({ bookingId: booking.id, kind, to: maskEmail(to) }, 'Airline change emailed to the booking rep');
    return true;
  } catch (error) {
    logger.error({ bookingId: booking.id, kind, err: { message: error.message } }, 'Airline change email could not be sent');
    return false;
  }
}

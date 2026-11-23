import { cloudRunAuthHeader } from './cloudRunAuth.js';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';

/** Posts one email to notification-service's internal relay; on Cloud Run it also carries an ID token. */
async function relayEmail({ to, subject, html, text, internalToken, fetchImpl }) {
  const url = `${NOTIFICATION_SERVICE_URL}/api/v1/notifications/internal/email`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalToken,
      ...(await cloudRunAuthHeader(url)),
    },
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!response.ok) throw new Error(`Notification service returned ${response.status}.`);
  return response.json();
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export async function sendPlatformSetupEmail({ user, token, purpose, fetchImpl = fetch }) {
  const internalToken = process.env.INTERNAL_EVENTS_TOKEN;
  if (!internalToken) throw new Error('INTERNAL_EVENTS_TOKEN is required to send Console staff email.');
  const baseUrl = process.env.PLATFORM_CONSOLE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5175');
  if (!baseUrl) throw new Error('PLATFORM_CONSOLE_URL is required in production.');

  const setupUrl = `${baseUrl.replace(/\/$/, '')}/#/setup?token=${encodeURIComponent(token)}`;
  const reset = purpose === 'authenticator_reset';
  const subject = reset ? 'Reset your Lush Console authenticator' : 'Set up your Lush Console access';
  const intro = reset
    ? 'An administrator reset your authenticator app. Use this link to enroll your new authenticator.'
    : 'You have been invited to the Lush Console. Use this link to set up your password and authenticator app.';
  const name = escapeHtml(user.name);
  const link = escapeHtml(setupUrl);
  const text = `${intro}\n\nThis one-time link expires in 48 hours:\n${setupUrl}\n\nIf you did not expect this email, contact your Lushware administrator.`;
  const html = `<p>Hello ${name},</p><p>${escapeHtml(intro)}</p><p><a href="${link}">Continue setup</a></p><p>This one-time link expires in 48 hours.</p><p>If you did not expect this email, contact your Lushware administrator.</p>`;

  return relayEmail({ to: user.email, subject, html, text, internalToken, fetchImpl });
}
/** Tells an agency owner the outcome of Lushware's review of their sign-up. */
export async function sendSignupDecisionEmail({ owner, agencyName, approved, fetchImpl = fetch }) {
  const internalToken = process.env.INTERNAL_EVENTS_TOKEN;
  if (!internalToken) throw new Error('INTERNAL_EVENTS_TOKEN is required to send sign-up decision email.');
  const managementUrl = (process.env.MANAGEMENT_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5174')).replace(/\/$/, '');

  const name = escapeHtml(owner.name || 'there');
  const agency = escapeHtml(agencyName);
  const subject = approved ? `${agencyName} is ready` : `About your ${agencyName} sign-up`;
  const text = approved
    ? `Hello ${owner.name || 'there'},\n\nYour agency ${agencyName} has been approved. Your 14-day free trial starts today.\n\nSign in: ${managementUrl}/login`
    : `Hello ${owner.name || 'there'},\n\nThank you for signing up. We are not able to open ${agencyName} at this time.\n\nIf you think this is a mistake, reply to this email.`;
  const html = approved
    ? `<p>Hello ${name},</p><p>Your agency <strong>${agency}</strong> has been approved. Your 14-day free trial starts today.</p><p><a href="${escapeHtml(`${managementUrl}/login`)}">Sign in</a></p>`
    : `<p>Hello ${name},</p><p>Thank you for signing up. We are not able to open <strong>${agency}</strong> at this time.</p><p>If you think this is a mistake, reply to this email.</p>`;

  return relayEmail({ to: owner.email, subject, html, text, internalToken, fetchImpl });
}

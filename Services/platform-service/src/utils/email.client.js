const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';

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

  const response = await fetchImpl(`${NOTIFICATION_SERVICE_URL}/api/v1/notifications/internal/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': internalToken },
    body: JSON.stringify({ to: user.email, subject, html, text }),
  });
  if (!response.ok) throw new Error(`Notification service returned ${response.status}.`);
  return response.json();
}
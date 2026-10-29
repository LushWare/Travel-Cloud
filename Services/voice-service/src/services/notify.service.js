import { maskPhone } from '../utils/phone.js';
import { domainAuthHeader } from '../utils/cloudRunAuth.js';

const TIMEOUT_MS = 8000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function post(base, path, body, requestId, tokenEnv) {
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`${tokenEnv} is not configured`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        ...(await domainAuthHeader(base)),
        'content-type': 'application/json',
        'x-internal-token': token,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNotifyTargets(requestId) {
  const base = process.env.USER_SERVICE_URL || 'http://localhost:3002';
  const token = process.env.INTERNAL_SERVICE_KEY;
  if (!token) throw new Error('INTERNAL_SERVICE_KEY is not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/v1/sales-reps/internal/notify-targets`, {
      headers: {
        ...(await domainAuthHeader(base)),
        'x-internal-token': token,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`notify-targets → ${res.status}`);
    const json = await res.json();
    return json?.data?.reps ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function buildEmail({ call, slots, managementUrl }) {
  const rows = [
    ['Caller', maskPhone(call.fromNumber)],
    ['When', new Date(call.startedAt).toUTCString()],
    ['Length', call.durationSec != null ? `${Math.floor(call.durationSec / 60)}m ${call.durationSec % 60}s` : 'unknown'],
    ['Destination', slots.destination],
    ['Travellers', slots.travelers],
    ['Nights', slots.duration],
    ['Budget', slots.budget],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');

  const table = rows.map(([k, v]) => (
    `<tr><td style="padding:4px 14px 4px 0;color:#666;white-space:nowrap">${escapeHtml(k)}</td>` +
    `<td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`
  )).join('');

  // The caller's full number is deliberately omitted — it is one click away in
  // Management, behind login, and this mail lands in several inboxes.
  const html =
    `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111;line-height:1.5">` +
    `<p style="margin:0 0 12px"><strong>The voice agent promised this caller a callback.</strong></p>` +
    (call.summary ? `<p style="margin:0 0 14px;color:#333">${escapeHtml(call.summary)}</p>` : '') +
    `<table style="border-collapse:collapse;margin-bottom:16px">${table}</table>` +
    (managementUrl
      ? `<p style="margin:0"><a href="${escapeHtml(managementUrl)}" style="background:#0B7A85;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;display:inline-block">Open the lead</a></p>`
      : '') +
    `<p style="margin:18px 0 0;color:#888;font-size:12px">Sent automatically because the agent could not resolve the call. Full transcript and recording are on the lead's AI tab.</p>` +
    `</div>`;

  const subject = slots.destination
    ? `Callback needed — ${slots.destination} enquiry`
    : 'Callback needed — voice agent call';

  return { subject, html };
}

/**
 * Tells the sales team a call needs a human.
 *
 * The agent tells callers "one of our team will get back to you shortly", and
 * without this nothing acts on that promise — the lead is flagged and waits for
 * someone to notice a filter. Best-effort by design: a failure here is logged
 * and swallowed, never allowed to fail the webhook, because ElevenLabs would then
 * retry the whole call and duplicate the work.
 */
export async function notifyRepsOfCallback({ call, slots = {}, leadId }, log, requestId) {
  const reps = await fetchNotifyTargets(requestId);
  if (!reps.length) {
    log?.warn('No active sales reps to notify about a callback');
    return { notified: 0 };
  }

  const managementBase = (process.env.MANAGEMENT_URL || '').replace(/\/$/, '');
  const managementUrl = managementBase && leadId ? `${managementBase}/leads?lead=${leadId}` : null;
  const { subject, html } = buildEmail({ call, slots, managementUrl });

  await post(
    process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008',
    '/api/v1/notifications/internal/email',
    { to: reps.map((r) => r.email), subject, html, meta: { source: 'voice-agent', leadId } },
    requestId,
    'INTERNAL_EVENTS_TOKEN',
  );

  log?.info({ notified: reps.length, leadId }, 'Sales team notified of a promised callback');
  return { notified: reps.length };
}

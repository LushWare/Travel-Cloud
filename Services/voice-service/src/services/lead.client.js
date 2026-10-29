import AppError from '../utils/appError.js';
import { domainAuthHeader } from '../utils/cloudRunAuth.js';

const BASE = () => process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
const LOOKUP_TIMEOUT_MS = 2000;
const INTAKE_TIMEOUT_MS = 15000;
const LIVE_READ_TIMEOUT_MS = 3000;
const LIVE_WRITE_TIMEOUT_MS = 8000;
const ITINERARY_ADJUST_TIMEOUT_MS = 18000;
const AUTO_QUOTE_TIMEOUT_MS = 45000;

async function call(path, { method = 'POST', body, requestId, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  const token = process.env.INTERNAL_EVENTS_TOKEN;
  if (!token) throw new AppError('INTERNAL_EVENTS_TOKEN is not configured', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}${path}`, {
      method,
      headers: {
        // Cloud Run rejects an unauthenticated call at its edge (403) before the
        // container runs — see cloudRunAuth.js. This is empty off Cloud Run, so
        // local development still talks to plain http://localhost URLs.
        ...(await domainAuthHeader(BASE())),
        'content-type': 'application/json',
        'x-internal-token': token,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(data?.message || `lead-service ${res.status}`, 502);
    return data?.data ?? data;
  } finally {
    clearTimeout(timer);
  }
}

export function submitIntake(payload, requestId) {
  return call('/api/v1/leads/internal/intake', {
    body: payload,
    requestId,
    timeoutMs: INTAKE_TIMEOUT_MS,
  });
}

export function logCallCommunication({ leadId, phone, notes, occurredAt }, requestId) {
  return call('/api/v1/leads/internal/communication-logs', {
    body: { ...(leadId ? { leadId } : { phone }), type: 'call', notes, occurredAt },
    requestId,
    timeoutMs: INTAKE_TIMEOUT_MS,
  });
}

export function lookupLeadsByPhone(phone, requestId) {
  const q = encodeURIComponent(phone);
  return call(`/api/v1/leads/internal/by-phone?phone=${q}`, { method: 'GET', requestId });
}

// ─── Live in-call actions ────────────────────────────────────────
export function getTripBrief(leadId, requestId) {
  return call(`/api/v1/leads/internal/${leadId}/trip-brief`, { method: 'GET', requestId, timeoutMs: LIVE_READ_TIMEOUT_MS });
}

export function getPaymentBrief(leadId, requestId) {
  return call(`/api/v1/leads/internal/${leadId}/payment-brief`, { method: 'GET', requestId, timeoutMs: LIVE_READ_TIMEOUT_MS });
}

export function attachPackage(leadId, packageId, requestId) {
  return call(`/api/v1/leads/internal/${leadId}/packages/attach`, {
    body: { packageId }, requestId, timeoutMs: LIVE_WRITE_TIMEOUT_MS,
  });
}

export function adjustItinerary(leadId, changes, requestId) {
  return call(`/api/v1/leads/internal/${leadId}/itinerary/adjust`, {
    body: changes, requestId, timeoutMs: ITINERARY_ADJUST_TIMEOUT_MS,
  });
}

export function previewPricing(leadId, requestId) {
  return call(`/api/v1/leads/internal/${leadId}/pricing/preview`, {
    method: 'POST', requestId, timeoutMs: LIVE_WRITE_TIMEOUT_MS,
  });
}

export function issueVoiceQuotation(payload, requestId) {
  return call('/api/v1/leads/internal/voice-auto-quote', {
    body: payload,
    requestId,
    timeoutMs: AUTO_QUOTE_TIMEOUT_MS,
  });
}

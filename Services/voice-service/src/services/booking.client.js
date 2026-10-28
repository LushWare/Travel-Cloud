import AppError from '../utils/appError.js';
import { domainAuthHeader } from '../utils/cloudRunAuth.js';

const BASE = () => process.env.BOOKING_SERVICE_URL || 'http://localhost:3005';
const TIMEOUT_MS = 15000;

export async function requestVoiceBooking(payload, requestId) {
  const token = process.env.INTERNAL_EVENTS_TOKEN;
  if (!token) throw new AppError('INTERNAL_EVENTS_TOKEN is not configured', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const base = BASE();
    const response = await fetch(`${base}/api/v1/bookings/internal/voice`, {
      method: 'POST',
      headers: {
        ...(await domainAuthHeader(base)),
        'content-type': 'application/json',
        'x-internal-token': token,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok && !result?.data?.reviewRequired) {
      throw new AppError(result?.message || `booking-service ${response.status}`, 502);
    }
    return result?.data ?? result;
  } finally {
    clearTimeout(timer);
  }
}
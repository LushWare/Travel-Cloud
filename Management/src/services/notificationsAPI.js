import { API_BASE_URL, authFetch } from '../lib/authFetch';

export const NOTIFICATIONS_CLIENT_TIMEOUT_MS = 20_000;
export const NOTIFICATIONS_ABORT_CODE = 'NOTIFICATIONS_ABORTED';
export const NOTIFICATIONS_TIMEOUT_CODE = 'NOTIFICATIONS_TIMEOUT';

function abortError() {
  const error = new Error('Notification request cancelled');
  error.name = 'AbortError';
  error.code = NOTIFICATIONS_ABORT_CODE;
  error.aborted = true;
  return error;
}

function timeoutError() {
  const error = new Error('Notifications took too long to load. Try again.');
  error.name = 'TimeoutError';
  error.code = NOTIFICATIONS_TIMEOUT_CODE;
  return error;
}

export function isNotificationsAbort(error) {
  return Boolean(error) && (
    error.aborted === true
    || error.code === NOTIFICATIONS_ABORT_CODE
    || error.name === 'AbortError'
  );
}

async function request(path, payload, signal) {
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, NOTIFICATIONS_CLIENT_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener?.('abort', forwardAbort);

  try {
    const response = await authFetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.message || `Notification request failed (HTTP ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === NOTIFICATIONS_ABORT_CODE) {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}

/**
 * @param {{ signal?: AbortSignal }} [options]
 */
export function notificationsFetch({ signal } = {}) {
  return request('/assistant/management/notifications', {}, signal);
}

/**
 * @param {{ keys: string[], action: 'read' | 'acknowledge' | 'dismiss', signal?: AbortSignal }} options
 */
export function notificationsSeen({ keys, action, signal }) {
  return request('/assistant/management/notifications/seen', { keys, action }, signal);
}

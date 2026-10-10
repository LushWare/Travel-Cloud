/**
 * Turns whatever a failed request produced into a sentence written for a user.
 *
 * The backend guarantees that any `message` it sends is safe to show: the error
 * handler emits a generic sentence unless the error explicitly marks itself
 * operational. This covers what the backend cannot — no response at all (offline,
 * DNS, timeout) and errors raised inside the app.
 *
 * `error.message` is deliberately never returned. It is where axios puts
 * "Request failed with status code 500", "Network Error" and
 * "timeout of 15000ms exceeded".
 */

const NETWORK_MESSAGE = "We couldn't reach the server. Check your connection and try again.";
const SERVER_MESSAGE = 'Something went wrong on our side. Please try again.';
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

// Mirrors the backend's generic table, so a status the server reported without a
// message reads the same as one it did report a message for.
const MESSAGE_BY_STATUS: Record<number, string> = {
  400: "We couldn't process that request. Please check the details and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for.",
  409: 'That conflicts with an existing record. Please refresh and try again.',
  429: 'Too many requests. Please wait a moment and try again.',
};

export interface FieldError {
  field: string;
  message: string;
}

interface ServerPayload {
  message?: unknown;
  errors?: unknown;
}

interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  isNetworkError?: unknown;
  code?: unknown;
  errors?: unknown;
  issues?: unknown;
  data?: ServerPayload;
  response?: { status?: unknown; data?: ServerPayload };
  fieldErrors?: unknown;
}

function asRecord(value: unknown): ErrorLike {
  return (typeof value === 'object' && value !== null ? value : {}) as ErrorLike;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function statusOf(error: ErrorLike): number | undefined {
  const status = error.status ?? error.statusCode ?? error.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function payloadOf(error: ErrorLike): ServerPayload | undefined {
  return error.data ?? error.response?.data;
}

/** The sentence to show. Never the raw `error.message`. */
export function apiErrorMessage(error: unknown): string {
  const e = asRecord(error);

  if (e.isNetworkError === true || statusOf(e) === 0) return NETWORK_MESSAGE;

  const fromServer = firstNonEmptyString(payloadOf(e)?.message);
  if (fromServer) return fromServer;

  const status = statusOf(e);
  if (status === undefined) return FALLBACK_MESSAGE;
  if (status >= 500) return SERVER_MESSAGE;

  return MESSAGE_BY_STATUS[status] ?? FALLBACK_MESSAGE;
}

/** Field-level validation detail, when the server sent any. */
export function apiFieldErrors(error: unknown): FieldError[] {
  const e = asRecord(error);
  const raw = payloadOf(e)?.errors ?? e.errors ?? e.fieldErrors ?? e.issues;
  if (!Array.isArray(raw)) return [];

  const out: FieldError[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { field, path, message } = entry as { field?: unknown; path?: unknown; message?: unknown };
    const normalizedField =
      typeof field === 'string' ? field : Array.isArray(path) ? path.join('.') : undefined;
    if (typeof message === 'string') out.push({ field: normalizedField || 'form', message });
  }
  return out;
}

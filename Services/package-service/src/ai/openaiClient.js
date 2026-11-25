import AppError from '../utils/appError.js';
import logger from '../config/logger.js';
import { BAD_GATEWAY, SERVICE_UNAVAILABLE } from '../constants/httpStatus.js';
import { stripOptionalNulls, toOpenAIJsonSchema } from './openaiSchema.js';

// OpenAI adapter behind aiClient.js — same contract as geminiClient.js's
// generateStructured, so aiClient can put either provider behind one call.
//
// Plain `fetch` against the Responses API rather than the `openai` SDK: the SDK
// requires Node 22 and every service image is node:20-slim. One POST and its
// error shape is all this needs.
//
// Both default models are reasoning models (they report reasoning tokens), so
// no `temperature` is sent — the model pages do not list it as supported, and a
// rejected parameter would fail every request. `reasoning.effort` is the knob
// instead: `low` keeps the default model's latency inside the client's 15s AI
// timeout. Not every model accepts `none` (gpt-6.1-terra and gpt-6-luna do,
// gpt-6.2-sol rejects it), so the effort follows the model through env.
const API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'low';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
// See geminiClient.js: a retry handed less time than a healthy answer takes only
// turns a clean provider failure into a timeout.
const MIN_RETRY_TIMEOUT_MS = 5_000;
// Both models' documented output ceiling; reasoning tokens count against it.
const MAX_OUTPUT_TOKENS_CEILING = 128_000;
const MAX_RETRY_DELAY_MS = 60_000;
// OpenAI sends an exhausted balance as a 429 too, but no wait fixes it: retrying
// only delays the Gemini fallback (measured: ~6s spent on a dead account).
const NON_RETRYABLE_CODES = new Set(['insufficient_quota']);

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Aborts the request itself on timeout (unlike a Promise.race), so a slow
// attempt stops consuming a connection and tokens once it is abandoned.
async function postResponses(body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw Object.assign(new Error(payload?.error?.message || `OpenAI responded ${res.status}`), {
        status: res.status,
        code: payload?.error?.code,
        retryAfterMs: retryAfterMs(res.headers),
      });
    }
    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') throw Object.assign(new Error('AI request timed out'), { isTimeout: true });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// OpenAI names its own wait on 429s; honoured (capped) instead of the fixed backoff.
function retryAfterMs(headers) {
  const ms = Number(headers?.get?.('retry-after-ms'));
  if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_DELAY_MS);
  const seconds = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  return null;
}

/** The reply text, or the refusal when the model declined. */
export function extractOutput(response) {
  let text = '';
  let refusal = '';
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text += part.text;
      if (part?.type === 'refusal' && typeof part.refusal === 'string') refusal += part.refusal;
    }
  }
  return { text: text.trim(), refusal: refusal.trim() };
}

/**
 * Calls OpenAI with a JSON-Schema-constrained response and returns the parsed
 * object. Same options and failure contract as geminiClient's generateStructured
 * (`timeoutMs` per attempt, optional `deadlineMs` for the whole call,
 * `allowTruncated` for callers that validate a partial answer); `model` here is
 * an OpenAI model id. `temperature` is accepted for signature parity and ignored
 * — see the file header.
 */
export async function generateStructured({
  prompt,
  schema,
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  maxOutputTokens = 8192,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = MAX_ATTEMPTS,
  deadlineMs,
  allowTruncated = false,
}) {
  if (!isOpenAIConfigured()) {
    throw new AppError('AI generation is not configured', SERVICE_UNAVAILABLE);
  }
  const { schema: jsonSchema, strict } = toOpenAIJsonSchema(schema);
  let lastError;
  let currentMaxOutputTokens = maxOutputTokens;

  const failWith = (err, status, attempt) => {
    if (err instanceof AppError) throw err;
    if (err.isTruncated) {
      logger.error({ model, attempt, maxOutputTokens: currentMaxOutputTokens }, 'OpenAI response repeatedly truncated at max_output_tokens');
      throw Object.assign(
        new AppError('AI generation was too large to complete — try a shorter itinerary or fewer days', BAD_GATEWAY),
        { aiFailureCategory: 'schema' },
      );
    }
    logger.error({ err, model, attempt, status }, 'OpenAI request failed');
    throw Object.assign(
      new AppError('AI generation failed', status === 401 || status === 403 ? SERVICE_UNAVAILABLE : BAD_GATEWAY),
      { aiFailureCategory: err.isTimeout ? 'timeout' : 'provider' },
    );
  };

  const startedAt = Date.now();
  const remainingBudgetMs = () => (deadlineMs == null ? Infinity : deadlineMs - (Date.now() - startedAt));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await postResponses(
        {
          model,
          input: prompt,
          reasoning: { effort: reasoningEffort },
          max_output_tokens: currentMaxOutputTokens,
          // Nothing here is a conversation to resume; don't keep it server-side.
          store: false,
          text: { format: { type: 'json_schema', name: 'response', schema: jsonSchema, strict } },
        },
        Math.min(timeoutMs, remainingBudgetMs()),
      );

      // Unlike Gemini, a reply cut off here is not closed into valid JSON, so a
      // truncation nearly always fails to parse; it is still detected up front so
      // the retry can grow the budget instead of repeating the same cut-off.
      const truncated = response?.status === 'incomplete' && response?.incomplete_details?.reason === 'max_output_tokens';
      if (truncated && !allowTruncated) {
        throw Object.assign(new Error('OpenAI response truncated at max_output_tokens'), { isTruncated: true });
      }

      const { text, refusal } = extractOutput(response);
      if (!text) {
        if (refusal) logger.warn({ model, attempt }, 'OpenAI refused the structured request');
        throw Object.assign(new AppError('AI returned an empty response', BAD_GATEWAY), {
          aiFailureCategory: 'provider',
          ...(truncated ? { isTruncated: true } : {}),
        });
      }

      try {
        const parsed = JSON.parse(text);
        return strict ? stripOptionalNulls(parsed, schema) : parsed;
      } catch (parseErr) {
        logger.error({ err: parseErr, model, attempt }, 'Failed to parse OpenAI structured response as JSON');
        throw Object.assign(new AppError('AI did not return valid JSON', BAD_GATEWAY), {
          aiFailureCategory: 'schema',
          ...(truncated ? { isTruncated: true } : {}),
        });
      }
    } catch (err) {
      lastError = err;
      const status = err?.status;
      const retryable =
        err.isTimeout || err.isTruncated || (RETRYABLE_STATUS.has(status) && !NON_RETRYABLE_CODES.has(err.code));

      if (!retryable || attempt === maxAttempts) {
        failWith(err, status, attempt);
      }

      const retryDelayMs = status === 429 ? err.retryAfterMs ?? null : null;
      const backoffMs = err.isTruncated ? 0 : retryDelayMs ?? (2 ** (attempt - 1) * 500 + Math.random() * 250);
      if (remainingBudgetMs() - backoffMs < MIN_RETRY_TIMEOUT_MS) {
        failWith(err, status, attempt);
      }

      if (err.isTruncated) {
        currentMaxOutputTokens = Math.min(MAX_OUTPUT_TOKENS_CEILING, Math.ceil(currentMaxOutputTokens * 1.5));
        logger.warn({ attempt, newMaxOutputTokens: currentMaxOutputTokens }, 'Retrying OpenAI request with a larger token budget after truncation');
      } else {
        logger.warn({ status, attempt, backoffMs, usedRetryAfter: retryDelayMs != null }, 'Retrying OpenAI request after transient failure');
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
}

import logger from '../config/logger.js';
import * as gemini from './geminiClient.js';
import * as openai from './openaiClient.js';

// The seam every AI controller calls through. OpenAI answers first; Gemini is
// the backup, tried once when the OpenAI call fails for any reason (Gemini's
// own outages — repeated 503 "high demand" — are why OpenAI is now primary).
// Either key alone works: with only GEMINI_API_KEY set, this is exactly the old
// Gemini path, so an environment can move over by adding a key.
//
// `model` keeps its old meaning — a Gemini model id, only used on the Gemini
// path — so existing callers need no change; `openaiModel` and
// `reasoningEffort` pick the OpenAI side and default from OPENAI_* env.

// With a backup to fall to, OpenAI gets two attempts rather than three: a third
// transient failure in a row is better spent on the other provider.
const PRIMARY_ATTEMPTS_WITH_BACKUP = 2;
// Smallest slice of a caller's `deadlineMs` worth handing to the backup.
const MIN_FALLBACK_BUDGET_MS = 1_000;

export function isAIConfigured() {
  return openai.isOpenAIConfigured() || gemini.isAIConfigured();
}

export async function generateStructured({ model, openaiModel, reasoningEffort, maxAttempts, deadlineMs, ...options }) {
  const backupReady = gemini.isAIConfigured();
  if (!openai.isOpenAIConfigured()) {
    return gemini.generateStructured({ ...options, model, maxAttempts, deadlineMs });
  }

  const startedAt = Date.now();
  try {
    return await openai.generateStructured({
      ...options,
      model: openaiModel,
      reasoningEffort,
      deadlineMs,
      maxAttempts: backupReady ? Math.min(maxAttempts ?? PRIMARY_ATTEMPTS_WITH_BACKUP, PRIMARY_ATTEMPTS_WITH_BACKUP) : maxAttempts,
    });
  } catch (err) {
    if (!backupReady) throw err;
    const remainingMs = deadlineMs == null ? undefined : deadlineMs - (Date.now() - startedAt);
    if (remainingMs !== undefined && remainingMs < MIN_FALLBACK_BUDGET_MS) throw err;
    logger.warn({ statusCode: err?.statusCode, aiFailureCategory: err?.aiFailureCategory }, 'OpenAI failed; falling back to Gemini');
    return gemini.generateStructured({ ...options, model, maxAttempts, deadlineMs: remainingMs });
  }
}

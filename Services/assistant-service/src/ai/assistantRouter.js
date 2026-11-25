import { generateStructured } from './aiClient.js';
import {
  ASSISTANT_ROUTER_MODEL,
  ASSISTANT_ROUTER_OPENAI_MODEL,
  ASSISTANT_ROUTER_REASONING_EFFORT,
  ASSISTANT_ROUTER_VERSION,
  assistantRouterResponseJsonSchema,
  assistantRouterResponseSchema,
  buildAssistantRouterPrompt,
} from './prompts/assistantRouter.v1.js';

const ROUTER_TIMEOUT_MS = 1_500;
const DEFAULT_THRESHOLD = 0.95;

function enabled(name) {
  return process.env[name] === 'true';
}

function threshold(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_THRESHOLD;
}

export function confidenceBucket(confidence) {
  if (confidence >= 0.9) return 'high';
  if (confidence >= 0.7) return 'medium';
  return 'low';
}

export function decideRouterCommit(classification) {
  if (classification.hasActionableClause) return { committed: false, reason: 'actionable_clause' };
  if (!['social', 'off_topic'].includes(classification.intent)) return { committed: false, reason: 'resolver_required' };

  const config =
    classification.intent === 'social'
      ? { enabled: enabled('ASSISTANT_ROUTER_SOCIAL_ENABLED'), threshold: threshold('ASSISTANT_ROUTER_SOCIAL_THRESHOLD') }
      : { enabled: enabled('ASSISTANT_ROUTER_OFF_TOPIC_ENABLED'), threshold: threshold('ASSISTANT_ROUTER_OFF_TOPIC_THRESHOLD') };

  if (!config.enabled) return { committed: false, reason: 'class_disabled' };
  if (classification.confidence < config.threshold) return { committed: false, reason: 'below_threshold' };
  return { committed: true, reason: 'threshold_met' };
}

export async function classifyAssistantIntent(message, remainingBudgetMs) {
  const startedAt = Date.now();
  const raw = await generateStructured({
    prompt: buildAssistantRouterPrompt(message),
    schema: assistantRouterResponseJsonSchema,
    model: ASSISTANT_ROUTER_MODEL,
    openaiModel: ASSISTANT_ROUTER_OPENAI_MODEL,
    reasoningEffort: ASSISTANT_ROUTER_REASONING_EFFORT,
    temperature: 0,
    maxOutputTokens: 256,
    timeoutMs: Math.min(ROUTER_TIMEOUT_MS, remainingBudgetMs),
    // Bounds the OpenAI attempt and any Gemini fallback together, so a backup
    // call can never stretch classification past the router's own budget.
    deadlineMs: Math.min(ROUTER_TIMEOUT_MS, remainingBudgetMs),
    maxAttempts: 1,
  });
  const classification = assistantRouterResponseSchema.parse(raw);
  return {
    classification,
    decision: decideRouterCommit(classification),
    latencyMs: Date.now() - startedAt,
    version: ASSISTANT_ROUTER_VERSION,
    model: ASSISTANT_ROUTER_MODEL,
  };
}

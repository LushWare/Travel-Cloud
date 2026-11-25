import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { stripOptionalNulls, toOpenAIJsonSchema } from './openaiSchema.js';

// OpenAI answers first and Gemini is the backup — Gemini's repeated 503 "high
// demand" bursts were taking AI recommendations down. Either key alone works.
const modelId = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const openaiModelId = () => process.env.OPENAI_MODEL || 'gpt-6-luna';
const openaiReasoningEffort = () => process.env.OPENAI_REASONING_EFFORT || 'low';
const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
// Reasoning tokens count against OpenAI's output budget, so it gets more room
// than the 5000 Gemini's non-thinking lite tier needs for the same list.
const OPENAI_MAX_OUTPUT_TOKENS = 16_000;
const GENERATION_TIMEOUT_MS = 30_000;
// With a backup configured OpenAI gets this much of the overall window, so a
// hung primary still leaves the backup time to answer.
const PRIMARY_TIMEOUT_WITH_BACKUP_MS = 20_000;
const MIN_FALLBACK_BUDGET_MS = 5_000;
const modules = ['dashboard', 'leads', 'packages', 'flights', 'hotels', 'billing', 'analytics', 'users', 'career'];
const categories = ['sales', 'finance', 'packages', 'operations', 'performance'];
const priorities = ['high', 'medium', 'low'];
const recommendationSchema = z.object({
  recommendations: z.array(z.object({
    key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    module: z.enum(modules),
    category: z.enum(categories),
    priority: z.enum(priorities),
    title: z.string().trim().min(5).max(120),
    summary: z.string().trim().min(12).max(500),
    evidence: z.array(z.object({
      signal: z.string().max(80),
      field: z.string().max(80),
    }).strict()).min(1).max(5),
    actionLabel: z.string().trim().min(2).max(80),
    actionTab: z.enum(['quotation', 'invoice', 'receipt', 'voucher', 'bookings', 'website-users']).optional(),
  }).strict()).max(30),
}).strict();

const responseSchema = {
  type: 'OBJECT',
  properties: {
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          module: { type: 'STRING', enum: modules },
          category: { type: 'STRING', enum: categories },
          priority: { type: 'STRING', enum: priorities },
          title: { type: 'STRING' },
          summary: { type: 'STRING' },
          evidence: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                signal: { type: 'STRING' },
                field: { type: 'STRING' },
              },
              required: ['signal', 'field'],
            },
          },
          actionLabel: { type: 'STRING' },
          actionTab: { type: 'STRING', enum: ['quotation', 'invoice', 'receipt', 'voucher', 'bookings', 'website-users'] },
        },
        required: ['key', 'module', 'category', 'priority', 'title', 'summary', 'evidence', 'actionLabel'],
      },
    },
  },
  required: ['recommendations'],
};

export const SIGNAL_DEFINITIONS = Object.freeze({
  unconvertedQuotes: 'Sent or viewed quotations sent within the last 30 days: count, quoted value, oldest age.',
  coldLeads: 'Assigned, active leads worth at least 2000 with no update for at least 7 days.',
  departuresOutstanding: 'Confirmed bookings departing within 14 days with an invoice balance still due.',
  conversionTrend: 'Lead totals, confirmed wins, conversion rates, and percentage-point change for the latest 30 days and preceding 30 days.',
  lostQuotes: 'Rejected or expired quotations created this calendar month, including value and number rejected with a reason.',
  lapsedCustomers: 'Customers who travelled 11 to 13 months ago and have no confirmed or completed trip in the most recent 11 months.',
  lowMarginBookings: 'Confirmed bookings created this month whose latest recorded package margin is below 5 percent.',
  responseTimeTrend: 'Median lead-to-quotation response hours for the latest 7 days compared with the preceding 28 days.',
  destinationConcentration: 'Current-month paid revenue share from the top destination compared with its share over the previous 6 months.',
  agingOverdue: 'Invoices with a positive outstanding balance past due, excluding cancelled and refunded invoices.',
  unassignedLeads: 'New leads with no assigned owner for more than 4 hours.',
  stalledDrafting: 'Leads in drafting with no update for at least 7 days.',
  expiringQuotes: 'Sent or viewed quotations expiring within 5 days.',
  noDeposit: 'Confirmed trips within 30 days with no recorded invoice payment.',
  voucherMissing: 'Confirmed trips departing within 7 days without a recorded travel voucher.',
  cancellationSpike: 'Cancellations this month compared with the average month over the previous 3 months.',
  silentPackages: 'Active packages with no package selection during the previous 30 days.',
  quotedSilence: 'Quoted leads with no communication recorded during the previous 7 days.',
  partialAging: 'Partially paid invoices still outstanding and overdue by at least 14 days.',
  flightsNeedingReview: 'Pending or failed flight bookings with a segment departing within 7 days. Confirmed bookings have been provider-confirmed.',
  hotelsNeedingReview: 'Hotel reservations with check-in within 7 days whose status is pending or failed.',
  packagesLowBookings: 'Active packages listed for at least 14 days with recorded lifetime bookings below the package median; includes cohort average and median benchmark.',
  packagesLowViews: 'Active packages listed for at least 14 days with recorded lifetime views below the package median; includes cohort average and median benchmark.',
  packagesLowInquiries: 'Active packages listed for at least 14 days with fewer linked lead inquiries in the last 90 days than the package median; includes cohort average and median benchmark.',
  packagesLowConversions: 'Active packages listed for at least 14 days with at least 3 linked lead inquiries in the last 90 days and a confirmed-lead conversion rate below the package median; includes cohort rate, benchmark, and qualified package count.',
  packagesNoConversions: 'Active packages listed for at least 14 days with at least 3 linked lead inquiries in the last 90 days but no confirmed leads; includes average inquiry count and qualified package count.',
  packagesLowRating: 'Active packages listed for at least 14 days with at least 3 reviews and a rating below the median for packages with at least 3 reviews; includes cohort rating, benchmark, and qualified package count.',
  packagesLowReviews: 'Active packages listed for at least 14 days with fewer total reviews than the package median; includes cohort average and median benchmark.',
  leadOverview: 'Management Leads tab: counts by every lifecycle stage for leads created in the last 90 days, scoped to the assigned sales representative when applicable.',
  packageOverview: 'Packages tab: active and inactive catalog counts, accumulated catalog views/bookings, average active-package rating, active-package review count, and package inquiries/conversions over 90 days.',
  flightOverview: 'Flights tab: all-time booking counts by quoted, pending, confirmed, ticketed, failed, and cancelled status, plus departures in the next 30 days.',
  hotelOverview: 'Hotels tab: all-time booking counts and pending/failed rates by status, plus the share of check-ins in the next 30 days that are pending or failed.',
  websiteOverview: 'Website funnel: website-originated leads created in the last 30 days, confirmed conversions, and distinct destinations, scoped by sales representative when applicable.',
  userOverview: 'Users tab: company-wide account totals, active and unverified rates, verified/unverified counts, new accounts in 30 days, and customer/sales-representative/vendor role counts. Admin scope only; aggregate data with no personal details.',
  unverifiedCustomerAccounts: 'Users tab: count and rate of unverified website customer accounts. Matching record IDs remain server-side for filtering and are not sent to the model. Admin scope only; no personal details.',
  careerOverview: 'Career tab: application counts by status, oldest pending age, active vacancy count, and vacancies closing in 14 days. Admin scope only; no applicant details.',
  bookingOverview: 'Bookings: lifecycle counts and pending rate, confirmed payment-status counts and unpaid/part-paid rates, confirmed trips in the next 30 days, past travel still marked confirmed, and pending bookings older than 7 days. Scoped to the assigned sales representative where applicable.',
});

export class AIRecommendationsUnavailableError extends Error {
  constructor(diagnostic) {
    super('AI recommendations could not be generated. Retry or switch to rule-based recommendations.');
    this.name = 'AIRecommendationsUnavailableError';
    this.statusCode = 503;
    this.diagnostic = diagnostic;
  }
}

let client;
// OpenAI's strict-mode form of `responseSchema`, built once.
const openaiFormat = toOpenAIJsonSchema(responseSchema);

// Gemini answers 503 "high demand" (and sometimes 429) in short bursts; a
// retry a moment later usually succeeds. Only these transient statuses are
// retried — a bad key or malformed request fails straight away.
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
export const RETRY_DELAYS_MS = [1_000, 3_000];

function isRetryable(error) {
  const status = error?.status ?? error?.statusCode;
  // OpenAI reports an exhausted balance as a 429; waiting never fixes it.
  if (error?.code === 'insufficient_quota') return false;
  return RETRYABLE_STATUSES.has(status);
}

async function withRetries(call, deadline) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryable(error) || Date.now() + delay >= deadline) throw error;
      await new Promise((resolve) => { setTimeout(resolve, delay); });
    }
  }
}

function scalarSignals(signals = {}) {
  return Object.fromEntries(Object.entries(signals).map(([name, signal]) => [
    name,
    Object.fromEntries(Object.entries(signal || {}).filter(([field, value]) =>
      field !== 'ids' && field !== 'topReason' && (value === null || ['string', 'number', 'boolean'].includes(typeof value)),
    )),
  ]));
}

function numericTokens(value) {
  return [...String(value).matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(/,/g, ''));
}

function evidenceLabel(signal, field) {
  const humanize = (value) => value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
  return `${humanize(signal)}: ${humanize(field)}`;
}

function resolveRecommendations(parsed, source) {
  const signals = source?.signals || {};
  const seenKeys = new Set();

  return parsed.recommendations.flatMap((item) => {
    if (seenKeys.has(item.key)) return [];
    seenKeys.add(item.key);

    if (item.evidence.some(({ signal, field }) => {
      const value = signals[signal]?.[field];
      return field === 'ids' || value === undefined || value === null || !['string', 'number', 'boolean'].includes(typeof value);
    })) return [];

    const evidence = item.evidence.map(({ signal, field }) => {
      const value = signals[signal]?.[field];
      return { label: evidenceLabel(signal, field), value };
    });

    const citedSignals = item.evidence.map(({ signal }) => signal);
    const numericEvidence = new Set([
      ...citedSignals.flatMap((signal) => numericTokens(JSON.stringify(scalarSignals({ [signal]: signals[signal] })))),
      ...citedSignals.flatMap((signal) => numericTokens(SIGNAL_DEFINITIONS[signal] || '')),
    ]);
    const claims = numericTokens(`${item.title} ${item.summary}`);
    if (claims.some((token) => !numericEvidence.has(token))) {
      return [];
    }
    const allowedTabs = item.module === 'billing'
      ? ['quotation', 'invoice', 'receipt', 'voucher']
      : ['flights', 'hotels'].includes(item.module) ? ['bookings']
        : item.module === 'users' ? ['website-users'] : [];
    const actionTab = allowedTabs.includes(item.actionTab) ? item.actionTab : undefined;
    const relatedRecordIds = [...new Set(item.evidence.flatMap(({ signal }) => {
      const ids = signals[signal]?.ids;
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }))].slice(0, 100);

    return [{
      key: item.key,
      module: item.module,
      category: item.category,
      priority: item.priority,
      title: item.title,
      summary: item.summary,
      evidence,
      sourceEvidence: item.evidence.map(({ signal, field }) => ({ signal, field })),
      relatedRecordIds,
      action: { label: item.actionLabel, module: item.module, ...(actionTab ? { tab: actionTab } : {}) },
    }];
  });
}

function stableAiKey(item) {
  const evidence = [...new Set(item.sourceEvidence.map(({ signal, field }) => `${signal}.${field}`))].sort();
  const identity = JSON.stringify({ module: item.module, evidence });
  const fingerprint = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `ai.${item.module}.${fingerprint}`;
}

function buildPrompt(source) {
  return [
    'Act as the AI analyst for a travel CRM. Analyze the full supplied cross-module signal set together; independently identify the most useful evidence-backed risks, missed revenue, operational bottlenecks, growth opportunities, and trends.',
    'This is AI mode: do not copy a rules-based recommendation list; none is supplied. Generate original recommendations from the supplied analytics, including meaningful cross-tab comparisons. Cover different modules when the evidence supports it; do not force a recommendation for a module with no finding.',
    'For hotels, distinguish pending, failed, confirmed, and cancelled reservations, and use the supplied upcoming check-in share to prioritize operational risk. For users, interpret verification and active-account rates as aggregate workload signals, never as evidence of fraud. For analytics, compare supplied periods, rates, and denominators before recommending action; avoid merely restating totals.',
    'Look for relative underperformance as well as urgent exceptions. For package and other benchmark signals, compare the measured cohort with its supplied benchmark and distinguish funnel stages (views, inquiries, confirmed leads, recorded bookings, ratings, and reviews). When any package-specific signal has a nonzero count, include actionable package findings and cite those signals. Recommend a practical next investigation or improvement, but never claim a cause the measurements cannot prove.',
    'Return up to 30 concise, non-duplicate recommendations, ordered most important first. Return an empty list only when the data supports no actionable finding. Use a stable lowercase key for recurring findings.',
    'Every recommendation must cite one or more exact signal and scalar field pairs as evidence. Use only the supplied data and stated signal definitions; do not invent counts, dates, amounts, identities, causes, or outcomes. Numbers in a finding must be supported by its cited measurements or cited signal definitions. Never mention names, emails, phone numbers, internal IDs, or free-text notes.',
    'Choose module and action where staff can investigate the finding. Use only modules: dashboard, leads, packages, flights, hotels, billing, analytics, users, career. For billing actionTab may be quotation, invoice, receipt, or voucher. For flights/hotels it may be bookings. Flight statuses are pending, confirmed, failed, and cancelled; confirmed means provider-confirmed. A metric is not proof of a cause.',
    'For recommendations in the users module, only use the unverifiedCustomerAccounts signal and set actionTab to website-users so staff can review the matching customer records.',
    JSON.stringify({
      asOf: source?.asOf ?? null,
      scope: source?.scope ?? null,
      currency: source?.currency ?? null,
      signalDefinitions: SIGNAL_DEFINITIONS,
      signals: scalarSignals(source?.signals),
    }),
  ].join('\n\n');
}

function withTimeout(promise, ms, provider) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${provider} recommendation generation timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

// Each provider resolves to the parsed recommendation payload (not yet
// validated), so both go through the same Zod and evidence checks below.
async function requestGemini(prompt, timeoutMs) {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const deadline = Date.now() + timeoutMs;
  const response = await withTimeout(
    withRetries(() => client.models.generateContent({
      model: modelId(),
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema, temperature: 0.2, maxOutputTokens: 5000 },
    }), deadline),
    timeoutMs,
    'Gemini',
  );
  return JSON.parse(response.text || '{}');
}

// Plain fetch rather than the `openai` SDK: the SDK needs Node 22 and this
// image is node:20-slim. No `temperature` — the default models reason, and the
// model pages do not list it as supported.
async function requestOpenAI(prompt, timeoutMs) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const call = async () => {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: openaiModelId(),
        input: prompt,
        reasoning: { effort: openaiReasoningEffort() },
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        store: false,
        text: { format: { type: 'json_schema', name: 'recommendations', schema: openaiFormat.schema, strict: openaiFormat.strict } },
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw Object.assign(new Error(body?.error?.message || `OpenAI responded ${res.status}`), { status: res.status, code: body?.error?.code });
    }
    return body;
  };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body;
  try {
    body = await withRetries(call, deadline);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI recommendation generation timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (body?.status === 'incomplete') throw new Error(`OpenAI response incomplete: ${body?.incomplete_details?.reason ?? 'unknown'}`);
  const text = (body?.output ?? [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content ?? [])
    .map((part) => (part?.type === 'output_text' ? part.text : ''))
    .join('');
  const parsed = JSON.parse(text || '{}');
  return openaiFormat.strict ? stripOptionalNulls(parsed, responseSchema) : parsed;
}

const redact = (message) => [process.env.OPENAI_API_KEY, process.env.GEMINI_API_KEY]
  .filter(Boolean)
  .reduce((text, key) => text.replaceAll(key, '[redacted]'), message)
  .slice(0, 240);

export async function generateRecommendations(source) {
  const providers = [
    ...(process.env.OPENAI_API_KEY ? [{ name: 'openai', request: requestOpenAI }] : []),
    ...(process.env.GEMINI_API_KEY ? [{ name: 'gemini', request: requestGemini }] : []),
  ];
  if (!providers.length) throw new AIRecommendationsUnavailableError({ stage: 'configuration' });

  let stage = 'provider-request';
  let provider = providers[0].name;
  try {
    const prompt = buildPrompt(source);
    const startedAt = Date.now();
    let parsed;
    for (const [index, candidate] of providers.entries()) {
      provider = candidate.name;
      stage = 'provider-request';
      const remainingMs = GENERATION_TIMEOUT_MS - (Date.now() - startedAt);
      const hasBackup = index < providers.length - 1;
      try {
        const payload = await candidate.request(prompt, hasBackup ? Math.min(PRIMARY_TIMEOUT_WITH_BACKUP_MS, remainingMs) : remainingMs);
        stage = 'response-validation';
        parsed = recommendationSchema.safeParse(payload);
        if (!parsed.success) throw new Error(`${candidate.name} returned malformed recommendations`);
        break;
      } catch (error) {
        // A malformed or failed answer from the primary is the backup's cue; the
        // last provider's failure is the one reported.
        if (!hasBackup || GENERATION_TIMEOUT_MS - (Date.now() - startedAt) < MIN_FALLBACK_BUDGET_MS) throw error;
      }
    }
    stage = 'evidence-validation';
    const recommendations = resolveRecommendations(parsed.data, source);
    const stableRecommendations = new Map(recommendations.map((item) => {
      const { sourceEvidence, ...recommendation } = item;
      const key = stableAiKey({ module: item.module, sourceEvidence });
      return [key, { ...recommendation, key }];
    }));
    return [...stableRecommendations.values()];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI generation error';
    throw new AIRecommendationsUnavailableError({
      stage,
      provider,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      statusCode: error?.status ?? error?.statusCode ?? null,
      message: redact(message),
    });
  }
}

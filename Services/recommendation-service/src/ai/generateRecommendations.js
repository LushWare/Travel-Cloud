import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const modules = ['leads', 'packages', 'flights', 'hotels', 'billing', 'analytics'];
const categories = ['sales', 'finance', 'packages', 'operations', 'performance'];
const priorities = ['high', 'medium', 'low'];
const modelId = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
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
      label: z.string().trim().min(2).max(80),
    })).min(1).max(5),
    actionLabel: z.string().trim().min(2).max(80),
    actionTab: z.enum(['quotation', 'invoice', 'receipt', 'voucher', 'bookings']).optional(),
  })).max(20),
});

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
                label: { type: 'STRING' },
              },
              required: ['signal', 'field', 'label'],
            },
          },
          actionLabel: { type: 'STRING' },
          actionTab: { type: 'STRING', enum: ['quotation', 'invoice', 'receipt', 'voucher', 'bookings'] },
        },
        required: ['key', 'module', 'category', 'priority', 'title', 'summary', 'evidence', 'actionLabel'],
      },
    },
  },
  required: ['recommendations'],
};

export class AIRecommendationsUnavailableError extends Error {
  constructor() {
    super('AI recommendations could not be generated. Retry or switch to rule-based recommendations.');
    this.name = 'AIRecommendationsUnavailableError';
    this.statusCode = 503;
  }
}

let client;

function scalarSignals(signals) {
  return Object.fromEntries(Object.entries(signals).map(([name, signal]) => [
    name,
    Object.fromEntries(Object.entries(signal || {}).filter(([field, value]) => field !== 'ids' && (value === null || ['string', 'number', 'boolean'].includes(typeof value)))),
  ]));
}

function numericTokens(value) {
  return [...String(value).matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
}

function resolveRecommendations(parsed, source) {
  const knownNumbers = new Set(numericTokens(JSON.stringify(scalarSignals(source.signals))));
  const keys = new Set();

  return parsed.recommendations.map((item) => {
    if (keys.has(item.key)) throw new Error('Duplicate recommendation key');
    keys.add(item.key);

    if (![...numericTokens(item.title), ...numericTokens(item.summary)].every((token) => knownNumbers.has(token))) {
      throw new Error('Recommendation contains an unsupported numeric fact');
    }

    const evidence = item.evidence.map(({ signal, field, label }) => {
      const value = source.signals[signal]?.[field];
      if (field === 'ids' || value === undefined || value === null || !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new Error('Recommendation references unsupported evidence');
      }
      return { label, value };
    });
    const relatedRecordIds = [...new Set(item.evidence.flatMap(({ signal }) => {
      const ids = source.signals[signal]?.ids;
      return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }))].slice(0, 100);
    const allowedTabs = item.module === 'billing'
      ? ['quotation', 'invoice', 'receipt', 'voucher']
      : ['flights', 'hotels'].includes(item.module) ? ['bookings'] : [];
    const actionTab = allowedTabs.includes(item.actionTab) ? item.actionTab : undefined;

    return {
      key: item.key,
      module: item.module,
      category: item.category,
      priority: item.priority,
      title: item.title,
      summary: item.summary,
      evidence,
      relatedRecordIds,
      action: { label: item.actionLabel, module: item.module, ...(actionTab ? { tab: actionTab } : {}) },
    };
  });
}

export async function generateRecommendations(source) {
  if (!process.env.GEMINI_API_KEY) throw new AIRecommendationsUnavailableError();

  const signals = scalarSignals(source.signals);
  let timeoutId;
  try {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await Promise.race([
      client.models.generateContent({
        model: modelId(),
        contents: [
          'Act as a travel agency CRM analyst. Generate useful, specific recommendations by analyzing every supplied current and historical business signal together.',
          'Prioritize meaningful trends and relationships across leads, sales, billing, packages, flights, hotels, and performance. Do not merely restate a metric. Return an empty list if the data does not support an actionable finding.',
          'Use only facts supported by the supplied signals. Do not invent counts, dates, amounts, customers, causes, or outcomes. Each evidence item must cite an exact signal name and scalar field from the input. Never include personal data or identifiers.',
          'Use stable lowercase keys for recurring findings. Keep recommendations concise and actionable. The action module must be where the user can review the finding.',
          JSON.stringify({ asOf: source.asOf, scope: source.scope, currency: source.currency, signals }),
        ].join('\n\n'),
        config: { responseMimeType: 'application/json', responseSchema, temperature: 0.2, maxOutputTokens: 5000 },
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Gemini recommendation timed out')), 10_000);
      }),
    ]);
    const parsed = recommendationSchema.safeParse(JSON.parse(response.text || '{}'));
    if (!parsed.success) throw new Error('Gemini returned malformed recommendations');
    return resolveRecommendations(parsed.data, source);
  } catch {
    throw new AIRecommendationsUnavailableError();
  } finally {
    clearTimeout(timeoutId);
  }
}
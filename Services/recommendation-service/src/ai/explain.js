import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const modelId = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const explanationSchema = z.object({
  explanations: z.array(z.object({ key: z.string(), explanation: z.string().min(12).max(280) })).max(30),
});

const responseSchema = {
  type: 'OBJECT',
  properties: {
    explanations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          explanation: { type: 'STRING' },
        },
        required: ['key', 'explanation'],
      },
    },
  },
  required: ['explanations'],
};

let client;

function numericTokens(value) {
  return [...String(value).matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0]);
}

function hasOnlyEvidenceNumbers(explanation, item) {
  const available = new Set(numericTokens(JSON.stringify(item.evidence)));
  return numericTokens(explanation).every((token) => available.has(token));
}

export async function addGroundedExplanations(recommendations) {
  if (!process.env.GEMINI_API_KEY || recommendations.length === 0) return recommendations;

  try {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = [
      'Explain each supplied CRM recommendation in one short sentence for the travel agency staff.',
      'Use only the supplied title, summary, and evidence. Do not add facts, amounts, dates, counts, predictions, or actions.',
      'Return one explanation for each supplied key. Preserve each key exactly.',
      JSON.stringify(recommendations.map(({ key, title, summary, evidence }) => ({ key, title, summary, evidence }))),
    ].join('\n\n');
    const response = await Promise.race([
      client.models.generateContent({
        model: modelId(),
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1, maxOutputTokens: 1800 },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini explanation timed out')), 7_000)),
    ]);
    const parsed = explanationSchema.safeParse(JSON.parse(response.text || '{}'));
    if (!parsed.success) return recommendations;

    const known = new Map(recommendations.map((item) => [item.key, item]));
    return recommendations.map((item) => {
      const candidate = parsed.data.explanations.find((entry) => entry.key === item.key);
      if (!candidate || !known.has(candidate.key) || !hasOnlyEvidenceNumbers(candidate.explanation, item)) return item;
      return { ...item, aiExplanation: candidate.explanation };
    });
  } catch {
    return recommendations;
  }
}
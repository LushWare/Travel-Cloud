/**
 * generate-itinerary-preview — live Gemini smoke test.
 *
 * Makes one real call to the configured Gemini model and asserts the response
 * matches generateItineraryPreviewResponseSchema. Exists specifically to catch
 * model name/API drift before it reaches the public customer-facing route.
 *
 * Skipped by default — requires a real GEMINI_API_KEY, costs a real API call,
 * and is excluded from `npm run test:ci`.
 *
 * Run: GEMINI_API_KEY=... npm test -- test/integration/generateItineraryPreview.live.test.js
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const { generateStructured } = await import('../../src/ai/aiClient.js');
const { buildGenerateItineraryPreviewPrompt, generateItineraryPreviewResponseSchema } = await import(
  '../../src/ai/prompts/generateItineraryPreview.v1.js'
);

const TRANSPORT_VALUES = ['flight', 'train', 'bus', 'car', 'boat', 'walk', 'other'];

describe.skipIf(!process.env.GEMINI_API_KEY)('generate-itinerary-preview — live Gemini call', () => {
  it('returns exactly 2 days for a 2-day Kandy request', async () => {
    const prompt = buildGenerateItineraryPreviewPrompt({ destination: 'Kandy, Sri Lanka', duration: 2 });

    const data = await generateStructured({ prompt, schema: generateItineraryPreviewResponseSchema });

    expect(Array.isArray(data.days)).toBe(true);
    expect(data.days.length).toBe(2);
    for (const day of data.days) {
      expect(Array.isArray(day.locations)).toBe(true);
      expect(Array.isArray(day.activities)).toBe(true);
      if (day.transport) {
        expect(TRANSPORT_VALUES).toContain(day.transport);
      }
    }
  }, 30_000);
});

/**
 * itinerary-chat — live Gemini smoke test.
 *
 * Makes one real call to the configured Gemini model and asserts the
 * extracted slots are sane. Exists specifically to catch model name/API
 * drift before it reaches the public customer-facing route.
 *
 * Skipped by default — requires a real GEMINI_API_KEY, costs a real API call,
 * and is excluded from `npm run test:ci`.
 *
 * Run: GEMINI_API_KEY=... npm test -- test/integration/itineraryChat.live.test.js
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const { generateStructured } = await import('../../src/ai/aiClient.js');
const { buildItineraryChatPrompt, itineraryChatResponseSchema } = await import('../../src/ai/prompts/itineraryChat.v1.js');

describe.skipIf(!process.env.GEMINI_API_KEY)('itinerary-chat — live Gemini call', () => {
  it('extracts destination and a sane duration from a 3 day Kandy request', async () => {
    const prompt = buildItineraryChatPrompt({ messages: [{ role: 'user', content: 'I want a 3 day trip to Kandy, Sri Lanka' }] });

    const data = await generateStructured({ prompt, schema: itineraryChatResponseSchema, maxOutputTokens: 1024 });

    expect(data.slots.destination).toMatch(/kandy/i);
    if (data.slots.duration !== undefined) {
      expect(Number.isInteger(data.slots.duration)).toBe(true);
      expect(data.slots.duration).toBeGreaterThanOrEqual(1);
      expect(data.slots.duration).toBeLessThanOrEqual(30);
    }
  }, 30_000);
});

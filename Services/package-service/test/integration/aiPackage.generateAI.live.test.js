/**
 * generate-ai — live Gemini smoke test.
 *
 * Makes one real call to the configured Gemini model and asserts the response
 * matches generatePackageResponseSchema. Exists specifically to catch model
 * name/API drift (the previous hardcoded 'gemini-flash-latest' silently 404ing
 * would have been caught by this) before it reaches production.
 *
 * Skipped by default — requires a real GEMINI_API_KEY, costs a real API call,
 * and is excluded from `npm run test:ci`.
 *
 * Run: GEMINI_API_KEY=... npm test -- test/integration/aiPackage.generateAI.live.test.js
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const { generateStructured } = await import('../../src/ai/aiClient.js');
const { buildGeneratePackagePrompt, generatePackageResponseSchema } = await import('../../src/ai/prompts/generatePackage.v1.js');

describe.skipIf(!process.env.GEMINI_API_KEY)('generate-ai — live Gemini call', () => {
  it('returns a package with exactly the requested number of days', async () => {
    const prompt = buildGeneratePackagePrompt({
      destination: 'Kandy, Sri Lanka',
      duration: 2,
      category: 'FAMILY',
      preferences: 'general sightseeing',
    });

    const data = await generateStructured({ prompt, schema: generatePackageResponseSchema });

    expect(typeof data.title).toBe('string');
    expect(data.title.length).toBeGreaterThan(0);
    expect(Array.isArray(data.days)).toBe(true);
    expect(data.days.length).toBeGreaterThan(0);
    for (const day of data.days) {
      expect(Array.isArray(day.locations)).toBe(true);
      expect(Array.isArray(day.activities)).toBe(true);
    }
  }, 30_000);
});

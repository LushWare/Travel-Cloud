import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: mockGenerateContent };
    }
  },
}));

import { AIRecommendationsUnavailableError, generateRecommendations } from './generateRecommendations.js';

const source = {
  asOf: '2026-10-12T00:00:00.000Z',
  scope: 'org',
  currency: 'USD',
  signals: {
    coldLeads: { count: 2, oldestAgeDays: 9, ids: ['lead-1', 'lead-2'] },
    conversionTrend: { curTotal: 10, curWon: 2, prevTotal: 10, prevWon: 4 },
  },
};

const modelRecommendation = (overrides = {}) => ({
  key: 'leads.cold-follow-up',
  module: 'leads',
  category: 'sales',
  priority: 'high',
  title: 'Follow up with inactive leads',
  summary: 'Two leads have been inactive for nine days and conversion is trending lower.',
  evidence: [
    { signal: 'coldLeads', field: 'count', label: 'Inactive leads' },
    { signal: 'conversionTrend', field: 'curWon', label: 'Recent conversions' },
  ],
  actionLabel: 'Review leads',
  ...overrides,
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  mockGenerateContent.mockReset().mockResolvedValue({
    text: JSON.stringify({ recommendations: [modelRecommendation()] }),
  });
});

describe('generateRecommendations', () => {
  it('resolves AI evidence and linked records from analytics signals', async () => {
    const recommendations = await generateRecommendations(source);

    expect(recommendations).toEqual([expect.objectContaining({
      title: 'Follow up with inactive leads',
      evidence: [
        { label: 'Inactive leads', value: 2 },
        { label: 'Recent conversions', value: 2 },
      ],
      relatedRecordIds: ['lead-1', 'lead-2'],
      action: { label: 'Review leads', module: 'leads' },
    })]);
    expect(mockGenerateContent.mock.calls[0][0].contents).toContain('conversionTrend');
    expect(mockGenerateContent.mock.calls[0][0].contents).not.toContain('lead-1');
  });

  it('fails when model output references unsupported evidence', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [modelRecommendation({
        evidence: [{ signal: 'unknownSignal', field: 'count', label: 'Unsupported count' }],
      })] }),
    });

    await expect(generateRecommendations(source)).rejects.toBeInstanceOf(AIRecommendationsUnavailableError);
  });

  it('fails when Gemini is not configured', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateRecommendations(source)).rejects.toBeInstanceOf(AIRecommendationsUnavailableError);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
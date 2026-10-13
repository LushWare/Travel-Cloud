import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  mockFetchBusinessSignals,
  mockGenerateRecommendations,
  mockBuildRecommendations,
  mockRecommendationUpsert,
  mockRecommendationUpdateMany,
  mockRunUpsert,
} = vi.hoisted(() => ({
  mockPrisma: {
    recommendationRun: { findUnique: vi.fn() },
    recommendation: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  mockFetchBusinessSignals: vi.fn(),
  mockGenerateRecommendations: vi.fn(),
  mockBuildRecommendations: vi.fn(),
  mockRecommendationUpsert: vi.fn(),
  mockRecommendationUpdateMany: vi.fn(),
  mockRunUpsert: vi.fn(),
}));

vi.mock('./db/client.js', () => ({ default: mockPrisma }));
vi.mock('./analyticsClient.js', () => ({ fetchBusinessSignals: mockFetchBusinessSignals }));
vi.mock('./ai/generateRecommendations.js', () => ({ generateRecommendations: mockGenerateRecommendations }));
vi.mock('./recommendationEngine.js', () => ({
  buildRecommendations: mockBuildRecommendations,
  VERIFIED_RECOMMENDATION_KEYS: ['verified.finding', 'verified.old-finding'],
}));

import { listRecommendations } from './recommendationService.js';

const signalSource = { scope: 'org', asOf: '2026-10-12T00:00:00.000Z', signals: {} };
const aiRecommendation = {
  key: 'ai.cross-tab-finding',
  module: 'analytics',
  category: 'performance',
  priority: 'high',
  title: 'Investigate a model-generated finding',
  summary: 'The AI generated this finding from the full analytics signal set.',
  evidence: [{ label: 'Current count', value: 4 }],
  relatedRecordIds: [],
  action: { label: 'Review analytics', module: 'analytics' },
};
const ruleRecommendation = {
  key: 'verified.finding',
  module: 'analytics',
  category: 'performance',
  priority: 'medium',
  title: 'Verified finding',
  summary: 'Backend-verified finding based on current analytics.',
  evidence: [{ label: 'Current count', value: 4 }],
  relatedRecordIds: [],
  action: { label: 'Review analytics', module: 'analytics' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.recommendationRun.findUnique.mockResolvedValue(null);
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((callback) => callback({
    recommendation: { updateMany: mockRecommendationUpdateMany, upsert: mockRecommendationUpsert },
    recommendationRun: { upsert: mockRunUpsert },
  }));
  mockFetchBusinessSignals.mockResolvedValue(signalSource);
  mockGenerateRecommendations.mockResolvedValue([aiRecommendation]);
  mockBuildRecommendations.mockReturnValue([ruleRecommendation]);
});

describe('recommendation mode persistence', () => {
  it('keeps AI and rule-based snapshots in separate scopes', async () => {
    const actor = { id: 'admin-1', role: 'admin', isSuperAdmin: false };

    await listRecommendations({ actor, mode: 'ai', requestId: 'request-1' });
    await listRecommendations({ actor, mode: 'rules', requestId: 'request-2' });

    expect(mockBuildRecommendations).toHaveBeenCalledTimes(1);
    expect(mockBuildRecommendations).toHaveBeenCalledWith(signalSource.signals);
    expect(mockGenerateRecommendations).toHaveBeenCalledTimes(1);
    expect(mockGenerateRecommendations).toHaveBeenCalledWith(signalSource);
    expect(mockPrisma.recommendationRun.findUnique).toHaveBeenNthCalledWith(1, { where: { scopeKey: 'v10:agency:ai' } });
    expect(mockPrisma.recommendationRun.findUnique).toHaveBeenNthCalledWith(2, { where: { scopeKey: 'v10:agency:rules' } });
    expect(mockRecommendationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_key: { scopeKey: 'v10:agency:ai', key: 'ai.cross-tab-finding' } },
      create: expect.objectContaining({
        title: 'Investigate a model-generated finding',
        summary: 'The AI generated this finding from the full analytics signal set.',
        priority: 'high',
      }),
    }));
    expect(mockRecommendationUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        scopeKey: 'v10:agency:ai',
        active: true,
        key: { in: ['verified.finding', 'verified.old-finding'] },
      },
      data: { active: false },
    });
    expect(mockRecommendationUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { scopeKey: 'v10:agency:rules', active: true, key: { notIn: ['verified.finding'] } },
      data: { active: false },
    });
    expect(mockRecommendationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_key: { scopeKey: 'v10:agency:rules', key: 'verified.finding' } },
      create: expect.objectContaining({ priority: 'medium' }),
    }));
    expect(mockRunUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: 'v10:agency:ai' } }));
    expect(mockRunUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: 'v10:agency:rules' } }));
  });

  it('does not substitute rule-based recommendations when AI generation fails', async () => {
    mockGenerateRecommendations.mockRejectedValueOnce(new Error('AI unavailable'));

    await expect(listRecommendations({
      actor: { id: 'admin-1', role: 'admin', isSuperAdmin: false },
      mode: 'ai',
      requestId: 'request-1',
    })).rejects.toThrow('AI unavailable');

    expect(mockBuildRecommendations).not.toHaveBeenCalled();
    expect(mockRecommendationUpsert).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  mockFetchBusinessSignals,
  mockGenerateRecommendations,
  mockBuildRecommendations,
  mockRecommendationUpsert,
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
  mockRunUpsert: vi.fn(),
}));

vi.mock('./db/client.js', () => ({ default: mockPrisma }));
vi.mock('./analyticsClient.js', () => ({ fetchBusinessSignals: mockFetchBusinessSignals }));
vi.mock('./ai/generateRecommendations.js', () => ({ generateRecommendations: mockGenerateRecommendations }));
vi.mock('./recommendationEngine.js', () => ({ buildRecommendations: mockBuildRecommendations }));

import { listRecommendations } from './recommendationService.js';

const signalSource = { scope: 'org', asOf: '2026-10-12T00:00:00.000Z', signals: {} };
const aiRecommendation = {
  key: 'ai.finding',
  module: 'analytics',
  category: 'performance',
  priority: 'high',
  title: 'AI finding',
  summary: 'AI generated finding based on current analytics.',
  evidence: [{ label: 'Current count', value: 4 }],
  relatedRecordIds: [],
  action: { label: 'Review analytics', module: 'analytics' },
};
const ruleRecommendation = {
  ...aiRecommendation,
  key: 'rules.finding',
  title: 'Rule finding',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.recommendationRun.findUnique.mockResolvedValue(null);
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((callback) => callback({
    recommendation: { updateMany: vi.fn(), upsert: mockRecommendationUpsert },
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

    expect(mockPrisma.recommendationRun.findUnique).toHaveBeenNthCalledWith(1, { where: { scopeKey: 'v2:agency:ai' } });
    expect(mockPrisma.recommendationRun.findUnique).toHaveBeenNthCalledWith(2, { where: { scopeKey: 'v2:agency:rules' } });
    expect(mockRecommendationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_key: { scopeKey: 'v2:agency:ai', key: 'ai.finding' } },
    }));
    expect(mockRecommendationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey_key: { scopeKey: 'v2:agency:rules', key: 'rules.finding' } },
    }));
    expect(mockRunUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: 'v2:agency:ai' } }));
    expect(mockRunUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: 'v2:agency:rules' } }));
  });
});
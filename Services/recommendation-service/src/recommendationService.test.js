import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPrisma,
  mockFetchBusinessSignals,
  mockGenerateRecommendations,
  mockBuildRecommendations,
  mockRecommendationUpsert,
  mockRecommendationUpdateMany,
  mockRunUpsert,
  mockTxRecommendationFindMany,
  mockFeedbackDeleteMany,
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
  mockTxRecommendationFindMany: vi.fn(),
  mockFeedbackDeleteMany: vi.fn(),
}));

vi.mock('./db/client.js', () => ({ default: mockPrisma }));
vi.mock('./analyticsClient.js', () => ({ fetchBusinessSignals: mockFetchBusinessSignals }));
vi.mock('./ai/generateRecommendations.js', () => ({ generateRecommendations: mockGenerateRecommendations }));
vi.mock('./recommendationEngine.js', () => ({
  buildRecommendations: mockBuildRecommendations,
}));

import {
  FAILURE_COOLDOWN_MS,
  RECURRENCE_GAP_MS,
  listRecommendations,
  resetRefreshStateForTests,
} from './recommendationService.js';

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
  vi.useRealTimers();
  resetRefreshStateForTests();
  mockTxRecommendationFindMany.mockResolvedValue([]);
  mockPrisma.recommendationRun.findUnique.mockResolvedValue(null);
  mockPrisma.recommendation.findMany.mockResolvedValue([]);
  mockPrisma.$transaction.mockImplementation((callback) => callback({
    recommendation: {
      updateMany: mockRecommendationUpdateMany,
      upsert: mockRecommendationUpsert,
      findMany: mockTxRecommendationFindMany,
    },
    recommendationFeedback: { deleteMany: mockFeedbackDeleteMany },
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
    expect(mockRecommendationUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockRecommendationUpdateMany).toHaveBeenCalledWith({
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

  it('excludes reviewed recommendations from Active and returns them in Reviewed', async () => {
    const actor = { id: 'admin-1', role: 'admin', isSuperAdmin: false };
    const recommendationRow = (id, status) => ({
      ...aiRecommendation,
      id,
      scopeKey: 'v10:agency:ai',
      sourceAsOf: new Date('2026-10-12T00:00:00.000Z'),
      active: true,
      createdAt: new Date('2026-10-12T00:00:00.000Z'),
      updatedAt: new Date('2026-10-12T00:00:00.000Z'),
      feedback: status ? [{ status }] : [],
    });
    mockPrisma.recommendation.findMany.mockResolvedValue([
      recommendationRow('unreviewed-id', null),
      recommendationRow('reviewed-id', 'reviewed'),
    ]);

    const active = await listRecommendations({ actor, status: 'active', mode: 'ai', requestId: 'request-active' });
    const reviewed = await listRecommendations({ actor, status: 'reviewed', mode: 'ai', requestId: 'request-reviewed' });

    expect(active.counts).toEqual({ active: 1, reviewed: 1 });
    expect(active.recommendations.map(({ id }) => id)).toEqual(['unreviewed-id']);
    expect(reviewed.counts).toEqual({ active: 1, reviewed: 1 });
    expect(reviewed.recommendations.map(({ id }) => id)).toEqual(['reviewed-id']);
    expect(mockPrisma.recommendation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey: 'v10:agency:ai', active: true },
      include: { feedback: { where: { actorId: actor.id }, take: 1 } },
    }));
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

const admin = { id: 'admin-1', role: 'admin', isSuperAdmin: false };

describe('AI snapshot replacement', () => {
  it('deactivates AI recommendations missing from the latest run', async () => {
    await listRecommendations({ actor: admin, mode: 'ai', requestId: 'request-1' });

    expect(mockRecommendationUpdateMany).toHaveBeenCalledWith({
      where: { scopeKey: 'v10:agency:ai', active: true, key: { notIn: ['ai.cross-tab-finding'] } },
      data: { active: false },
    });
  });

  it('deactivates every AI recommendation when the latest run returns none', async () => {
    mockGenerateRecommendations.mockResolvedValueOnce([]);

    await listRecommendations({ actor: admin, mode: 'ai', requestId: 'request-1' });

    expect(mockRecommendationUpdateMany).toHaveBeenCalledWith({
      where: { scopeKey: 'v10:agency:ai', active: true },
      data: { active: false },
    });
  });
});

describe('failed refresh cooldown', () => {
  it('rethrows the last failure without calling Gemini again inside the cooldown', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00.000Z') });
    mockGenerateRecommendations.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(listRecommendations({ actor: admin, mode: 'ai' })).rejects.toThrow('AI unavailable');

    vi.setSystemTime(new Date(Date.now() + FAILURE_COOLDOWN_MS - 1000));
    await expect(listRecommendations({ actor: admin, mode: 'ai' })).rejects.toThrow('AI unavailable');

    expect(mockGenerateRecommendations).toHaveBeenCalledTimes(1);
  });

  it('calls Gemini again once the cooldown has passed', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00.000Z') });
    mockGenerateRecommendations.mockRejectedValueOnce(new Error('AI unavailable'));
    await expect(listRecommendations({ actor: admin, mode: 'ai' })).rejects.toThrow('AI unavailable');

    vi.setSystemTime(new Date(Date.now() + FAILURE_COOLDOWN_MS + 1000));
    const result = await listRecommendations({ actor: admin, mode: 'ai' });

    expect(mockGenerateRecommendations).toHaveBeenCalledTimes(2);
    expect(result.mode).toBe('ai');
  });

  it('shares one Gemini call between simultaneous page loads', async () => {
    await Promise.all([
      listRecommendations({ actor: admin, mode: 'ai' }),
      listRecommendations({ actor: admin, mode: 'ai' }),
    ]);

    expect(mockGenerateRecommendations).toHaveBeenCalledTimes(1);
  });
});

describe('feedback on recurring findings', () => {
  it('clears feedback for a finding that was gone for at least the recurrence gap', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00.000Z') });
    mockTxRecommendationFindMany.mockResolvedValueOnce([{ id: 'returning-id' }]);

    await listRecommendations({ actor: admin, mode: 'rules' });

    expect(mockTxRecommendationFindMany).toHaveBeenCalledWith({
      where: {
        scopeKey: 'v10:agency:rules',
        key: { in: ['verified.finding'] },
        active: false,
        updatedAt: { lt: new Date(Date.parse('2026-11-25T10:00:00.000Z') - RECURRENCE_GAP_MS) },
      },
      select: { id: true },
    });
    expect(mockFeedbackDeleteMany).toHaveBeenCalledWith({ where: { recommendationId: { in: ['returning-id'] } } });
  });

  it('keeps feedback when no returning finding was gone long enough', async () => {
    mockTxRecommendationFindMany.mockResolvedValueOnce([]);

    await listRecommendations({ actor: admin, mode: 'rules' });

    expect(mockFeedbackDeleteMany).not.toHaveBeenCalled();
  });
});

describe('viewer scope', () => {
  it('scopes a sales rep flagged as super admin to their own recommendations', async () => {
    mockFetchBusinessSignals.mockResolvedValueOnce({ ...signalSource, scope: 'own' });

    const result = await listRecommendations({
      actor: { id: 'rep-1', role: 'salesRep', isSuperAdmin: true },
      mode: 'rules',
    });

    expect(result.scope).toBe('own');
    expect(mockPrisma.recommendationRun.findUnique).toHaveBeenCalledWith({ where: { scopeKey: 'v10:rep:rep-1:rules' } });
  });
});
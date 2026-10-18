import { describe, expect, it, vi } from 'vitest';

const { mockListRecommendations, mockSaveRecommendationFeedback } = vi.hoisted(() => ({
  mockListRecommendations: vi.fn(),
  mockSaveRecommendationFeedback: vi.fn(),
}));

vi.mock('../recommendationService.js', () => ({
  listRecommendations: mockListRecommendations,
  saveRecommendationFeedback: mockSaveRecommendationFeedback,
}));

import { getRecommendations } from './recommendations.controller.js';

describe('getRecommendations', () => {
  it('accepts AI recommendations routed to the Career module', async () => {
    const result = { recommendations: [] };
    mockListRecommendations.mockResolvedValue(result);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await getRecommendations({
      query: { module: 'career', mode: 'ai' },
      actor: { id: 'admin-1', role: 'admin' },
      headers: { 'x-request-id': 'request-1' },
    }, res, next);

    expect(mockListRecommendations).toHaveBeenCalledWith({
      actor: { id: 'admin-1', role: 'admin' },
      module: 'career',
      status: 'active',
      mode: 'ai',
      requestId: 'request-1',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: result });
    expect(next).not.toHaveBeenCalled();
  });
});
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockAuth, mockFetch } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockFetch: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: mockAuth, useAuth: mockAuth }));
vi.mock('@/services/recommendationsAPI', () => ({
  fetchRecommendations: mockFetch,
  updateRecommendation: vi.fn(),
}));

import AIInsights from '../AIInsights';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';

afterEach(() => localStorage.clear());

describe('AI features for an agency without the AI module', () => {
  it('explains AI Insights is not in the plan', () => {
    mockAuth.mockReturnValue({ user: { role: 'admin', planModulesOff: ['ai_copilot'] } });

    render(<AIInsights />);

    expect(screen.getByText("AI Insights isn't in your plan")).toBeInTheDocument();
  });

  it('never asks for AI recommendations', () => {
    mockAuth.mockReturnValue({ user: { role: 'admin', planModulesOff: ['ai_copilot'] } });
    localStorage.setItem('user', JSON.stringify({ planModulesOff: ['ai_copilot'] }));

    render(<AIInsights />);
    render(<RecommendationStrip module="leads" />);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows no recommendation strip', () => {
    localStorage.setItem('user', JSON.stringify({ planModulesOff: ['ai_copilot'] }));

    const { container } = render(<RecommendationStrip module="leads" />);

    expect(container).toBeEmptyDOMElement();
  });
});

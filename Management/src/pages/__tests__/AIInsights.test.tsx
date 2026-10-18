import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockFetchRecommendations, mockUpdateRecommendation } = vi.hoisted(() => ({
  mockFetchRecommendations: vi.fn(),
  mockUpdateRecommendation: vi.fn(),
}));

vi.mock('@/services/recommendationsAPI', () => ({
  fetchRecommendations: mockFetchRecommendations,
  updateRecommendation: mockUpdateRecommendation,
}));

import AIInsights from '../AIInsights';
import type { BusinessRecommendation } from '@/services/recommendationsAPI';

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

const recommendation = (index: number, overrides: Partial<BusinessRecommendation> = {}): BusinessRecommendation => ({
  id: `record-${index}`,
  key: `recommendation-${index}`,
  module: 'flights',
  category: 'operations',
  priority: 'high',
  title: `Review flight recommendation ${index}`,
  summary: 'An upcoming flight needs confirmation.',
  evidence: [{ label: 'Flight bookings', value: 2 }],
  relatedRecordIds: ['flight-booking-42'],
  action: { label: 'Review flight bookings', module: 'flights', tab: 'bookings' },
  viewerStatus: 'new',
  sourceAsOf: '2026-10-12T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchRecommendations.mockResolvedValue({
    scope: 'agency',
    sourceAsOf: '2026-10-12T00:00:00.000Z',
    recommendations: Array.from({ length: 6 }, (_, index) => recommendation(index + 1)),
  });
  mockUpdateRecommendation.mockResolvedValue(undefined);
});

describe('AIInsights', () => {
  it('shows four-column recommendation cards that open a filtered module destination', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/ai-insights']}>
        <AIInsights />
        <CurrentLocation />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'View Review flight recommendation 1 details' });
    expect(screen.getByRole('button', { name: 'View Review flight recommendation 4 details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Review flight recommendation 5 details' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View Review flight recommendation 1 details' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review flight bookings' }));

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/flights?tab=bookings&ids=flight-booking-42&focus=recommendation',
    );
  });

  it('switches between AI and rule-based recommendations', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/ai-insights']}>
        <AIInsights />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'View Review flight recommendation 1 details' });
    await user.click(screen.getByRole('button', { name: 'Switch to rule-based' }));
    await screen.findByText('Rule-based recommendations from current business signals');
    expect(mockFetchRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'rules' }));

    await user.click(screen.getByRole('button', { name: 'Refresh insights' }));
    await screen.findByText('AI recommendations based on current and historical business analytics');
    expect(mockFetchRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'ai' }));
  });
});

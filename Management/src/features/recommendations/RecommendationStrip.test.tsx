import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

import RecommendationStrip from './RecommendationStrip';
import type { BusinessRecommendation } from '@/services/recommendationsAPI';

const recommendation = (overrides: Partial<BusinessRecommendation> = {}): BusinessRecommendation => ({
  id: '2bc21408-e8bd-47db-9d89-c19147c327fd',
  key: 'unconverted-quotes',
  module: 'leads',
  category: 'pipeline',
  priority: 'high',
  title: 'Follow up on pending quotes',
  summary: 'Several quotes have not converted.',
  aiExplanation: 'These quotes remain open and need staff review.',
  evidence: [{ label: 'Open quotes', value: 4 }],
  relatedRecordIds: ['lead-42'],
  action: { label: 'Open leads', module: 'leads' },
  viewerStatus: 'new',
  sourceAsOf: '2026-10-12T00:00:00.000Z',
  ...overrides,
});

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

function renderStrip(items: BusinessRecommendation[], initialEntry = '/leads') {
  mockFetchRecommendations.mockResolvedValue({
    scope: 'agency',
    sourceAsOf: '2026-10-12T00:00:00.000Z',
    recommendations: items,
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RecommendationStrip module="leads" />
      <CurrentLocation />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateRecommendation.mockResolvedValue(undefined);
});

describe('RecommendationStrip', () => {
  it('expands recommendations, shows evidence, and records a review', async () => {
    const user = userEvent.setup();
    const first = recommendation();
    const items = [
      first,
      ...Array.from({ length: 5 }, (_, index) => recommendation({
        id: `dbd211de-2de1-46cd-b687-41836c896b3${index}`,
        key: `recommendation-${index}`,
        title: `Recommendation ${index + 2}`,
        priority: 'medium',
      })),
    ];
    renderStrip(items);

    await screen.findByText(first.title);
    expect(screen.getByText('Recommendation 4')).toBeInTheDocument();
    expect(screen.queryByText('Recommendation 5')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByText('Recommendation 5')).toBeInTheDocument();
    expect(screen.getByText('Recommendation 6')).toBeInTheDocument();

    await user.click(screen.getByText(first.title));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('These quotes remain open and need staff review.')).toBeInTheDocument();
    expect(within(dialog).getByText('Open quotes')).toBeInTheDocument();
    expect(within(dialog).getByText('4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(mockUpdateRecommendation).toHaveBeenCalledWith(first.id, 'reviewed'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('switches to rule-based recommendations and requests the selected mode', async () => {
    const user = userEvent.setup();
    const item = recommendation();
    renderStrip([item]);

    await screen.findByText(item.title);
    await user.click(screen.getByRole('button', { name: 'Switch to rule-based' }));

    await waitFor(() => expect(mockFetchRecommendations).toHaveBeenLastCalledWith(
      expect.objectContaining({ module: 'leads', mode: 'rules' }),
    ));
    expect(screen.getByRole('heading', { name: 'Rule-based recommendations' })).toBeInTheDocument();
  });

  it('defaults back to AI when the recommendation section is remounted', async () => {
    const user = userEvent.setup();
    const item = recommendation();
    const firstRender = renderStrip([item]);

    await screen.findByText(item.title);
    await user.click(screen.getByRole('button', { name: 'Switch to rule-based' }));
    await waitFor(() => expect(mockFetchRecommendations).toHaveBeenLastCalledWith(
      expect.objectContaining({ module: 'leads', mode: 'rules' }),
    ));

    firstRender.unmount();
    renderStrip([item]);

    await waitFor(() => expect(mockFetchRecommendations).toHaveBeenLastCalledWith(
      expect.objectContaining({ module: 'leads', mode: 'ai' }),
    ));
    expect(screen.getByRole('heading', { name: 'AI Recommendations' })).toBeInTheDocument();
  });

  it('shows AI failure and keeps the rule-based switch available', async () => {
    const user = userEvent.setup();
    const item = recommendation();
    mockFetchRecommendations
      .mockRejectedValueOnce(new Error('AI recommendations could not be generated. Retry or switch to rule-based recommendations.'))
      .mockResolvedValueOnce({ scope: 'agency', sourceAsOf: item.sourceAsOf, recommendations: [item] });

    render(
      <MemoryRouter initialEntries={['/leads']}>
        <RecommendationStrip module="leads" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/AI recommendations could not be generated/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to rule-based' }));
    expect(await screen.findByText(item.title)).toBeInTheDocument();
    expect(mockFetchRecommendations).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'rules' }));
  });

  it('opens the related lead workflow from the recommendation action', async () => {
    const user = userEvent.setup();
    const item = recommendation({ action: { label: 'Review lead', module: 'leads' } });
    renderStrip([item]);

    await user.click(await screen.findByText(item.title));
    await user.click(screen.getByRole('button', { name: 'Review lead' }));

    expect(screen.getByTestId('current-location')).toHaveTextContent('/leads?ids=lead-42&focus=recommendation');
  });

  it('opens billing on the requested document tab filtered to linked records', async () => {
    const user = userEvent.setup();
    const item = recommendation({
      module: 'billing',
      relatedRecordIds: ['invoice-7'],
      action: { label: 'Review invoices', module: 'billing', tab: 'invoice' },
    });
    renderStrip([item], '/billing');

    await user.click(await screen.findByText(item.title));
    await user.click(screen.getByRole('button', { name: 'Review invoices' }));

    expect(screen.getByTestId('current-location')).toHaveTextContent('/billing?tab=invoice&ids=invoice-7&focus=recommendation');
  });

  it('opens Packages filtered to linked package IDs', async () => {
    const user = userEvent.setup();
    const item = recommendation({
      module: 'packages',
      relatedRecordIds: ['4a958671-d29b-465c-b68c-e855472133f9'],
      action: { label: 'Review packages', module: 'packages' },
    });
    renderStrip([item], '/ai-insights');

    await user.click(await screen.findByText(item.title));
    await user.click(screen.getByRole('button', { name: 'Review packages' }));

    expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/packages?ids=4a958671-d29b-465c-b68c-e855472133f9&focus=recommendation',
    );
  });
});
import { describe, expect, it } from 'vitest';
import { buildRecommendations } from './recommendationEngine.js';

describe('buildRecommendations', () => {
  it('does not invent recommendations when source signals are empty', () => {
    expect(buildRecommendations()).toEqual([]);
  });

  it('creates a lead recommendation from measured records and evidence', () => {
    const recommendations = buildRecommendations({
      unassignedLeads: {
        count: 2,
        oldestCreatedAt: '2026-10-10T10:00:00.000Z',
        ids: ['lead-1', 'lead-2'],
      },
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      key: 'leads.unassigned',
      module: 'leads',
      priority: 'high',
      relatedRecordIds: ['lead-1', 'lead-2'],
      evidence: [
        { label: 'Affected records', value: 2 },
        { label: 'Oldest unassigned lead', value: '2026-10-10T10:00:00.000Z' },
      ],
    });
  });

  it('requires sufficient history before surfacing conversion comparisons', () => {
    expect(buildRecommendations({
      conversionTrend: { curTotal: 4, curWon: 0, prevTotal: 20, prevWon: 5 },
    })).toEqual([]);
  });

  it('compares conversion periods only when both samples are large enough', () => {
    const [recommendation] = buildRecommendations({
      conversionTrend: { curTotal: 10, curWon: 1, prevTotal: 10, prevWon: 4 },
    });

    expect(recommendation).toMatchObject({
      key: 'analytics.conversion-decline',
      module: 'analytics',
      evidence: [
        { label: 'Latest 30 days', value: '10% (1/10)' },
        { label: 'Previous 30 days', value: '40% (4/10)' },
      ],
    });
  });

  it('surfaces upcoming flight and hotel booking issues from their actual records', () => {
    const recommendations = buildRecommendations({
      flightsNeedingReview: { count: 1, nearestDeparture: '2026-10-15T08:00:00.000Z', ids: ['flight-1'] },
      hotelsNeedingReview: { count: 2, nearestCheckin: '2026-10-14T15:00:00.000Z', ids: ['hotel-1', 'hotel-2'] },
    });

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0]).toMatchObject({
      module: 'flights',
      relatedRecordIds: ['flight-1'],
      evidence: expect.arrayContaining([{ label: 'Flight bookings', value: 1 }]),
    });
    expect(recommendations[1]).toMatchObject({
      module: 'hotels',
      relatedRecordIds: ['hotel-1', 'hotel-2'],
      evidence: expect.arrayContaining([{ label: 'Hotel reservations', value: 2 }]),
    });
  });

  it('links quiet-package recommendations to the measured package IDs', () => {
    const [recommendation] = buildRecommendations({
      silentPackages: { count: 2, ids: ['4a958671-d29b-465c-b68c-e855472133f9', 'ed7c45b7-2eed-4690-87d8-c53bdf4408e6'] },
    });

    expect(recommendation).toMatchObject({
      key: 'packages.no-recent-inquiries',
      module: 'packages',
      relatedRecordIds: ['4a958671-d29b-465c-b68c-e855472133f9', 'ed7c45b7-2eed-4690-87d8-c53bdf4408e6'],
    });
  });
});
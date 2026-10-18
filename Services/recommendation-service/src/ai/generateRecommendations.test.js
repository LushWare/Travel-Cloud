import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({ mockGenerateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: mockGenerateContent };
    }
  },
}));

import { AIRecommendationsUnavailableError, generateRecommendations, SIGNAL_DEFINITIONS } from './generateRecommendations.js';

const signalNames = Object.keys(SIGNAL_DEFINITIONS);
const source = {
  asOf: '2026-10-12T00:00:00.000Z',
  scope: 'org',
  currency: 'USD',
  signals: {
    ...Object.fromEntries(signalNames.map((name) => [name, { count: 0, ids: [] }])),
    coldLeads: { count: 2, oldestAgeDays: 9, ids: ['private-lead-1', 'private-lead-2'] },
    careerOverview: { pendingApplications: 3, oldestPendingApplicationDays: 12, activeVacancies: 2, vacanciesClosing14Days: 1 },
    lostQuotes: { count: 1, topReason: 'private note', ids: ['private-quote-id'] },
    flightsNeedingReview: { count: 0, nearestDeparture: '2026-10-14T06:30:00.000Z', ids: [] },
  },
};

const aiRecommendation = (overrides = {}) => ({
  key: 'leads.cold-follow-up',
  module: 'leads',
  category: 'sales',
  priority: 'high',
  title: 'Follow up on cold leads',
  summary: 'High-value leads have had no recent update.',
  evidence: [
    { signal: 'coldLeads', field: 'count' },
    { signal: 'coldLeads', field: 'oldestAgeDays' },
  ],
  actionLabel: 'Review leads',
  ...overrides,
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  mockGenerateContent.mockReset().mockResolvedValue({
    text: JSON.stringify({ recommendations: [aiRecommendation()] }),
  });
});

describe('generateRecommendations', () => {
  it('returns Gemini recommendations after validating evidence from the complete sanitized signal set', async () => {
    const [result] = await generateRecommendations(source);

    expect(result).toMatchObject({
      module: 'leads',
      category: 'sales',
      priority: 'high',
      title: 'Follow up on cold leads',
      summary: 'High-value leads have had no recent update.',
      evidence: [
        { label: 'Cold Leads: Count', value: 2 },
        { label: 'Cold Leads: Oldest Age Days', value: 9 },
      ],
      relatedRecordIds: ['private-lead-1', 'private-lead-2'],
      action: { label: 'Review leads', module: 'leads' },
    });
    expect(result.key).toMatch(/^ai\.leads\./);

    const prompt = mockGenerateContent.mock.calls[0][0].contents;
    expect(signalNames).toHaveLength(37);
    signalNames.forEach((name) => expect(prompt).toContain(name));
    expect(prompt).toContain('2026-10-14T06:30:00.000Z');
    expect(prompt).not.toContain('private-lead-1');
    expect(prompt).not.toContain('private-flight-id');
    expect(prompt).not.toContain('private note');
  });

  it('does not add rule-based findings when Gemini returns no recommendations', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ recommendations: [] }) });

    await expect(generateRecommendations(source)).resolves.toEqual([]);
  });

  it('keeps the same actionable flight recommendation as its measured count changes', async () => {
    const flightFinding = aiRecommendation({
      key: 'flights.upcoming-review',
      module: 'flights',
      title: 'Review upcoming flight bookings',
      summary: 'Upcoming flights need a ticketing review.',
      evidence: [{ signal: 'flightsNeedingReview', field: 'count' }],
      actionTab: 'bookings',
    });
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({ recommendations: [flightFinding] }) });
    const signals = {
      ...source,
      signals: {
        ...source.signals,
        flightsNeedingReview: { count: 16, nearestDeparture: '2026-10-14T06:30:00.000Z', ids: ['flight-1'] },
      },
    };

    const first = (await generateRecommendations(signals)).find(({ module }) => module === 'flights');
    const updated = (await generateRecommendations({
      ...signals,
      signals: { ...signals.signals, flightsNeedingReview: { ...signals.signals.flightsNeedingReview, count: 15 } },
    })).find(({ module }) => module === 'flights');

    expect(first.key).toMatch(/^ai\.flights\./);
    expect(first.evidence).toContainEqual({ label: 'Flights Needing Review: Count', value: 16 });
    expect(updated.key).toBe(first.key);
    expect(updated.evidence).toContainEqual({ label: 'Flights Needing Review: Count', value: 15 });
  });

  it('does not inject hotel recommendations when Gemini returns no findings', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ recommendations: [] }) });
    const hotelSignals = {
      ...source,
      signals: {
        ...source.signals,
        hotelOverview: { pendingHotels: 2, failedHotels: 0, totalHotelBookings: 8, ids: ['hotel-1', 'hotel-2'] },
        hotelsNeedingReview: { count: 1, nearestCheckin: '2026-10-14T15:00:00.000Z', ids: ['hotel-1'] },
      },
    };

    const recommendations = await generateRecommendations(hotelSignals);

    expect(recommendations).toEqual([]);
  });

  it('does not inject rule findings from any module into AI mode', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ recommendations: [] }) });
    const multiModuleSignals = {
      ...source,
      signals: {
        ...source.signals,
        coldLeads: { count: 0, oldestAgeDays: 0, ids: [] },
        unassignedLeads: { count: 2, ids: ['lead-1', 'lead-2'] },
        agingOverdue: { count: 1, value: 500, oldestDays: 8, ids: ['invoice-1'] },
        packagesLowViews: { count: 1, averageRecordedViews: 10, benchmarkRecordedViews: 20, ids: ['package-1'] },
        flightsNeedingReview: { count: 1, nearestDeparture: '2026-10-14T06:30:00.000Z', ids: ['flight-1'] },
        hotelsNeedingReview: { count: 1, nearestCheckin: '2026-10-14T15:00:00.000Z', ids: ['hotel-1'] },
        unverifiedCustomerAccounts: { count: 2, ratePct: 20, ids: ['customer-1', 'customer-2'] },
        bookingOverview: { pastTravelStillConfirmed: 1 },
      },
    };

    await expect(generateRecommendations(multiModuleSignals)).resolves.toEqual([]);
  });

  it('keeps an AI-only recommendation key stable when Gemini changes its proposed key', async () => {
    const careerFinding = (key) => aiRecommendation({
      key,
      module: 'career',
      category: 'operations',
      title: 'Review the pending applicant queue',
      summary: 'Applications are waiting for staff review.',
      evidence: [
        { signal: 'careerOverview', field: 'pendingApplications' },
        { signal: 'careerOverview', field: 'oldestPendingApplicationDays' },
      ],
    });
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ recommendations: [careerFinding('career.backlog-a')] }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ recommendations: [careerFinding('career.backlog-b')] }) });

    const first = (await generateRecommendations(source)).find(({ module }) => module === 'career');
    const second = (await generateRecommendations(source)).find(({ module }) => module === 'career');

    expect(first.key).toMatch(/^ai\.career\./);
    expect(second.key).toBe(first.key);
  });

  it('generates a Career-tab recommendation from aggregate application data', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'career.application-backlog',
        module: 'career',
        category: 'operations',
        title: 'Review the pending applicant queue',
        summary: 'Several applications have been waiting for review.',
        evidence: [
          { signal: 'careerOverview', field: 'pendingApplications' },
          { signal: 'careerOverview', field: 'oldestPendingApplicationDays' },
        ],
        actionLabel: 'Review Career applications',
      })] }),
    });

    const [result] = await generateRecommendations(source);

    expect(result).toMatchObject({
      module: 'career',
      relatedRecordIds: [],
      evidence: [
        { label: 'Career Overview: Pending Applications', value: 3 },
        { label: 'Career Overview: Oldest Pending Application Days', value: 12 },
      ],
      action: { label: 'Review Career applications', module: 'career' },
    });
  });

  it('generates a Packages-tab insight from inquiry and conversion performance', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'packages.conversion-opportunity',
        module: 'packages',
        category: 'packages',
        title: 'Review package conversion performance',
        summary: 'Package inquiries are not consistently converting to confirmed leads.',
        evidence: [
          { signal: 'packageOverview', field: 'packageInquiries90Days' },
          { signal: 'packageOverview', field: 'packageConversions90Days' },
        ],
        actionLabel: 'Review packages',
      })] }),
    });
    const packageSignals = {
      ...source,
      signals: {
        ...source.signals,
        packageOverview: { packageInquiries90Days: 12, packageConversions90Days: 3, ids: [] },
      },
    };

    const [result] = await generateRecommendations(packageSignals);

    expect(result).toMatchObject({
      module: 'packages',
      relatedRecordIds: [],
      evidence: [
        { label: 'Package Overview: Package Inquiries 90 Days', value: 12 },
        { label: 'Package Overview: Package Conversions 90 Days', value: 3 },
      ],
    });
  });

  it('generates benchmarked package recommendations and links affected packages', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'packages.low-conversion',
        module: 'packages',
        category: 'packages',
        title: 'Investigate below-median package conversions',
        summary: '2 packages converted at 10% versus the 40% median across 8 qualified packages.',
        evidence: [
          { signal: 'packagesLowConversions', field: 'count' },
          { signal: 'packagesLowConversions', field: 'averageConversionRate90Days' },
          { signal: 'packagesLowConversions', field: 'benchmarkConversionRate90Days' },
          { signal: 'packagesLowConversions', field: 'qualifiedPackages' },
        ],
        actionLabel: 'Review packages',
      })] }),
    });
    const packageSignals = {
      ...source,
      signals: {
        ...source.signals,
        packagesLowConversions: {
          count: 2,
          averageConversionRate90Days: 10,
          benchmarkConversionRate90Days: 40,
          qualifiedPackages: 8,
          ids: ['private-package-1', 'private-package-2'],
        },
      },
    };

    const result = (await generateRecommendations(packageSignals)).find(({ module }) => module === 'packages');

    expect(result).toMatchObject({
      module: 'packages',
      relatedRecordIds: ['private-package-1', 'private-package-2'],
      evidence: [
        { label: 'Packages Low Conversions: Count', value: 2 },
        { label: 'Packages Low Conversions: Average Conversion Rate 90 Days', value: 10 },
        { label: 'Packages Low Conversions: Benchmark Conversion Rate 90 Days', value: 40 },
        { label: 'Packages Low Conversions: Qualified Packages', value: 8 },
      ],
    });
    expect(result.key).toMatch(/^ai\.packages\./);
    const prompt = mockGenerateContent.mock.calls[0][0].contents;
    expect(prompt).toContain('packagesLowConversions');
    expect(prompt).not.toContain('private-package-1');
  });

  it('does not append hardcoded package findings to Gemini output', async () => {
    const packageSignals = {
      ...source,
      signals: {
        ...source.signals,
        silentPackages: { count: 2, ids: ['pkg-quiet-1', 'pkg-quiet-2'] },
        packagesLowBookings: { count: 1, averageRecordedBookings: 8.4, benchmarkRecordedBookings: 12, ids: ['pkg-booking-1'] },
        packagesLowViews: { count: 1, averageRecordedViews: 120, benchmarkRecordedViews: 300, ids: ['pkg-views-1'] },
        packagesLowInquiries: { count: 1, averageInquiries90Days: 1, benchmarkInquiries90Days: 4, ids: ['pkg-inquiry-1'] },
        packagesLowConversions: { count: 1, averageConversionRate90Days: 10, benchmarkConversionRate90Days: 40, qualifiedPackages: 8, ids: ['pkg-conversion-1'] },
        packagesNoConversions: { count: 1, averageInquiries90Days: 4, qualifiedPackages: 6, ids: ['pkg-no-conversion-1'] },
        packagesLowRating: { count: 1, averageRating: 3.8, benchmarkRating: 4.4, qualifiedPackages: 10, ids: ['pkg-rating-1'] },
        packagesLowReviews: { count: 1, averageReviews: 2, benchmarkReviews: 5, ids: ['pkg-review-1'] },
      },
    };

    const recommendations = await generateRecommendations(packageSignals);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].module).toBe('leads');
    expect(recommendations.some(({ module }) => module === 'packages')).toBe(false);
  });

  it('deduplicates repeated AI findings without adding package rules', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: Array.from({ length: 30 }, (_, index) => aiRecommendation({
        key: `leads.finding-${index}`,
        module: 'dashboard',
        evidence: [{ signal: 'flightOverview', field: 'pendingBookings' }],
        summary: 'Review the current lead follow-up workflow.',
      })) }),
    });
    const packageSignals = {
      ...source,
      signals: {
        ...source.signals,
        coldLeads: { count: 0, oldestAgeDays: 0, ids: [] },
        flightOverview: { pendingBookings: 12, ids: [] },
        packagesLowRating: {
          count: 1,
          averageRating: 3.8,
          benchmarkRating: 4.4,
          qualifiedPackages: 10,
          ids: ['pkg-low-rating'],
        },
      },
    };

    const recommendations = await generateRecommendations(packageSignals);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({ module: 'dashboard', key: expect.stringMatching(/^ai\.dashboard\./) });
    expect(recommendations.some(({ module }) => module === 'packages')).toBe(false);
  });

  it('generates a booking insight from lifecycle, payment, and upcoming-travel aggregates', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'bookings.pending-payment-risk',
        module: 'analytics',
        category: 'finance',
        title: 'Review upcoming bookings with unpaid balances',
        summary: 'Confirmed bookings are approaching travel with payment still pending.',
        evidence: [
          { signal: 'bookingOverview', field: 'confirmedBookingsUnpaid' },
          { signal: 'bookingOverview', field: 'confirmedTravelWithin30Days' },
        ],
        actionLabel: 'Review booking analytics',
      })] }),
    });
    const bookingSignals = {
      ...source,
      signals: {
        ...source.signals,
        bookingOverview: { confirmedBookingsUnpaid: 2, confirmedTravelWithin30Days: 5, ids: [] },
      },
    };

    const [result] = await generateRecommendations(bookingSignals);

    expect(result).toMatchObject({
      module: 'analytics',
      relatedRecordIds: [],
      evidence: [
        { label: 'Booking Overview: Confirmed Bookings Unpaid', value: 2 },
        { label: 'Booking Overview: Confirmed Travel Within 30 Days', value: 5 },
      ],
      action: { label: 'Review booking analytics', module: 'analytics' },
    });
  });

  it('generates a Hotel-tab insight from upcoming reservation status data', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'hotels.pending-arrivals',
        module: 'hotels',
        category: 'operations',
        title: 'Resolve pending upcoming hotel reservations',
        summary: 'Upcoming check-ins still have reservations awaiting confirmation.',
        evidence: [
          { signal: 'hotelOverview', field: 'pendingCheckins30Days' },
          { signal: 'hotelOverview', field: 'unresolvedCheckinRate30DaysPct' },
        ],
        actionLabel: 'Review hotel bookings',
        actionTab: 'bookings',
      })] }),
    });
    const hotelSignals = {
      ...source,
      signals: {
        ...source.signals,
        hotelOverview: { pendingCheckins30Days: 2, unresolvedCheckinRate30DaysPct: 28.6, ids: ['hotel-a', 'hotel-b'] },
      },
    };

    const [result] = await generateRecommendations(hotelSignals);

    expect(result).toMatchObject({
      module: 'hotels',
      relatedRecordIds: ['hotel-a', 'hotel-b'],
      evidence: [
        { label: 'Hotel Overview: Pending Checkins 30 Days', value: 2 },
        { label: 'Hotel Overview: Unresolved Checkin Rate 30 Days Pct', value: 28.6 },
      ],
      action: { label: 'Review hotel bookings', module: 'hotels', tab: 'bookings' },
    });
  });

  it('links an AI Users insight to affected website customer accounts', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        key: 'users.verification-follow-up',
        module: 'users',
        category: 'operations',
        title: 'Review account verification backlog',
        summary: 'A number of active accounts still need email verification.',
        actionTab: 'website-users',
        evidence: [
          { signal: 'unverifiedCustomerAccounts', field: 'count' },
          { signal: 'unverifiedCustomerAccounts', field: 'ratePct' },
        ],
        actionLabel: 'Review users',
      })] }),
    });
    const userSignals = {
      ...source,
      signals: {
        ...source.signals,
        unverifiedCustomerAccounts: { count: 5, ratePct: 16.7, ids: ['customer-a', 'customer-b'] },
      },
    };

    const result = (await generateRecommendations(userSignals)).find(({ module }) => module === 'users');

    expect(result).toMatchObject({
      module: 'users',
      relatedRecordIds: ['customer-a', 'customer-b'],
      evidence: [
        { label: 'Unverified Customer Accounts: Count', value: 5 },
        { label: 'Unverified Customer Accounts: Rate Pct', value: 16.7 },
      ],
      action: { label: 'Review users', module: 'users', tab: 'website-users' },
    });
    expect(result.key).toMatch(/^ai\.users\./);
  });

  it('drops recommendations that cite fields analytics did not supply', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({ evidence: [{ signal: 'coldLeads', field: 'email' }] })] }),
    });

    const noLeadFindings = { ...source, signals: { ...source.signals, coldLeads: { count: 0, oldestAgeDays: 0, ids: [] } } };
    await expect(generateRecommendations(noLeadFindings)).resolves.toEqual([]);
  });

  it('drops recommendations with numeric claims unsupported by their cited signal', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({ summary: '100 cold leads need a follow-up.' })] }),
    });

    const noLeadFindings = { ...source, signals: { ...source.signals, coldLeads: { count: 0, oldestAgeDays: 0, ids: [] } } };
    await expect(generateRecommendations(noLeadFindings)).resolves.toEqual([]);
  });

  it('keeps grounded findings when another candidate in the AI response is invalid', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [
        aiRecommendation(),
        aiRecommendation({
          key: 'leads.unsupported-count',
          summary: 'There are 999 cold leads to contact.',
        }),
      ] }),
    });

    const recommendations = await generateRecommendations(source);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].key).toMatch(/^ai\.leads\./);
  });

  it('keeps a recommendation whose cited signal supports its time-window threshold', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({
        summary: 'These leads have had no update for at least 7 days.',
      })] }),
    });

    const [recommendation] = await generateRecommendations(source);
    expect(recommendation.key).toMatch(/^ai\.leads\./);
  });

  it('allows Gemini to route grounded evidence to another supported module', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ recommendations: [aiRecommendation({ module: 'billing' })] }),
    });

    const [recommendation] = await generateRecommendations(source);

    expect(recommendation).toMatchObject({ module: 'billing', action: { module: 'billing' } });
    expect(recommendation.key).toMatch(/^ai\.billing\./);
  });

  it('fails explicitly when the AI provider is not configured', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateRecommendations(source)).rejects.toBeInstanceOf(AIRecommendationsUnavailableError);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../db/pool.js', () => ({ default: mockPool }));

const { getBusinessSignals } = await import('../business.controller.js');

const rows = (value) => ({ rows: [value] });
const zeroRow = { count: '0', value: '0', ids: [] };
const mockRes = () => {
  const res = {};
  res.json = vi.fn(() => res);
  return res;
};

/**
 * node-pg rejects a statement whose bound-parameter count exceeds its
 * placeholders ("bind message supplies 3 parameters, but prepared statement
 * requires 2"), and a missing binding is silently wrong. Both are caught here
 * rather than only at runtime against a live database.
 */
function expectEveryQueryBindsItsPlaceholders(expectedRepId) {
  const mismatches = [];
  for (const [sql, params] of mockPool.query.mock.calls) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    if (params.length !== Math.max(...placeholders)) {
      mismatches.push(`placeholders=${Math.max(...placeholders)} bound=${params.length} :: ${sql.slice(0, 90)}`);
    }
  }
  expect(mismatches).toEqual([]);
  for (const [sql, params] of mockPool.query.mock.calls) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(params[0]).toBeInstanceOf(Date);
    // The concentration statement binds the currency at $2 (it has no owner
    // predicate); every other statement that binds $2 binds the owner there.
    const bindsOwner = placeholders.includes(2) && (sql.includes('"assignedToId" = $2') || sql.includes('"createdById" = $2'));
    if (bindsOwner) expect(params[1]).toBe(expectedRepId);
    if (placeholders.includes(3)) expect(params[2]).toBe('USD');
  }
}

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue(rows(zeroRow));
});

describe('getBusinessSignals', () => {
  it('returns all 37 named signals for an admin and scopes every query company-wide', async () => {
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();

    await getBusinessSignals(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.scope).toBe('org');
    expect(Object.keys(payload.data.signals)).toHaveLength(37);
    expect(payload.data.signals.unconvertedQuotes).toEqual({ count: 0, value: 0, oldestAgeDays: 0, ids: [] });
    expect(payload.data.signals.flightsNeedingReview).toEqual({ count: 0, nearestDeparture: null, ids: [] });
    expect(payload.data.signals.hotelsNeedingReview).toEqual({ count: 0, nearestCheckin: null, ids: [] });
    expect(payload.data.signals.userOverview).toMatchObject({ totalUsers: 0, activeUsers: 0, unverifiedUsers: 0 });
    expect(payload.data.signals.unverifiedCustomerAccounts).toEqual({ count: 0, ratePct: null, ids: [] });
    expect(payload.data.signals.careerOverview).toMatchObject({ totalApplications: 0, activeVacancies: 0, vacanciesClosing14Days: 0 });
    expect(payload.data.signals.packageOverview).toMatchObject({ packageInquiries90Days: 0, packageConversions90Days: 0 });
    expect(payload.data.signals.packagesLowBookings).toEqual({ count: 0, averageRecordedBookings: 0, benchmarkRecordedBookings: 0, ids: [] });
    expect(payload.data.signals.packagesLowViews).toEqual({ count: 0, averageRecordedViews: 0, benchmarkRecordedViews: 0, ids: [] });
    expect(payload.data.signals.packagesLowInquiries).toEqual({ count: 0, averageInquiries90Days: 0, benchmarkInquiries90Days: 0, ids: [] });
    expect(payload.data.signals.packagesLowConversions).toEqual({ count: 0, averageConversionRate90Days: 0, benchmarkConversionRate90Days: 0, qualifiedPackages: 0, ids: [] });
    expect(payload.data.signals.packagesNoConversions).toEqual({ count: 0, averageInquiries90Days: 0, qualifiedPackages: 0, ids: [] });
    expect(payload.data.signals.packagesLowRating).toEqual({ count: 0, averageRating: 0, benchmarkRating: 0, qualifiedPackages: 0, ids: [] });
    expect(payload.data.signals.packagesLowReviews).toEqual({ count: 0, averageReviews: 0, benchmarkReviews: 0, ids: [] });
    expect(payload.data.signals.hotelOverview).toMatchObject({
      pendingCheckins30Days: 0,
      failedCheckins30Days: 0,
      pendingRatePct: null,
      unresolvedCheckinRate30DaysPct: null,
      ids: [],
    });
    expect(payload.data.signals.userOverview).toMatchObject({ activeRatePct: null, unverifiedRatePct: null });
    expect(payload.data.signals.bookingOverview).toMatchObject({ pendingRatePct: null, confirmedUnpaidRatePct: null });
    expect(payload.data.signals.bookingOverview).toMatchObject({
      totalBookings: 0,
      confirmedBookingsUnpaid: 0,
      pastTravelStillConfirmed: 0,
    });
    expect(mockPool.query).toHaveBeenCalledTimes(30);
    expectEveryQueryBindsItsPlaceholders(null);
  });

  it('adds measured rates to hotel, user, booking, and conversion signals', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('AS "curTotal"')) return rows({ curTotal: '10', curWon: '3', prevTotal: '10', prevWon: '2' });
      if (sql.includes('AS "totalHotelBookings"')) return rows({
        totalHotelBookings: '10', pendingHotels: '2', confirmedHotels: '6', failedHotels: '1', cancelledHotels: '1',
        checkinsWithin30Days: '4', pendingCheckins30Days: '1', failedCheckins30Days: '1',
        unresolvedIds: ['hotel-a', 'hotel-b'],
      });
      if (sql.includes('AS "totalUsers"')) return rows({
        totalUsers: '20', activeUsers: '16', verifiedUsers: '15', unverifiedUsers: '5', newUsers30Days: '4',
        customerUsers: '10', unverifiedCustomers: '3', unverifiedCustomerIds: ['customer-1', 'customer-2'],
      });
      if (sql.includes('AS "totalBookings"')) return rows({
        totalBookings: '10', pendingBookings: '2', confirmedBookings: '5', confirmedBookingsUnpaid: '1', confirmedBookingsPartPaid: '2',
      });
      return rows(zeroRow);
    });

    const res = mockRes();
    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());
    const { signals } = res.json.mock.calls[0][0].data;
    const [hotelOverviewSql] = mockPool.query.mock.calls.find(([sql]) => sql.includes('AS "totalHotelBookings"'));

    expect(signals.conversionTrend).toMatchObject({ curWinRatePct: 30, prevWinRatePct: 20, winRateChangePp: 10 });
    expect(signals.hotelOverview).toMatchObject({
      pendingRatePct: 20,
      failedRatePct: 10,
      unresolvedCheckinRate30DaysPct: 50,
      ids: ['hotel-a', 'hotel-b'],
    });
    expect(hotelOverviewSql).toContain("ARRAY_AGG(id ORDER BY checkin ASC) FILTER (WHERE status IN ('pending', 'failed'))");
    expect(signals.userOverview).toMatchObject({ activeRatePct: 80, unverifiedRatePct: 25 });
    expect(signals.unverifiedCustomerAccounts).toEqual({ count: 3, ratePct: 30, ids: ['customer-1', 'customer-2'] });
    expect(signals.bookingOverview).toMatchObject({ pendingRatePct: 20, confirmedUnpaidRatePct: 20, confirmedPartPaidRatePct: 40 });
  });

  it('counts upcoming flights that are neither ticketed nor cancelled', async () => {
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    const [flightQuery, flightParams] = mockPool.query.mock.calls.find(([sql]) => sql.includes('FROM crm_flights."FlightBooking" flight'));
    expect(flightQuery).toContain("flight.status NOT IN ('ticketed', 'cancelled')");
    expect(flightQuery).toContain('segment."departureAt" BETWEEN $1 AND $1::timestamptz + interval \'7 days\'');
    expect(flightParams[1]).toBeNull();
  });

  it('maps main booking lifecycle and payment aggregates into the business signal', async () => {
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('pendingBookingsOver7Days')
        ? {
            totalBookings: '18',
            pendingBookings: '3',
            confirmedBookings: '8',
            completedBookings: '5',
            cancelledBookings: '2',
            confirmedBookingsUnpaid: '2',
            confirmedBookingsPartPaid: '1',
            confirmedBookingsPaid: '5',
            confirmedTravelWithin30Days: '4',
            pastTravelStillConfirmed: '1',
            pendingBookingsOver7Days: '2',
          }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.bookingOverview).toEqual({
      totalBookings: 18,
      pendingBookings: 3,
      pendingRatePct: 16.7,
      confirmedBookings: 8,
      completedBookings: 5,
      cancelledBookings: 2,
      confirmedBookingsUnpaid: 2,
      confirmedUnpaidRatePct: 25,
      confirmedBookingsPartPaid: 1,
      confirmedPartPaidRatePct: 12.5,
      confirmedBookingsPaid: 5,
      confirmedTravelWithin30Days: 4,
      pastTravelStillConfirmed: 1,
      pendingBookingsOver7Days: 2,
    });
  });

  it('passes the sales rep id into every data query and zeros org-only signals without querying them', async () => {
    const req = { user: { id: 'rep-7', role: 'salesRep' } };
    const res = mockRes();

    await getBusinessSignals(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.scope).toBe('own');
    expect(payload.data.signals.unassignedLeads.count).toBe(0);
    expect(payload.data.signals.cancellationSpike).toEqual({ cur: 0, baseline: 0 });
    expect(payload.data.signals.silentPackages.count).toBe(0);
    expect(payload.data.signals.userOverview).toBeNull();
    expect(payload.data.signals.careerOverview).toBeNull();
    expect(payload.data.signals.bookingOverview).toMatchObject({ totalBookings: 0, pendingBookings: 0 });
    expect(mockPool.query).toHaveBeenCalledTimes(22);
    expectEveryQueryBindsItsPlaceholders('rep-7');
  });

  it('normalizes database strings, nullable dates, and id arrays for the wire response', async () => {
    mockPool.query.mockResolvedValue(rows(zeroRow));
    mockPool.query.mockResolvedValueOnce(rows({
      count: '8',
      value: '24000.50',
      oldestAgeDays: '12',
      ids: ['quote-1', null, 'quote-2'],
    }));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.unconvertedQuotes).toEqual({
      count: 8,
      value: 24000.5,
      oldestAgeDays: 12,
      ids: ['quote-1', 'quote-2'],
    });
    expect(res.json.mock.calls[0][0].data.signals.departuresOutstanding.nearestDeparture).toBeNull();
  });

  it('returns the package ids behind the quiet-packages signal', async () => {
    const packageIds = ['4a958671-d29b-465c-b68c-e855472133f9', 'ed7c45b7-2eed-4690-87d8-c53bdf4408e6'];
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('FROM crm_packages."Package" package')
        ? { count: '2', ids: packageIds }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.silentPackages).toEqual({ count: 2, ids: packageIds });
    expect(mockPool.query.mock.calls.find(([sql]) => sql.includes('FROM crm_packages."Package" package'))[0])
      .toContain('ARRAY_AGG(package.id');
  });

  it('returns benchmarked package cohorts with ids for filtered recommendations', async () => {
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('WITH inquiry_metrics AS')
        ? {
            lowBookingsCount: '2', lowBookingsAverage: '0.5', bookingBenchmark: '3', lowBookingIds: ['pkg-booking-1', 'pkg-booking-2'],
            lowInquiriesCount: '1', lowInquiriesAverage: '1', inquiryBenchmark: '4', lowInquiryIds: ['pkg-inquiry-1'],
            lowConversionsCount: '1', lowConversionsAverage: '10', conversionBenchmark: '40', qualifiedConversionPackages: '8', lowConversionIds: ['pkg-conversion-1'],
            noConversionCount: '2', noConversionAverageInquiries: '4', noConversionIds: ['pkg-no-conversion-1', 'pkg-no-conversion-2'],
            lowRatingsCount: '1', lowRatingsAverage: '3', ratingBenchmark: '4.5', qualifiedRatingPackages: '6', lowRatingIds: ['pkg-rating-1'],
            lowReviewsCount: '2', lowReviewsAverage: '1.5', reviewBenchmark: '4', lowReviewIds: ['pkg-review-1', 'pkg-review-2'],
          }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'rep-7', role: 'salesRep' } }, res, vi.fn());

    const signals = res.json.mock.calls[0][0].data.signals;
    expect(signals.packagesLowBookings).toEqual({ count: 2, averageRecordedBookings: 0.5, benchmarkRecordedBookings: 3, ids: ['pkg-booking-1', 'pkg-booking-2'] });
    expect(signals.packagesLowViews).toEqual({ count: 0, averageRecordedViews: 0, benchmarkRecordedViews: 0, ids: [] });
    expect(signals.packagesLowInquiries).toEqual({ count: 1, averageInquiries90Days: 1, benchmarkInquiries90Days: 4, ids: ['pkg-inquiry-1'] });
    expect(signals.packagesLowConversions).toEqual({ count: 1, averageConversionRate90Days: 10, benchmarkConversionRate90Days: 40, qualifiedPackages: 8, ids: ['pkg-conversion-1'] });
    expect(signals.packagesNoConversions).toEqual({ count: 2, averageInquiries90Days: 4, qualifiedPackages: 8, ids: ['pkg-no-conversion-1', 'pkg-no-conversion-2'] });
    expect(signals.packagesLowRating).toEqual({ count: 1, averageRating: 3, benchmarkRating: 4.5, qualifiedPackages: 6, ids: ['pkg-rating-1'] });
    expect(signals.packagesLowReviews).toEqual({ count: 2, averageReviews: 1.5, benchmarkReviews: 4, ids: ['pkg-review-1', 'pkg-review-2'] });
    const [sql, params] = mockPool.query.mock.calls.find(([query]) => query.includes('WITH inquiry_metrics AS'));
    expect(sql).toContain('booking_median');
    expect(sql).toContain('conversion_rate');
    expect(sql).toContain('rating_median');
    expect(params[1]).toBe('rep-7');
    expectEveryQueryBindsItsPlaceholders('rep-7');
  });

  it('maps package overview query metrics to the packageOverview signal', async () => {
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('AS "activePackages"')
        ? {
        activePackages: '25', inactivePackages: '3', catalogViews: '17364', recordedBookings: '342',
        averageActiveRating: '4.4', activePackageReviews: '283', packageInquiries90Days: '12', packageConversions90Days: '3',
          }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.packageOverview).toEqual({
      activePackages: 25,
      inactivePackages: 3,
      catalogViews: 17364,
      recordedBookings: 342,
      averageActiveRating: 4.4,
      activePackageReviews: 283,
      packageInquiries90Days: 12,
      packageConversions90Days: 3,
    });
  });

  it('returns all linked lead ids when a signal count exceeds fifty', async () => {
    const leadIds = Array.from({ length: 63 }, (_, index) => `lead-${index + 1}`);
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('COALESCE(pricing."sellSubtotal", 0) >= 2000')
        ? { count: '63', oldestAgeDays: '12', ids: leadIds }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    const coldLeadQuery = mockPool.query.mock.calls.find(([sql]) => sql.includes('COALESCE(pricing."sellSubtotal", 0) >= 2000'))[0];
    expect(coldLeadQuery).toContain('[1:100]');
    expect(res.json.mock.calls[0][0].data.signals.coldLeads).toMatchObject({ count: 63, ids: leadIds });
  });
});

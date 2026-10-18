import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../db/pool.js', () => ({ default: mockPool }));

const {
  getLeadAnalyticsOverview,
  getBillingAnalyticsOverview,
  getPackageAnalyticsOverview,
  getUserAnalyticsOverview,
  getSalesRepPersonalPerformance,
  getAllSalesRepsPerformance,
  getWebsiteAnalyticsOverview,
} = await import('../analytics.controller.js');

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const rows = (r) => ({ rows: r });
const adminReq = (overrides = {}) => ({ query: {}, user: { id: 'admin-1', role: 'admin' }, ...overrides });

describe('getLeadAnalyticsOverview', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('returns real funnel-stage counts and distributions, not the raw column values', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '10', all_time_total: '42', new: '3', contacted: '7', interested: '4', quoted: '2', converted: '2' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01T00:00:00Z', new: '3', contacted: '7', interested: '4', converted: '2' }]))
      .mockResolvedValueOnce(rows([{ name: 'NEW', value: '3' }]))
      .mockResolvedValueOnce(rows([{ name: 'Website Form', value: '5' }]))
      .mockResolvedValueOnce(rows([{ country: 'USA', leads: '6', conversion: '33.3' }]))
      .mockResolvedValueOnce(rows([{ destination: 'Bali', leads: '4', conversion: '50.0' }]))
      .mockResolvedValueOnce(rows([{ budget: '$7,500' }, { budget: 'flexible' }]));

    const req = adminReq({ query: { timeRange: 'monthly' } });
    const res = mockRes();

    await getLeadAnalyticsOverview(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.stats).toEqual({ totalLeads: 10, allTimeTotalLeads: 42, new: 3, contacted: 7, interested: 4, quoted: 2, converted: 2 });
    expect(data.trend[0]).toMatchObject({ new: 3, contacted: 7, interested: 4, converted: 2 });
    expect(data.statusDistribution).toEqual([{ name: 'NEW', value: 3 }]);
    expect(data.categoryDistribution).toEqual([{ name: 'Website Form', value: 5 }]);
    expect(data.topCountries).toEqual([{ country: 'USA', leads: 6, conversion: 33.3 }]);
    expect(data.topDestinations).toEqual([{ destination: 'Bali', leads: 4, conversion: 50 }]);
    expect(data.priceRangeDistribution).toEqual(
      expect.arrayContaining([{ range: '$5K–$10K', value: 1 }, { range: 'Unknown', value: 1 }])
    );
  });

  it('returns zero stats without throwing when there are no leads in the window', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '0', all_time_total: '0', new: '0', contacted: '0', interested: '0', quoted: '0', converted: '0' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    const res = mockRes();
    await getLeadAnalyticsOverview(adminReq(), res, vi.fn());

    expect(res.json.mock.calls[0][0].data.stats.totalLeads).toBe(0);
    expect(res.json.mock.calls[0][0].data.stats.allTimeTotalLeads).toBe(0);
    expect(res.json.mock.calls[0][0].data.priceRangeDistribution).toEqual([]);
  });

  it('passes the caller\'s id as the ownership filter param when role is salesRep', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '0', all_time_total: '0', new: '0', contacted: '0', interested: '0', quoted: '0', converted: '0' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    const req = { query: {}, user: { id: 'rep-7', role: 'salesRep' } };
    await getLeadAnalyticsOverview(req, mockRes(), vi.fn());

    expect(mockPool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['rep-7']));
    // trend query has truncUnit ahead of repId — repId is still the last param
    const trendParams = mockPool.query.mock.calls[1][1];
    expect(trendParams[trendParams.length - 1]).toBe('rep-7');
  });

  it('passes null for admin, returning company-wide data', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '0', all_time_total: '0', new: '0', contacted: '0', interested: '0', quoted: '0', converted: '0' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    await getLeadAnalyticsOverview(adminReq(), mockRes(), vi.fn());

    expect(mockPool.query.mock.calls[0][1]).toEqual(expect.arrayContaining([null]));
  });
});

describe('getBillingAnalyticsOverview', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('derives totalPotentialRevenue from draft-status invoices, distinct from outstanding', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ collected: '5000', outstanding: '1200', pipeline: '3000', pending_invoices: '4', current_outstanding: '3800', current_pending_invoices: '8' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01', revenue: '5000' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01', outstanding: '1200', potential_revenue: '3000' }]))
      .mockResolvedValueOnce(rows([{ status: 'paid', count: '5', total: '5000' }]))
      .mockResolvedValueOnce(rows([{ name: 'invoice', invoices: '5', revenue: '5000' }]));

    const res = mockRes();
    await getBillingAnalyticsOverview(adminReq(), res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.stats).toEqual({ totalRevenue: 5000, totalOutstanding: 1200, currentOutstanding: 3800, currentPendingInvoices: 8, totalPotentialRevenue: 3000, pendingInvoices: 4 });
    expect(mockPool.query.mock.calls[0][0]).toContain("all_i.status IN ('sent','viewed','overdue','partial')");
    expect(data.paymentStatusDistribution[0]).toEqual({ name: 'Paid', status: 'paid', totalAmount: 5000 });
    expect(data.invoiceCategoryBreakdown[0].name).toBe('Invoice');
  });

  it('passes the caller\'s id as the ownership filter param (via the Invoice→Lead join) when role is salesRep', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ collected: '0', outstanding: '0', pipeline: '0', pending_invoices: '0', current_outstanding: '0', current_pending_invoices: '0' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    const req = { query: {}, user: { id: 'rep-9', role: 'salesRep' } };
    await getBillingAnalyticsOverview(req, mockRes(), vi.fn());

    expect(mockPool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['rep-9']));
    expect(mockPool.query.mock.calls[0][0]).toMatch(/JOIN crm_leads\."Lead"/);
  });

  it('uses the first bucket\'s own revenue as its target so there is no fabricated growth', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ collected: '0', outstanding: '0', pipeline: '0', pending_invoices: '0', current_outstanding: '0', current_pending_invoices: '0' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-06-01', revenue: '1000' }, { bucket: '2026-07-01', revenue: '1500' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    const res = mockRes();
    await getBillingAnalyticsOverview(adminReq(), res, vi.fn());

    const trend = res.json.mock.calls[0][0].data.revenueTrend;
    expect(trend[0]).toMatchObject({ revenue: 1000, target: 1000 });
    expect(trend[1]).toMatchObject({ revenue: 1500, target: 1000 });
  });
});

describe('getPackageAnalyticsOverview', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('reports in-range inquiries/conversions for active packages only', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '12' }]))
      .mockResolvedValueOnce(rows([{ total_inquiries: '8', total_conversions: '3' }]))
      .mockResolvedValueOnce(rows([{ id: 'p1', name: 'Bali Escape', inquiries: '5', conversions: '2' }]))
      .mockResolvedValueOnce(rows([{ destination: 'Bali', inquiries: '5', conversions: '2' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01', inquiries: '8', conversions: '3' }]));

    const res = mockRes();
    await getPackageAnalyticsOverview({ query: {} }, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.stats).toEqual({ totalItineraries: 12, totalInquiries: 8, totalConversions: 3 });
    expect(data.mostInquired).toEqual([{ name: 'Bali Escape', inquiries: 5, conversions: 2 }]);
    expect(data.trend[0]).toMatchObject({ inquiries: 8, conversions: 3 });
    expect(data.trend[0]).toHaveProperty('month');

    const queries = mockPool.query.mock.calls.map(([sql]) => sql);
    expect(queries[1]).toContain('JOIN crm_packages."Package" p ON p.id = lps."packageId" AND p."is_active" = true');
    expect(queries[2]).toContain('COUNT(DISTINCT l.id) AS inquiries');
    expect(queries[2]).toContain('l."createdAt" BETWEEN $1 AND $2');
    expect(queries[2]).toContain('WHERE p."is_active" = true');
    expect(queries[3]).toContain('COUNT(DISTINCT l.id) AS inquiries');
    expect(queries[3]).toContain('l."createdAt" BETWEEN $1 AND $2');
    expect(queries[3]).toContain('WHERE p."is_active" = true');
    expect(queries[4]).toContain('JOIN crm_packages."Package" p ON p.id = lps."packageId" AND p."is_active" = true');
  });
});

describe('getUserAnalyticsOverview', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('derives inactiveUsers and conversionRate from the raw counts', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '20', active: '15', verified: '10', all_time_total: '100' }]))
      .mockResolvedValueOnce(rows([{ count: '4' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01', total_new_users: '20', active_users: '15', admin_users: '2' }]))
      .mockResolvedValueOnce(rows([{ role: 'customer', count: '15' }, { role: 'admin', count: '5' }]));

    const res = mockRes();
    await getUserAnalyticsOverview({ query: {} }, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.stats).toEqual({ totalUsers: 20, allTimeTotalUsers: 100, activeUsers: 15, inactiveUsers: 5, verifiedUsers: 10, usersWithBookings: 4, conversionRate: 20 });
    expect(data.userStatusDistribution).toEqual([{ name: 'Active', value: 15 }, { name: 'Inactive', value: 5 }]);
    expect(data.topRoles).toEqual([{ role: 'customer', count: 15 }, { role: 'admin', count: 5 }]);
  });

  it('returns a 0 conversionRate instead of dividing by zero when there are no users', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '0', active: '0', verified: '0', all_time_total: '0' }]))
      .mockResolvedValueOnce(rows([{ count: '0' }]))
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([]));

    const res = mockRes();
    await getUserAnalyticsOverview({ query: {} }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.stats.conversionRate).toBe(0);
  });
});

describe('getSalesRepPersonalPerformance', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('nests results under performance{} matching what the dashboard reads', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total: '10', converted: '4', pending: '5' }]))
      .mockResolvedValueOnce(rows([{ id: 'lead-1', name: 'Jane', email: 'jane@test.com', status: 'NEW', createdAt: '2026-08-01' }]));

    const req = { query: {}, user: { id: 'rep-1' } };
    const res = mockRes();
    await getSalesRepPersonalPerformance(req, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.performance).toEqual({ leadsAssigned: 10, converted: 4, pending: 5, conversionRate: 40 });
    expect(data.recentLeads).toHaveLength(1);
  });

  it('scopes the query to the requesting rep\'s own id', async () => {
    mockPool.query.mockResolvedValueOnce(rows([{ total: '0', converted: '0', pending: '0' }])).mockResolvedValueOnce(rows([]));

    await getSalesRepPersonalPerformance({ query: {}, user: { id: 'rep-42' } }, mockRes(), vi.fn());

    expect(mockPool.query.mock.calls[0][1][0]).toBe('rep-42');
  });
});

describe('getAllSalesRepsPerformance', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('returns one row per sales rep with a computed conversion percentage', async () => {
    mockPool.query.mockResolvedValueOnce(rows([{ rep: 'Jane Doe', sales: '8', conversion: '40.0' }]));

    const res = mockRes();
    await getAllSalesRepsPerformance({ query: {} }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data).toEqual([{ rep: 'Jane Doe', sales: 8, conversion: 40 }]);
  });

  it('falls back conversion to 0 for a rep with no leads (NULL from the SQL)', async () => {
    mockPool.query.mockResolvedValueOnce(rows([{ rep: 'New Rep', sales: '0', conversion: null }]));

    const res = mockRes();
    await getAllSalesRepsPerformance({ query: {} }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data[0].conversion).toBe(0);
  });
});

describe('getWebsiteAnalyticsOverview', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('buckets duration/price data from the package-performance join and proxies activities from Package.category', async () => {
    mockPool.query
      .mockResolvedValueOnce(rows([{ total_searches: '10', unique_destinations: '3', total_bookings: '4' }]))
      .mockResolvedValueOnce(rows([{ name: 'FAMILY', value: '6' }, { name: 'HONEYMOON', value: '4' }]))
      .mockResolvedValueOnce(rows([{ bucket: '2026-08-01', searches: '10', conversions: '4' }]))
      .mockResolvedValueOnce(rows([{ destination: 'Bali', searches: '5', conversions: '2' }]))
      .mockResolvedValueOnce(rows([{ durationDays: '5', basePrice: '3000', searches: '3', bookings: '1' }]));

    const res = mockRes();
    await getWebsiteAnalyticsOverview({ query: {} }, res, vi.fn());

    const data = res.json.mock.calls[0][0].data;
    expect(data.stats).toEqual({ totalSearches: 10, totalBookings: 4, uniqueDestinations: 3, uniqueActivities: 2, conversionRate: 40 });
    expect(data.accommodationTypes).toEqual([{ name: 'FAMILY', value: 6 }, { name: 'HONEYMOON', value: 4 }]);
    expect(data.durationPreferences).toEqual([{ duration: '4-7 days', searches: 3, bookings: 1 }]);
    expect(data.priceRanges).toEqual([{ range: '$2K–$5K', searches: 3 }]);
  });
});

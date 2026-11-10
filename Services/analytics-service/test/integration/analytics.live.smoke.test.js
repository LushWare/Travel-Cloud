import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';

// Opt-in live smoke test: runs every analytics-service query against the
// real (shared dev) Postgres database, not a mock. This exists specifically
// because unit tests mock pool.query and structurally cannot catch wrong
// column names, ambiguous GROUP BY clauses, or invalid enum literals — all
// three of which shipped past the mocked suite and only surfaced when the
// dashboard was run against the live DB. Excluded from `npm test`/CI via
// test:ci (see package.json), matching package-service's *.live.*.test.js
// convention — run explicitly with `npx vitest run test/integration/analytics.live.smoke.test.js`
// against an env with a real DATABASE_URL.
beforeAll(() => {
  if (!process.env.DATABASE_URL) throw new Error('SKIP_SUITE: DATABASE_URL not set');
});

const analyticsController = await import('../../src/controllers/analytics.controller.js');
const dashboardController = await import('../../src/controllers/dashboard.controller.js');
const { runWithTenant } = await import('../../../shared/tenancy/src/index.js');
const { DEMO_TENANT_ID } = await import('../../../shared/constants/src/index.js');

function invoke(handler, req) {
  return new Promise((resolvePromise, reject) => {
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { resolvePromise({ statusCode, body }); return this; },
    };
    // Runs as the demo agency; needs the Phase 1 tenancy migrations applied to the database.
    runWithTenant(DEMO_TENANT_ID, () => Promise.resolve(handler(req, res, reject))).catch(reject);
  });
}

const adminReq = (query = {}) => ({ query, user: { id: 'smoke-test', role: 'admin' } });

describe('analytics-service live smoke test (real DB, real enum labels, real GROUP BY)', () => {
  it.each(['daily', 'weekly', 'monthly', 'annual'])(
    'GET /analytics/leads/overview?timeRange=%s succeeds and returns the expected shape',
    async (timeRange) => {
      const { body } = await invoke(analyticsController.getLeadAnalyticsOverview, adminReq({ timeRange }));
      expect(body.success).toBe(true);
      expect(body.data.stats).toEqual(
        expect.objectContaining({ totalLeads: expect.any(Number), new: expect.any(Number), converted: expect.any(Number) })
      );
      expect(Array.isArray(body.data.trend)).toBe(true);
      expect(Array.isArray(body.data.topDestinations)).toBe(true);
    }
  );

  it('GET /analytics/billing/overview succeeds against the real Invoice table', async () => {
    const { body } = await invoke(analyticsController.getBillingAnalyticsOverview, adminReq());
    expect(body.success).toBe(true);
    expect(body.data.stats).toEqual(
      expect.objectContaining({ totalRevenue: expect.any(Number), totalOutstanding: expect.any(Number) })
    );
  });

  it('GET /analytics/packages/overview succeeds against real snake_case Package columns (is_active/duration_days/base_price)', async () => {
    const { body } = await invoke(analyticsController.getPackageAnalyticsOverview, adminReq());
    expect(body.success).toBe(true);
    expect(body.data.stats).toEqual(expect.objectContaining({ totalItineraries: expect.any(Number) }));
    expect(Array.isArray(body.data.destinationPerformance)).toBe(true);
  });

  it('GET /analytics/users/overview succeeds against the real User table', async () => {
    const { body } = await invoke(analyticsController.getUserAnalyticsOverview, adminReq());
    expect(body.success).toBe(true);
    expect(body.data.stats).toEqual(expect.objectContaining({ totalUsers: expect.any(Number) }));
  });

  it('GET /analytics/website/overview succeeds with the real LeadPlatform enum label ("Website Form")', async () => {
    const { body } = await invoke(analyticsController.getWebsiteAnalyticsOverview, adminReq());
    expect(body.success).toBe(true);
    expect(body.data.stats).toEqual(expect.objectContaining({ totalSearches: expect.any(Number) }));
  });

  it('GET /analytics/salesreps/performance succeeds against the real User+Lead join', async () => {
    const { body } = await invoke(analyticsController.getAllSalesRepsPerformance, adminReq());
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /analytics/salesreps/me/performance succeeds for a rep with no assigned leads', async () => {
    const { body } = await invoke(analyticsController.getSalesRepPersonalPerformance, { query: {}, user: { id: 'nonexistent-rep-id' } });
    expect(body.success).toBe(true);
    expect(body.data.performance).toEqual({ leadsAssigned: 0, converted: 0, pending: 0, conversionRate: 0 });
  });

  it('GET /dashboard succeeds with real lifecycleStatus/is_active columns', async () => {
    const { body } = await invoke(dashboardController.getDashboardStats, adminReq());
    expect(body.success).toBe(true);
    expect(body.data.leads).toEqual(expect.objectContaining({ total: expect.any(Number) }));
    expect(body.data.packages).toEqual(expect.objectContaining({ total: expect.any(Number), published: expect.any(Number) }));
  });
});

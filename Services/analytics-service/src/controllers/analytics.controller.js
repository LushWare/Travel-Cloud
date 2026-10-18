import pool from '../db/pool.js';
import asyncHandler from '../utils/asyncHandler.js';
import { resolveTimeRange, formatBucketLabel } from '../utils/timeRange.js';
import { parseBudgetToRange, priceRangeLabel, durationRangeLabel } from '../utils/buckets.js';

// Lead.lifecycleStatus (NEW, DRAFTING, QUOTED, REVISION, APPROVED,
// BOOKING_IN_PROGRESS, CONFIRMED, CLOSED_LOST, BOOKING_FAILED, CANCELLED) has
// no "contacted"/"interested" states, but the UI is built around that older
// 5-stage funnel. Best-effort mapping onto the real enum:
//   new       -> NEW
//   contacted -> anything past NEW (has had some engagement)
//   interested-> QUOTED, REVISION, APPROVED (actively evaluating a quote)
//   quoted    -> QUOTED
//   converted -> CONFIRMED
const FUNNEL_STATS_SQL = `
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE "lifecycleStatus" = 'NEW') AS new,
  COUNT(*) FILTER (WHERE "lifecycleStatus" != 'NEW') AS contacted,
  COUNT(*) FILTER (WHERE "lifecycleStatus" IN ('QUOTED','REVISION','APPROVED')) AS interested,
  COUNT(*) FILTER (WHERE "lifecycleStatus" = 'QUOTED') AS quoted,
  COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS converted
`;

export const getLeadAnalyticsOverview = asyncHandler(async (req, res) => {
  const { start, end, truncUnit } = resolveTimeRange(req.query.timeRange);
  // salesRep only ever sees their own leads across every chart on this page;
  // admin/superAdmin see company-wide data ($N::text IS NULL short-circuits).
  const repId = req.user.role === 'salesRep' ? req.user.id : null;

  const [statsResult, trendResult, statusResult, categoryResult, countryResult, destinationResult, budgetResult] = await Promise.all([
    pool.query(
      `SELECT ${FUNNEL_STATS_SQL},
        (SELECT COUNT(*) FROM crm_leads."Lead"
         WHERE "createdAt" <= CURRENT_TIMESTAMP AND ($3::text IS NULL OR "assignedToId" = $3)) AS all_time_total
       FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT DATE_TRUNC($3, "createdAt") AS bucket,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'NEW') AS new,
        COUNT(*) FILTER (WHERE "lifecycleStatus" != 'NEW') AS contacted,
        COUNT(*) FILTER (WHERE "lifecycleStatus" IN ('QUOTED','REVISION','APPROVED')) AS interested,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS converted
       FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($4::text IS NULL OR "assignedToId" = $4)
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit, repId]
    ),
    pool.query(
      `SELECT "lifecycleStatus"::text AS name, COUNT(*) AS value FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)
       GROUP BY "lifecycleStatus" ORDER BY value DESC`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT platform::text AS name, COUNT(*) AS value FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)
       GROUP BY platform ORDER BY value DESC`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT COALESCE("fromCountry", 'Unknown') AS country,
        COUNT(*) AS leads,
        ROUND(COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conversion
       FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)
       GROUP BY country ORDER BY leads DESC LIMIT 10`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT COALESCE(destination, "destinationCountry", 'Unknown') AS destination,
        COUNT(*) AS leads,
        ROUND(COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS conversion
       FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)
       GROUP BY 1 ORDER BY leads DESC LIMIT 10`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT budget FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR "assignedToId" = $3)`,
      [start, end, repId]
    ),
  ]);

  const s = statsResult.rows[0];
  const priceRangeCounts = new Map();
  for (const row of budgetResult.rows) {
    const label = parseBudgetToRange(row.budget);
    priceRangeCounts.set(label, (priceRangeCounts.get(label) || 0) + 1);
  }

  res.json({
    success: true,
    data: {
      stats: {
        totalLeads: Number(s.total),
        allTimeTotalLeads: Number(s.all_time_total),
        new: Number(s.new),
        contacted: Number(s.contacted),
        interested: Number(s.interested),
        quoted: Number(s.quoted),
        converted: Number(s.converted),
      },
      trend: trendResult.rows.map((row) => ({
        label: formatBucketLabel(row.bucket, truncUnit),
        new: Number(row.new),
        contacted: Number(row.contacted),
        interested: Number(row.interested),
        converted: Number(row.converted),
      })),
      statusDistribution: statusResult.rows.map((r) => ({ name: r.name, value: Number(r.value) })),
      categoryDistribution: categoryResult.rows.map((r) => ({ name: r.name, value: Number(r.value) })),
      topCountries: countryResult.rows.map((r) => ({ country: r.country, leads: Number(r.leads), conversion: Number(r.conversion) || 0 })),
      topDestinations: destinationResult.rows.map((r) => ({ destination: r.destination, leads: Number(r.leads), conversion: Number(r.conversion) || 0 })),
      priceRangeDistribution: Array.from(priceRangeCounts, ([range, value]) => ({ range, value })),
    },
  });
});

export const getBillingAnalyticsOverview = asyncHandler(async (req, res) => {
  const { start, end, truncUnit } = resolveTimeRange(req.query.timeRange);
  // Invoice has no direct rep column — join to its Lead to scope by the
  // assigned salesRep, same as getLeadAnalyticsOverview.
  const repId = req.user.role === 'salesRep' ? req.user.id : null;

  const [statsResult, revenueTrend, outstandingTrend, statusResult, typeResult] = await Promise.all([
    pool.query(
      `SELECT
        COALESCE(SUM(i."paidAmount") FILTER (WHERE i.status != 'cancelled'), 0) AS collected,
        COALESCE(SUM(i."outstandingAmount") FILTER (WHERE i.status NOT IN ('cancelled','draft')), 0) AS outstanding,
        COALESCE(SUM(i."totalAmount") FILTER (WHERE i.status = 'draft'), 0) AS pipeline,
        COUNT(*) FILTER (WHERE i.status IN ('sent','viewed','overdue','partial')) AS pending_invoices,
        (SELECT COALESCE(SUM(all_i."outstandingAmount"), 0)
         FROM crm_billing."Invoice" all_i
         JOIN crm_leads."Lead" all_l ON all_l.id = all_i."leadId"
         WHERE all_i.status IN ('sent','viewed','overdue','partial')
           AND ($3::text IS NULL OR all_l."assignedToId" = $3)) AS current_outstanding,
        (SELECT COUNT(*)
         FROM crm_billing."Invoice" all_i
         JOIN crm_leads."Lead" all_l ON all_l.id = all_i."leadId"
         WHERE all_i.status IN ('sent','viewed','overdue','partial')
           AND ($3::text IS NULL OR all_l."assignedToId" = $3)) AS current_pending_invoices
       FROM crm_billing."Invoice" i
       JOIN crm_leads."Lead" l ON l.id = i."leadId"
       WHERE i."createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR l."assignedToId" = $3)`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT DATE_TRUNC($3, i."createdAt") AS bucket, COALESCE(SUM(i."paidAmount"), 0) AS revenue
       FROM crm_billing."Invoice" i
       JOIN crm_leads."Lead" l ON l.id = i."leadId"
       WHERE i."createdAt" BETWEEN $1 AND $2 AND i.status != 'cancelled' AND ($4::text IS NULL OR l."assignedToId" = $4)
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit, repId]
    ),
    pool.query(
      `SELECT DATE_TRUNC($3, i."createdAt") AS bucket,
        COALESCE(SUM(i."outstandingAmount") FILTER (WHERE i.status IN ('sent','viewed','overdue','partial')), 0) AS outstanding,
        COALESCE(SUM(i."totalAmount") FILTER (WHERE i.status = 'draft'), 0) AS potential_revenue
       FROM crm_billing."Invoice" i
       JOIN crm_leads."Lead" l ON l.id = i."leadId"
       WHERE i."createdAt" BETWEEN $1 AND $2 AND ($4::text IS NULL OR l."assignedToId" = $4)
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit, repId]
    ),
    pool.query(
      `SELECT i.status::text AS status, COUNT(*) AS count, COALESCE(SUM(i."totalAmount"), 0) AS total
       FROM crm_billing."Invoice" i
       JOIN crm_leads."Lead" l ON l.id = i."leadId"
       WHERE i."createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR l."assignedToId" = $3)
       GROUP BY i.status`,
      [start, end, repId]
    ),
    pool.query(
      `SELECT i.type::text AS name, COUNT(*) AS invoices, COALESCE(SUM(i."totalAmount"), 0) AS revenue
       FROM crm_billing."Invoice" i
       JOIN crm_leads."Lead" l ON l.id = i."leadId"
       WHERE i."createdAt" BETWEEN $1 AND $2 AND ($3::text IS NULL OR l."assignedToId" = $3)
       GROUP BY i.type ORDER BY revenue DESC`,
      [start, end, repId]
    ),
  ]);

  const s = statsResult.rows[0];
  let previousRevenue = null;

  res.json({
    success: true,
    data: {
      stats: {
        totalRevenue: Number(s.collected),
        totalOutstanding: Number(s.outstanding),
        currentOutstanding: Number(s.current_outstanding),
        currentPendingInvoices: Number(s.current_pending_invoices),
        // "Potential Revenue" = drafted/pipeline invoices not yet sent — distinct
        // from Outstanding (already-billed, still-unpaid amounts).
        totalPotentialRevenue: Number(s.pipeline),
        pendingInvoices: Number(s.pending_invoices),
      },
      revenueTrend: revenueTrend.rows.map((row) => {
        const revenue = Number(row.revenue);
        // No real "target" entity exists — use the previous bucket's actual
        // revenue as a real, non-fabricated comparison baseline.
        const target = previousRevenue === null ? revenue : previousRevenue;
        previousRevenue = revenue;
        return { label: formatBucketLabel(row.bucket, truncUnit), revenue, target };
      }),
      outstandingTrend: outstandingTrend.rows.map((row) => ({
        label: formatBucketLabel(row.bucket, truncUnit),
        outstanding: Number(row.outstanding),
        potentialRevenue: Number(row.potential_revenue),
      })),
      paymentStatusDistribution: statusResult.rows.map((r) => ({
        name: r.status.charAt(0).toUpperCase() + r.status.slice(1),
        status: r.status,
        totalAmount: Number(r.total),
      })),
      invoiceCategoryBreakdown: typeResult.rows.map((r) => ({
        name: r.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        revenue: Number(r.revenue),
        invoices: Number(r.invoices),
      })),
    },
  });
});

export const getPackageAnalyticsOverview = asyncHandler(async (req, res) => {
  const { start, end, truncUnit } = resolveTimeRange(req.query.timeRange);

  const [totalResult, aggResult, perPackageResult, destinationResult, trendResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE "is_active" = true) AS total FROM crm_packages."Package"`),
    pool.query(
      `SELECT
        COUNT(DISTINCT lps."leadId") AS total_inquiries,
        COUNT(DISTINCT lps."leadId") FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS total_conversions
       FROM crm_leads."LeadPackageSelection" lps
       JOIN crm_leads."Lead" l ON l.id = lps."leadId"
       WHERE lps."packageId" IS NOT NULL AND l."createdAt" BETWEEN $1 AND $2`,
      [start, end]
    ),
    pool.query(
      `SELECT p.id, p.title AS name,
        COUNT(DISTINCT lps."leadId") AS inquiries,
        COUNT(DISTINCT lps."leadId") FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS conversions
       FROM crm_packages."Package" p
       LEFT JOIN crm_leads."LeadPackageSelection" lps ON lps."packageId" = p.id
       LEFT JOIN crm_leads."Lead" l ON l.id = lps."leadId" AND l."createdAt" BETWEEN $1 AND $2
       GROUP BY p.id, p.title
       ORDER BY inquiries DESC LIMIT 10`,
      [start, end]
    ),
    pool.query(
      `SELECT COALESCE(p.destination, 'Unknown') AS destination,
        COUNT(DISTINCT lps."leadId") AS inquiries,
        COUNT(DISTINCT lps."leadId") FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS conversions
       FROM crm_packages."Package" p
       LEFT JOIN crm_leads."LeadPackageSelection" lps ON lps."packageId" = p.id
       LEFT JOIN crm_leads."Lead" l ON l.id = lps."leadId" AND l."createdAt" BETWEEN $1 AND $2
       GROUP BY 1
       ORDER BY inquiries DESC LIMIT 10`,
      [start, end]
    ),
    pool.query(
      `SELECT DATE_TRUNC($3, l."createdAt") AS bucket,
        COUNT(DISTINCT lps."leadId") AS inquiries,
        COUNT(DISTINCT lps."leadId") FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS conversions
       FROM crm_leads."LeadPackageSelection" lps
       JOIN crm_leads."Lead" l ON l.id = lps."leadId"
       WHERE lps."packageId" IS NOT NULL AND l."createdAt" BETWEEN $1 AND $2
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit]
    ),
  ]);

  const agg = aggResult.rows[0];

  res.json({
    success: true,
    data: {
      stats: {
        totalItineraries: Number(totalResult.rows[0].total),
        totalInquiries: Number(agg.total_inquiries),
        totalConversions: Number(agg.total_conversions),
      },
      trend: trendResult.rows.map((row) => ({
        month: formatBucketLabel(row.bucket, truncUnit),
        inquiries: Number(row.inquiries),
        conversions: Number(row.conversions),
      })),
      destinationPerformance: destinationResult.rows.map((r) => ({
        destination: r.destination,
        inquiries: Number(r.inquiries),
        conversions: Number(r.conversions),
      })),
      mostInquired: perPackageResult.rows.map((r) => ({
        name: r.name,
        inquiries: Number(r.inquiries),
        conversions: Number(r.conversions),
      })),
    },
  });
});

export const getUserAnalyticsOverview = asyncHandler(async (req, res) => {
  const { start, end, truncUnit } = resolveTimeRange(req.query.timeRange);

  const [statsResult, bookingUsersResult, trendResult, roleResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE "isActive" = true) AS active,
        COUNT(*) FILTER (WHERE "isEmailVerified" = true) AS verified,
        (SELECT COUNT(*) FROM crm_users."User" WHERE "createdAt" <= CURRENT_TIMESTAMP) AS all_time_total
       FROM crm_users."User" WHERE "createdAt" BETWEEN $1 AND $2`,
      [start, end]
    ),
    pool.query(`SELECT COUNT(DISTINCT "userId") AS count FROM crm_bookings."Booking" WHERE "createdAt" BETWEEN $1 AND $2`, [start, end]),
    pool.query(
      `SELECT DATE_TRUNC($3, "createdAt") AS bucket,
        COUNT(*) AS total_new_users,
        COUNT(*) FILTER (WHERE "isActive" = true) AS active_users,
        COUNT(*) FILTER (WHERE role IN ('admin','superAdmin')) AS admin_users
       FROM crm_users."User" WHERE "createdAt" BETWEEN $1 AND $2
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit]
    ),
    pool.query(
      `SELECT role::text AS role, COUNT(*) AS count FROM crm_users."User"
       WHERE "createdAt" BETWEEN $1 AND $2 GROUP BY role ORDER BY count DESC`,
      [start, end]
    ),
  ]);

  const s = statsResult.rows[0];
  const total = Number(s.total);
  const active = Number(s.active);
  const usersWithBookings = Number(bookingUsersResult.rows[0].count);
  const roleDistribution = roleResult.rows.map((r) => ({ role: r.role, count: Number(r.count) }));

  res.json({
    success: true,
    data: {
      stats: {
        totalUsers: total,
        allTimeTotalUsers: Number(s.all_time_total),
        activeUsers: active,
        inactiveUsers: total - active,
        verifiedUsers: Number(s.verified),
        usersWithBookings,
        conversionRate: total > 0 ? Number(((usersWithBookings / total) * 100).toFixed(1)) : 0,
      },
      trendData: trendResult.rows.map((row) => ({
        label: formatBucketLabel(row.bucket, truncUnit),
        totalNewUsers: Number(row.total_new_users),
        activeUsers: Number(row.active_users),
        adminUsers: Number(row.admin_users),
      })),
      roleDistribution,
      userStatusDistribution: [
        { name: 'Active', value: active },
        { name: 'Inactive', value: total - active },
      ],
      topRoles: [...roleDistribution].sort((a, b) => b.count - a.count).slice(0, 3),
    },
  });
});

export const getSalesRepPersonalPerformance = asyncHandler(async (req, res) => {
  const repId = req.user.id;
  const { start, end } = resolveTimeRange(req.query.timeRange);

  const [statsResult, recentLeads] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS converted,
        COUNT(*) FILTER (WHERE "lifecycleStatus" NOT IN ('CONFIRMED','CLOSED_LOST','CANCELLED','BOOKING_FAILED')) AS pending
       FROM crm_leads."Lead" WHERE "assignedToId" = $1 AND "createdAt" BETWEEN $2 AND $3`,
      [repId, start, end]
    ),
    pool.query(
      `SELECT id, name, email, "lifecycleStatus"::text AS status, "createdAt" FROM crm_leads."Lead"
       WHERE "assignedToId" = $1 AND "createdAt" BETWEEN $2 AND $3 ORDER BY "createdAt" DESC LIMIT 10`,
      [repId, start, end]
    ),
  ]);

  const s = statsResult.rows[0];
  const leadsAssigned = Number(s.total);
  const converted = Number(s.converted);

  res.json({
    success: true,
    data: {
      performance: {
        leadsAssigned,
        converted,
        pending: Number(s.pending),
        conversionRate: leadsAssigned > 0 ? Number(((converted / leadsAssigned) * 100).toFixed(1)) : 0,
      },
      recentLeads: recentLeads.rows,
    },
  });
});

export const getAllSalesRepsPerformance = asyncHandler(async (req, res) => {
  const { start, end } = resolveTimeRange(req.query.timeRange);

  const result = await pool.query(
    `SELECT u.name AS rep,
      COUNT(l.id) FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS sales,
      ROUND(COUNT(l.id) FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED')::numeric / NULLIF(COUNT(l.id), 0) * 100, 1) AS conversion
     FROM crm_users."User" u
     LEFT JOIN crm_leads."Lead" l ON l."assignedToId" = u.id AND l."createdAt" BETWEEN $1 AND $2
     WHERE u.role = 'salesRep'
     GROUP BY u.id, u.name
     ORDER BY sales DESC`,
    [start, end]
  );

  res.json({
    success: true,
    data: result.rows.map((r) => ({ rep: r.rep, sales: Number(r.sales), conversion: Number(r.conversion) || 0 })),
  });
});

export const getWebsiteAnalyticsOverview = asyncHandler(async (req, res) => {
  const { start, end, truncUnit } = resolveTimeRange(req.query.timeRange);
  // "Website" leads = inquiries that came in through the public site.
  // Note: LeadPlatform's Postgres enum label is "Website Form" (with a
  // space) per its @map in schema.prisma — Website_Form is only the
  // Prisma-side JS identifier, not a valid value of the DB enum type.
  const sourceFilter = `(source = 'website' OR platform = 'Website Form')`;

  const [statsResult, activityResult, trendResult, destinationResult, packagePerfResult] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*) AS total_searches,
        COUNT(DISTINCT COALESCE(destination, "destinationCountry")) AS unique_destinations,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS total_bookings
       FROM crm_leads."Lead" WHERE ${sourceFilter} AND "createdAt" BETWEEN $1 AND $2`,
      [start, end]
    ),
    // No "activity" entity exists anywhere in the schema — best-effort proxy
    // using the distinct Package categories as a stand-in for "activities".
    pool.query(`SELECT category::text AS name, COUNT(*) AS value FROM crm_packages."Package" GROUP BY category`),
    pool.query(
      `SELECT DATE_TRUNC($3, "createdAt") AS bucket,
        COUNT(*) AS searches,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS conversions
       FROM crm_leads."Lead" WHERE ${sourceFilter} AND "createdAt" BETWEEN $1 AND $2
       GROUP BY bucket ORDER BY bucket ASC`,
      [start, end, truncUnit]
    ),
    pool.query(
      `SELECT COALESCE(destination, "destinationCountry", 'Unknown') AS destination,
        COUNT(*) AS searches,
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS conversions
       FROM crm_leads."Lead" WHERE ${sourceFilter} AND "createdAt" BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY searches DESC LIMIT 10`,
      [start, end]
    ),
    pool.query(
      `SELECT p."duration_days" AS "durationDays", p."base_price" AS "basePrice", COUNT(DISTINCT lps."leadId") AS searches,
        COUNT(DISTINCT lps."leadId") FILTER (WHERE l."lifecycleStatus" = 'CONFIRMED') AS bookings
       FROM crm_leads."LeadPackageSelection" lps
       JOIN crm_leads."Lead" l ON l.id = lps."leadId" AND ${sourceFilter}
       JOIN crm_packages."Package" p ON p.id = lps."packageId"
       WHERE l."createdAt" BETWEEN $1 AND $2
       GROUP BY p.id, p."duration_days", p."base_price"`,
      [start, end]
    ),
  ]);

  const s = statsResult.rows[0];
  const totalSearches = Number(s.total_searches);
  const totalBookings = Number(s.total_bookings);

  const durationCounts = new Map();
  const priceCounts = new Map();
  for (const row of packagePerfResult.rows) {
    const searches = Number(row.searches);
    const bookings = Number(row.bookings);

    const durationLabel = durationRangeLabel(Number(row.durationDays) || 0);
    const durationEntry = durationCounts.get(durationLabel) || { duration: durationLabel, searches: 0, bookings: 0 };
    durationEntry.searches += searches;
    durationEntry.bookings += bookings;
    durationCounts.set(durationLabel, durationEntry);

    const priceLabel = priceRangeLabel(Number(row.basePrice) || 0);
    priceCounts.set(priceLabel, (priceCounts.get(priceLabel) || 0) + searches);
  }

  res.json({
    success: true,
    data: {
      stats: {
        totalSearches,
        totalBookings,
        uniqueDestinations: Number(s.unique_destinations),
        uniqueActivities: activityResult.rows.length,
        conversionRate: totalSearches > 0 ? Number(((totalBookings / totalSearches) * 100).toFixed(1)) : 0,
      },
      trend: trendResult.rows.map((row) => ({
        label: formatBucketLabel(row.bucket, truncUnit),
        searches: Number(row.searches),
        conversions: Number(row.conversions),
      })),
      topDestinations: destinationResult.rows.map((r) => ({
        destination: r.destination,
        searches: Number(r.searches),
        conversions: Number(r.conversions),
      })),
      accommodationTypes: activityResult.rows.map((r) => ({ name: r.name, value: Number(r.value) })),
      durationPreferences: Array.from(durationCounts.values()),
      priceRanges: Array.from(priceCounts, ([range, searches]) => ({ range, searches })),
    },
  });
});

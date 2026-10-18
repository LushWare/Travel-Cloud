import pool from '../db/pool.js';
import asyncHandler from '../utils/asyncHandler.js';

// Quotations and invoices carry a currency. Bookings do not, so booking-sourced
// amounts are reported in this currency without conversion.
export const REPORTING_CURRENCY = process.env.BUSINESS_REPORTING_CURRENCY || 'USD';
export const ID_SET_CAP = 100;
const PACKAGE_RECOMMENDATION_ID_CAP = 50;

const LEAD_OWNER_PREDICATE = `(
  $2::text IS NULL OR "leadId" IN (
    SELECT id FROM crm_leads."Lead" WHERE "assignedToId" = $2
  )
)`;

const numberOf = (value) => Number(value) || 0;
const rounded = (value, digits = 1) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : 0;
};
const percentOf = (part, total) => numberOf(total) > 0 ? rounded((numberOf(part) / numberOf(total)) * 100) : null;
const idsOf = (value) => (Array.isArray(value) ? value.filter(Boolean).slice(0, ID_SET_CAP) : []);
const dateOf = (value) => (value ? new Date(value).toISOString() : null);
const firstRow = (result) => result.rows[0] ?? {};
const zeroSignal = () => ({ rows: [{ count: '0', value: '0', ids: [] }] });

/**
 * Business-wide, role-scoped source readings for the Management notification
 * layer. This endpoint states only measured facts. Assistant-service owns the
 * materiality gates, prose, notification lifecycle, and ordering.
 */
export const getBusinessSignals = asyncHandler(async (req, res) => {
  const now = new Date();
  const repId = req.user.role === 'salesRep' ? req.user.id : null;
  const params = [now, repId, REPORTING_CURRENCY];
  // Each query is handed only the parameters it actually references: node-pg
  // rejects a statement whose bound-parameter count exceeds its placeholders.
  const [at, owner, currency] = params;
  const orgOnly = repId === null;

  const [
    unconvertedResult,
    coldLeadsResult,
    departureResult,
    conversionResult,
    lostQuotesResult,
    lapsedCustomersResult,
    lowMarginResult,
    responseTimeResult,
    concentrationResult,
    agingResult,
    unassignedResult,
    stalledResult,
    expiringResult,
    noDepositResult,
    voucherMissingResult,
    cancellationResult,
    silentPackagesResult,
    quotedSilenceResult,
    partialAgingResult,
    flightsNeedingReviewResult,
    hotelsNeedingReviewResult,
    packagePerformanceResult,
    leadOverviewResult,
    packageOverviewResult,
    flightOverviewResult,
    hotelOverviewResult,
    websiteOverviewResult,
    userOverviewResult,
    careerOverviewResult,
    bookingOverviewResult,
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM("totalAmount"), 0) AS value,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - "sentAt")))::int, 0) AS "oldestAgeDays",
         COALESCE((ARRAY_AGG(id ORDER BY "sentAt" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_billing."Quotation"
       WHERE status IN ('sent', 'viewed')
         AND "sentAt" BETWEEN $1::timestamptz - interval '30 days' AND $1
         AND currency = $3
         AND ${LEAD_OWNER_PREDICATE}`,
      params,
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(pricing."sellSubtotal"), 0) AS value,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - l."updatedAt")))::int, 0) AS "oldestAgeDays",
         COALESCE((ARRAY_AGG(l.id ORDER BY pricing."sellSubtotal" DESC NULLS LAST))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_leads."Lead" l
       LEFT JOIN LATERAL (
         SELECT lp."sellSubtotal"
         FROM crm_leads."LeadPackageSelection" selection
         JOIN crm_leads."LeadPricing" lp ON lp."leadPackageSelectionId" = selection.id
         WHERE selection."leadId" = l.id
         ORDER BY lp."sellSubtotal" DESC
         LIMIT 1
       ) pricing ON true
       WHERE l."lifecycleStatus" NOT IN ('CONFIRMED', 'CLOSED_LOST', 'BOOKING_FAILED', 'CANCELLED')
         AND l."assignedToId" IS NOT NULL
         AND l."updatedAt" <= $1::timestamptz - interval '7 days'
         AND COALESCE(pricing."sellSubtotal", 0) >= 2000
         AND ($2::text IS NULL OR l."assignedToId" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(i."outstandingAmount"), 0) AS value,
         MIN(b."travelDate") AS "nearestDeparture",
         COALESCE((ARRAY_AGG(i.id ORDER BY b."travelDate" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_bookings."Booking" b
       JOIN crm_billing."Invoice" i ON i."bookingId" = b.id
       WHERE b."bookingStatus" = 'confirmed'
         AND b."travelDate" BETWEEN $1 AND $1::timestamptz + interval '14 days'
         AND i."outstandingAmount" > 0
         AND i.currency = $3
         AND ($2::text IS NULL OR b."assignedToId" = $2)`,
      params,
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE "createdAt" > $1::timestamptz - interval '30 days') AS "curTotal",
         COUNT(*) FILTER (WHERE "createdAt" > $1::timestamptz - interval '30 days' AND "lifecycleStatus" = 'CONFIRMED') AS "curWon",
         COUNT(*) FILTER (WHERE "createdAt" BETWEEN $1::timestamptz - interval '60 days' AND $1::timestamptz - interval '30 days') AS "prevTotal",
         COUNT(*) FILTER (WHERE "createdAt" BETWEEN $1::timestamptz - interval '60 days' AND $1::timestamptz - interval '30 days' AND "lifecycleStatus" = 'CONFIRMED') AS "prevWon"
       FROM crm_leads."Lead"
       WHERE ($2::text IS NULL OR "assignedToId" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM("totalAmount"), 0) AS value,
         COUNT(*) FILTER (WHERE "rejectedAt" IS NOT NULL) AS "rejectedWithReason",
         MODE() WITHIN GROUP (ORDER BY "rejectionReason") FILTER (WHERE "rejectionReason" IS NOT NULL) AS "topReason",
         COALESCE((ARRAY_AGG(id ORDER BY COALESCE("rejectedAt", "expiresAt", "createdAt") DESC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_billing."Quotation"
       WHERE status IN ('rejected', 'expired')
         AND "createdAt" >= date_trunc('month', $1::timestamptz)
         AND currency = $3
         AND ${LEAD_OWNER_PREDICATE}`,
      params,
    ),
    orgOnly
      ? pool.query(
          `SELECT
             COUNT(DISTINCT b."userId") AS count,
             MAX(b."travelDate") AS "lastTripDate",
             COALESCE((ARRAY_AGG(DISTINCT i."leadId"))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
           FROM crm_bookings."Booking" b
           JOIN crm_billing."Invoice" i ON i."bookingId" = b.id
           WHERE b."bookingStatus" IN ('confirmed', 'completed')
             AND b."travelDate" BETWEEN $1::timestamptz - interval '13 months' AND $1::timestamptz - interval '11 months'
             AND NOT EXISTS (
               SELECT 1
               FROM crm_bookings."Booking" recent
               WHERE recent."userId" = b."userId"
                 AND recent."travelDate" >= $1::timestamptz - interval '11 months'
                 AND recent."bookingStatus" IN ('confirmed', 'completed')
             )`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(i."totalAmount"), 0) AS value,
         COALESCE(ROUND(AVG(margin.value)::numeric, 1), 0) AS "avgMargin",
         COALESCE((ARRAY_AGG(DISTINCT i."leadId"))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_bookings."Booking" b
       JOIN crm_billing."Invoice" i ON i."bookingId" = b.id
       JOIN LATERAL (
         SELECT CASE
           WHEN lp."marginType" = 'PERCENTAGE' THEN lp."marginValue"::numeric
           WHEN lp."marginValue" IS NOT NULL AND COALESCE(lp."sellSubtotal", 0) > 0
             THEN (lp."marginValue" / lp."sellSubtotal") * 100
           ELSE NULL
         END AS value
         FROM crm_leads."LeadPackageSelection" selection
         JOIN crm_leads."LeadPricing" lp ON lp."leadPackageSelectionId" = selection.id
         WHERE selection."leadId" = i."leadId"
         ORDER BY lp."updatedAt" DESC
         LIMIT 1
       ) margin ON margin.value IS NOT NULL
       WHERE margin.value < 5
         AND b."bookingStatus" = 'confirmed'
         AND b."confirmedAt" >= date_trunc('month', $1::timestamptz)
         AND i.currency = $3
         AND ($2::text IS NULL OR b."assignedToId" = $2)`,
      params,
    ),
    orgOnly
      ? pool.query(
          `SELECT
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (q."sentAt" - l."leadDateTime")) / 3600
             ) FILTER (WHERE q."sentAt" > $1::timestamptz - interval '7 days') AS "curHours",
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (q."sentAt" - l."leadDateTime")) / 3600
             ) FILTER (WHERE q."sentAt" BETWEEN $1::timestamptz - interval '35 days' AND $1::timestamptz - interval '7 days') AS "prevHours",
             COUNT(*) FILTER (WHERE q."sentAt" > $1::timestamptz - interval '7 days') AS "curN",
             COUNT(*) FILTER (WHERE q."sentAt" BETWEEN $1::timestamptz - interval '35 days' AND $1::timestamptz - interval '7 days') AS "prevN"
           FROM crm_leads."Lead" l
           JOIN crm_billing."Quotation" q ON q."leadId" = l.id
           WHERE q."sentAt" > $1::timestamptz - interval '35 days'
             AND q."sentAt" >= l."leadDateTime"`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    orgOnly
      ? pool.query(
          // $2 is the reporting currency here, not the owner: this statement has
          // no owner predicate, and Postgres cannot infer the type of a bound
          // parameter the statement never references.
          `WITH current_revenue AS (
             SELECT COALESCE(destination, 'Unknown') AS destination, SUM("paidAmount") AS revenue
             FROM crm_billing."Invoice"
             WHERE "paidAmount" > 0
               AND currency = $2
               AND "createdAt" >= date_trunc('month', $1::timestamptz)
             GROUP BY 1
           ),
           current_total AS (
             SELECT COALESCE(SUM(revenue), 0) AS total FROM current_revenue
           ),
           baseline_revenue AS (
             SELECT COALESCE(destination, 'Unknown') AS destination, SUM("paidAmount") AS revenue
             FROM crm_billing."Invoice"
             WHERE "paidAmount" > 0
               AND currency = $2
               AND "createdAt" >= date_trunc('month', $1::timestamptz) - interval '6 months'
               AND "createdAt" < date_trunc('month', $1::timestamptz)
             GROUP BY 1
           ),
           baseline_total AS (
             SELECT COALESCE(SUM(revenue), 0) AS total FROM baseline_revenue
           )
           SELECT
             current.destination,
             current.revenue AS value,
             COALESCE(ROUND(current.revenue::numeric / NULLIF(current_total.total::numeric, 0) * 100, 1), 0) AS share,
             COALESCE(ROUND(COALESCE(baseline.revenue, 0)::numeric / NULLIF(baseline_total.total::numeric, 0) * 100, 1), 0) AS baseline
           FROM current_revenue current
           CROSS JOIN current_total
           CROSS JOIN baseline_total
           LEFT JOIN baseline_revenue baseline ON baseline.destination = current.destination
           ORDER BY share DESC, current.destination ASC
           LIMIT 1`,
          [at, currency],
        )
      : Promise.resolve(zeroSignal()),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM("outstandingAmount"), 0) AS value,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - "dueDate")))::int, 0) AS "oldestDays",
         COALESCE((ARRAY_AGG(id ORDER BY "dueDate" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_billing."Invoice"
       WHERE "outstandingAmount" > 0
         AND "dueDate" < $1
         AND status NOT IN ('cancelled', 'refunded')
         AND currency = $3
         AND ${LEAD_OWNER_PREDICATE}`,
      params,
    ),
    orgOnly
      ? pool.query(
          `SELECT
             COUNT(*) AS count,
             MIN("createdAt") AS "oldestCreatedAt",
             COALESCE((ARRAY_AGG(id ORDER BY "createdAt" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
           FROM crm_leads."Lead"
           WHERE "assignedToId" IS NULL
             AND "lifecycleStatus" = 'NEW'
             AND "createdAt" <= $1::timestamptz - interval '4 hours'`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - "updatedAt")))::int, 0) AS "oldestAgeDays",
         COALESCE((ARRAY_AGG(id ORDER BY "updatedAt" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_leads."Lead"
       WHERE "lifecycleStatus" = 'DRAFTING'
         AND "updatedAt" <= $1::timestamptz - interval '7 days'
         AND ($2::text IS NULL OR "assignedToId" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM("totalAmount"), 0) AS value,
         MIN("validUntil") AS "earliestExpiry",
         COALESCE((ARRAY_AGG(id ORDER BY "validUntil" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_billing."Quotation"
       WHERE status IN ('sent', 'viewed')
         AND "validUntil" BETWEEN $1 AND $1::timestamptz + interval '5 days'
         AND currency = $3
         AND ${LEAD_OWNER_PREDICATE}`,
      params,
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(i."outstandingAmount"), 0) AS value,
         COALESCE((ARRAY_AGG(i.id ORDER BY b."travelDate" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_bookings."Booking" b
       JOIN crm_billing."Invoice" i ON i."bookingId" = b.id
       WHERE b."bookingStatus" = 'confirmed'
         AND b."travelDate" BETWEEN $1 AND $1::timestamptz + interval '30 days'
         AND i."paidAmount" = 0
         AND i.currency = $3
         AND ($2::text IS NULL OR b."assignedToId" = $2)`,
      params,
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE((ARRAY_AGG(DISTINCT i."leadId"))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_bookings."Booking" b
       JOIN crm_billing."Invoice" i ON i."bookingId" = b.id
       WHERE b."bookingStatus" = 'confirmed'
         AND b."travelDate" BETWEEN $1 AND $1::timestamptz + interval '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM crm_billing."Voucher" voucher WHERE voucher."leadId" = i."leadId"
         )
         AND ($2::text IS NULL OR b."assignedToId" = $2)`,
      [at, owner],
    ),
    orgOnly
      ? pool.query(
          `WITH monthly AS (
             SELECT DATE_TRUNC('month', "cancelledAt") AS month, COUNT(*)::numeric AS count
             FROM crm_bookings."Booking"
             WHERE "cancelledAt" >= date_trunc('month', $1::timestamptz) - interval '3 months'
               AND "cancelledAt" < date_trunc('month', $1::timestamptz) + interval '1 month'
             GROUP BY 1
           )
           SELECT
             COALESCE(SUM(count) FILTER (WHERE month = date_trunc('month', $1::timestamptz)), 0) AS cur,
             COALESCE(SUM(count) FILTER (WHERE month < date_trunc('month', $1::timestamptz)) / 3, 0) AS baseline
           FROM monthly`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    orgOnly
      ? pool.query(
          `SELECT COUNT(*) AS count,
             COALESCE((ARRAY_AGG(package.id ORDER BY package."createdAt" DESC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
           FROM crm_packages."Package" package
           WHERE package.is_active = true
             AND NOT EXISTS (
               SELECT 1
               FROM crm_leads."LeadPackageSelection" selection
               WHERE selection."packageId" = package.id
                 AND selection."createdAt" >= $1::timestamptz - interval '30 days'
             )`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - l."updatedAt")))::int, 0) AS "oldestAgeDays",
         COALESCE((ARRAY_AGG(l.id ORDER BY l."updatedAt" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_leads."Lead" l
       WHERE l."lifecycleStatus" = 'QUOTED'
         AND l."updatedAt" <= $1::timestamptz - interval '7 days'
         AND NOT EXISTS (
           SELECT 1
           FROM crm_leads."LeadCommunicationLog" communication
           WHERE communication."leadId" = l.id
             AND communication."date" >= $1::timestamptz - interval '7 days'
         )
         AND ($2::text IS NULL OR l."assignedToId" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM("outstandingAmount"), 0) AS value,
         COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - "dueDate")))::int, 0) AS "oldestDays",
         COALESCE((ARRAY_AGG(id ORDER BY "dueDate" ASC))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM crm_billing."Invoice"
       WHERE "paymentStatus" = 'partial'
         AND "dueDate" <= $1::timestamptz - interval '14 days'
         AND "outstandingAmount" > 0
         AND currency = $3
         AND ${LEAD_OWNER_PREDICATE}`,
      params,
    ),
    pool.query(
      `WITH candidates AS (
         SELECT flight.id, MIN(segment."departureAt") AS "nearestDeparture"
         FROM crm_flights."FlightBooking" flight
         JOIN crm_flights."FlightSegment" segment ON segment."flightBookingId" = flight.id
         WHERE flight.status IN ('pending', 'failed')
           AND segment."departureAt" BETWEEN $1 AND $1::timestamptz + interval '7 days'
           AND ($2::text IS NULL OR flight."createdById" = $2)
         GROUP BY flight.id
       )
       SELECT COUNT(*) AS count,
         MIN("nearestDeparture") AS "nearestDeparture",
         COALESCE((ARRAY_AGG(id ORDER BY "nearestDeparture"))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM candidates`,
      [at, owner],
    ),
    pool.query(
      `WITH candidates AS (
         SELECT hotel.id, hotel.checkin
         FROM crm_packages."HotelBooking" hotel
         WHERE hotel.status IN ('pending', 'failed')
           AND hotel.checkin BETWEEN $1 AND $1::timestamptz + interval '7 days'
           AND ($2::text IS NULL OR hotel."createdById" = $2)
       )
       SELECT COUNT(*) AS count,
         MIN(checkin) AS "nearestCheckin",
         COALESCE((ARRAY_AGG(id ORDER BY checkin))[1:${ID_SET_CAP}], ARRAY[]::text[]) AS ids
       FROM candidates`,
      [at, owner],
    ),
    pool.query(
      `WITH inquiry_metrics AS (
         SELECT selection."packageId",
           COUNT(DISTINCT lead.id) AS inquiries,
           COUNT(DISTINCT lead.id) FILTER (WHERE lead."lifecycleStatus" = 'CONFIRMED') AS conversions
         FROM crm_leads."LeadPackageSelection" selection
         JOIN crm_leads."Lead" lead ON lead.id = selection."leadId"
         WHERE selection."packageId" IS NOT NULL
           AND lead."createdAt" >= $1::timestamptz - interval '90 days'
           AND ($2::text IS NULL OR lead."assignedToId" = $2)
         GROUP BY selection."packageId"
       ), package_metrics AS (
         SELECT package.id, package.rating, package.num_reviews AS reviews,
           package.views, package.bookings,
           COALESCE(inquiries.inquiries, 0) AS inquiries,
           COALESCE(inquiries.conversions, 0) AS conversions,
           CASE WHEN COALESCE(inquiries.inquiries, 0) > 0
             THEN COALESCE(inquiries.conversions, 0)::numeric / inquiries.inquiries
             ELSE NULL
           END AS conversion_rate
         FROM crm_packages."Package" package
         LEFT JOIN inquiry_metrics inquiries ON inquiries."packageId" = package.id
         WHERE package.is_active = true
           AND package."createdAt" <= $1::timestamptz - interval '14 days'
       ), benchmarks AS (
         SELECT
           percentile_cont(0.5) WITHIN GROUP (ORDER BY bookings) AS booking_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS views_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY inquiries) AS inquiry_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY reviews) AS review_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY conversion_rate)
             FILTER (WHERE inquiries >= 3) AS conversion_median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rating)
             FILTER (WHERE reviews >= 3) AS rating_median,
           COUNT(*) FILTER (WHERE inquiries >= 3) AS qualified_conversion_packages,
           COUNT(*) FILTER (WHERE reviews >= 3) AS qualified_rating_packages
         FROM package_metrics
       )
       SELECT
         COUNT(*) FILTER (WHERE metrics.bookings < benchmarks.booking_median AND benchmarks.booking_median > 0) AS "lowBookingsCount",
         COALESCE(ROUND((AVG(metrics.bookings) FILTER (WHERE metrics.bookings < benchmarks.booking_median AND benchmarks.booking_median > 0))::numeric, 1), 0) AS "lowBookingsAverage",
         COALESCE(ROUND(benchmarks.booking_median::numeric, 1), 0) AS "bookingBenchmark",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.bookings ASC) FILTER (WHERE metrics.bookings < benchmarks.booking_median AND benchmarks.booking_median > 0))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowBookingIds",
         COUNT(*) FILTER (WHERE metrics.views < benchmarks.views_median AND benchmarks.views_median > 0) AS "lowViewsCount",
         COALESCE(ROUND((AVG(metrics.views) FILTER (WHERE metrics.views < benchmarks.views_median AND benchmarks.views_median > 0))::numeric, 1), 0) AS "lowViewsAverage",
         COALESCE(ROUND(benchmarks.views_median::numeric, 1), 0) AS "viewsBenchmark",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.views ASC) FILTER (WHERE metrics.views < benchmarks.views_median AND benchmarks.views_median > 0))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowViewIds",
         COUNT(*) FILTER (WHERE metrics.inquiries < benchmarks.inquiry_median AND benchmarks.inquiry_median > 0) AS "lowInquiriesCount",
         COALESCE(ROUND((AVG(metrics.inquiries) FILTER (WHERE metrics.inquiries < benchmarks.inquiry_median AND benchmarks.inquiry_median > 0))::numeric, 1), 0) AS "lowInquiriesAverage",
         COALESCE(ROUND(benchmarks.inquiry_median::numeric, 1), 0) AS "inquiryBenchmark",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.inquiries ASC) FILTER (WHERE metrics.inquiries < benchmarks.inquiry_median AND benchmarks.inquiry_median > 0))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowInquiryIds",
         COUNT(*) FILTER (WHERE metrics.conversion_rate < benchmarks.conversion_median AND benchmarks.conversion_median > 0 AND metrics.inquiries >= 3) AS "lowConversionsCount",
         COALESCE(ROUND((AVG(metrics.conversion_rate) FILTER (WHERE metrics.conversion_rate < benchmarks.conversion_median AND benchmarks.conversion_median > 0 AND metrics.inquiries >= 3) * 100)::numeric, 1), 0) AS "lowConversionsAverage",
         COALESCE(ROUND((benchmarks.conversion_median * 100)::numeric, 1), 0) AS "conversionBenchmark",
         benchmarks.qualified_conversion_packages AS "qualifiedConversionPackages",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.conversion_rate ASC) FILTER (WHERE metrics.conversion_rate < benchmarks.conversion_median AND benchmarks.conversion_median > 0 AND metrics.inquiries >= 3))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowConversionIds",
         COUNT(*) FILTER (WHERE metrics.inquiries >= 3 AND metrics.conversions = 0) AS "noConversionCount",
         COALESCE(ROUND((AVG(metrics.inquiries) FILTER (WHERE metrics.inquiries >= 3 AND metrics.conversions = 0))::numeric, 1), 0) AS "noConversionAverageInquiries",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.inquiries DESC) FILTER (WHERE metrics.inquiries >= 3 AND metrics.conversions = 0))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "noConversionIds",
         COUNT(*) FILTER (WHERE metrics.rating < benchmarks.rating_median AND benchmarks.rating_median IS NOT NULL AND metrics.reviews >= 3) AS "lowRatingsCount",
         COALESCE(ROUND((AVG(metrics.rating) FILTER (WHERE metrics.rating < benchmarks.rating_median AND benchmarks.rating_median IS NOT NULL AND metrics.reviews >= 3))::numeric, 1), 0) AS "lowRatingsAverage",
         COALESCE(ROUND(benchmarks.rating_median::numeric, 1), 0) AS "ratingBenchmark",
         benchmarks.qualified_rating_packages AS "qualifiedRatingPackages",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.rating ASC) FILTER (WHERE metrics.rating < benchmarks.rating_median AND benchmarks.rating_median IS NOT NULL AND metrics.reviews >= 3))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowRatingIds",
         COUNT(*) FILTER (WHERE metrics.reviews < benchmarks.review_median AND benchmarks.review_median > 0) AS "lowReviewsCount",
         COALESCE(ROUND((AVG(metrics.reviews) FILTER (WHERE metrics.reviews < benchmarks.review_median AND benchmarks.review_median > 0))::numeric, 1), 0) AS "lowReviewsAverage",
         COALESCE(ROUND(benchmarks.review_median::numeric, 1), 0) AS "reviewBenchmark",
         COALESCE((ARRAY_AGG(metrics.id ORDER BY metrics.reviews ASC) FILTER (WHERE metrics.reviews < benchmarks.review_median AND benchmarks.review_median > 0))[1:${PACKAGE_RECOMMENDATION_ID_CAP}], ARRAY[]::text[]) AS "lowReviewIds"
       FROM package_metrics metrics
       CROSS JOIN benchmarks
      GROUP BY benchmarks.booking_median, benchmarks.views_median, benchmarks.inquiry_median, benchmarks.review_median,
         benchmarks.conversion_median, benchmarks.rating_median,
         benchmarks.qualified_conversion_packages, benchmarks.qualified_rating_packages`,
      [at, owner],
    ),
    pool.query(
      `SELECT COUNT(*) AS "totalLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'NEW') AS "newLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'DRAFTING') AS "draftingLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'QUOTED') AS "quotedLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'REVISION') AS "revisionLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'APPROVED') AS "approvedLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'BOOKING_IN_PROGRESS') AS "bookingInProgressLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS "confirmedLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CLOSED_LOST') AS "closedLostLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'BOOKING_FAILED') AS "bookingFailedLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CANCELLED') AS "cancelledLeads"
       FROM crm_leads."Lead"
       WHERE "createdAt" BETWEEN $1::timestamptz - interval '90 days' AND $1
         AND ($2::text IS NULL OR "assignedToId" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE is_active = true) AS "activePackages",
        COUNT(*) FILTER (WHERE is_active = false) AS "inactivePackages",
        COALESCE(SUM(views), 0) AS "catalogViews",
        COALESCE(SUM(bookings), 0) AS "recordedBookings",
        COALESCE(ROUND((AVG(rating) FILTER (WHERE is_active = true))::numeric, 1), 0) AS "averageActiveRating",
        COALESCE(SUM(num_reviews) FILTER (WHERE is_active = true), 0) AS "activePackageReviews",
         (SELECT COUNT(DISTINCT selection."leadId")
            FROM crm_leads."LeadPackageSelection" selection
            JOIN crm_leads."Lead" lead ON lead.id = selection."leadId"
           WHERE selection."packageId" IS NOT NULL
             AND lead."createdAt" BETWEEN $1::timestamptz - interval '90 days' AND $1
             AND ($2::text IS NULL OR lead."assignedToId" = $2)) AS "packageInquiries90Days",
         (SELECT COUNT(DISTINCT lead.id) FILTER (WHERE lead."lifecycleStatus" = 'CONFIRMED')
            FROM crm_leads."LeadPackageSelection" selection
            JOIN crm_leads."Lead" lead ON lead.id = selection."leadId"
           WHERE selection."packageId" IS NOT NULL
             AND lead."createdAt" BETWEEN $1::timestamptz - interval '90 days' AND $1
             AND ($2::text IS NULL OR lead."assignedToId" = $2)) AS "packageConversions90Days"
       FROM crm_packages."Package"
       WHERE "createdAt" <= $1`,
      [at, owner],
    ),
    pool.query(
      `SELECT COUNT(*) AS "totalFlightBookings",
        COUNT(*) FILTER (WHERE status = 'pending') AS "pendingFlights",
        COUNT(*) FILTER (WHERE status = 'confirmed') AS "confirmedFlights",
        COUNT(*) FILTER (WHERE status = 'failed') AS "failedFlights",
        COUNT(*) FILTER (WHERE status = 'cancelled') AS "cancelledFlights",
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM crm_flights."FlightSegment" segment
           WHERE segment."flightBookingId" = flight.id
             AND segment."departureAt" BETWEEN $1 AND $1::timestamptz + interval '30 days'
         )) AS "departuresWithin30Days"
       FROM crm_flights."FlightBooking" flight
       WHERE flight."createdAt" <= $1
         AND ($2::text IS NULL OR flight."createdById" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT COUNT(*) AS "totalHotelBookings",
        COUNT(*) FILTER (WHERE status = 'pending') AS "pendingHotels",
        COUNT(*) FILTER (WHERE status = 'confirmed') AS "confirmedHotels",
        COUNT(*) FILTER (WHERE status = 'failed') AS "failedHotels",
        COUNT(*) FILTER (WHERE status = 'cancelled') AS "cancelledHotels",
        COUNT(*) FILTER (WHERE checkin BETWEEN $1 AND $1::timestamptz + interval '30 days') AS "checkinsWithin30Days",
        COUNT(*) FILTER (WHERE status = 'pending' AND checkin BETWEEN $1 AND $1::timestamptz + interval '30 days') AS "pendingCheckins30Days",
        COUNT(*) FILTER (WHERE status = 'failed' AND checkin BETWEEN $1 AND $1::timestamptz + interval '30 days') AS "failedCheckins30Days",
        COALESCE(
          (ARRAY_AGG(id ORDER BY checkin ASC) FILTER (WHERE status IN ('pending', 'failed')))[1:${ID_SET_CAP}],
          ARRAY[]::text[]
        ) AS "unresolvedIds"
       FROM crm_packages."HotelBooking"
       WHERE "createdAt" <= $1
         AND ($2::text IS NULL OR "createdById" = $2)`,
      [at, owner],
    ),
    pool.query(
      `SELECT COUNT(*) AS "websiteLeads",
        COUNT(*) FILTER (WHERE "lifecycleStatus" = 'CONFIRMED') AS "confirmedWebsiteLeads",
        COUNT(DISTINCT COALESCE(destination, "destinationCountry")) AS "uniqueWebsiteDestinations"
       FROM crm_leads."Lead"
       WHERE (source = 'website' OR platform = 'Website Form')
         AND "createdAt" BETWEEN $1::timestamptz - interval '30 days' AND $1
         AND ($2::text IS NULL OR "assignedToId" = $2)`,
      [at, owner],
    ),
    orgOnly
      ? pool.query(
           `SELECT COUNT(*) AS "totalUsers",
             COUNT(*) FILTER (WHERE "isActive" = true) AS "activeUsers",
             COUNT(*) FILTER (WHERE "isEmailVerified" = true) AS "verifiedUsers",
             COUNT(*) FILTER (WHERE "isEmailVerified" = false) AS "unverifiedUsers",
             COUNT(*) FILTER (WHERE "createdAt" >= $1::timestamptz - interval '30 days') AS "newUsers30Days",
             COUNT(*) FILTER (WHERE role = 'customer') AS "customerUsers",
             COUNT(*) FILTER (WHERE role = 'customer' AND "isEmailVerified" = false) AS "unverifiedCustomers",
             COALESCE(
               (ARRAY_AGG(id ORDER BY "createdAt" DESC) FILTER (WHERE role = 'customer' AND "isEmailVerified" = false))[1:${ID_SET_CAP}],
               ARRAY[]::text[]
             ) AS "unverifiedCustomerIds",
             COUNT(*) FILTER (WHERE role = 'salesRep') AS "salesRepUsers",
             COUNT(*) FILTER (WHERE role = 'vendor') AS "vendorUsers"
           FROM crm_users."User"
           WHERE "createdAt" <= $1`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    orgOnly
      ? pool.query(
          `SELECT
             (SELECT COUNT(*) FROM crm_careers."Career") AS "totalApplications",
             (SELECT COUNT(*) FROM crm_careers."Career" WHERE status = 'pending') AS "pendingApplications",
             (SELECT COUNT(*) FROM crm_careers."Career" WHERE status = 'under-review') AS "applicationsUnderReview",
             (SELECT COUNT(*) FROM crm_careers."Career" WHERE status = 'shortlisted') AS "shortlistedApplications",
             (SELECT COUNT(*) FROM crm_careers."Career" WHERE status = 'hired') AS "hiredApplications",
             (SELECT COUNT(*) FROM crm_careers."Career" WHERE status = 'rejected') AS "rejectedApplications",
             (SELECT COALESCE(MAX(EXTRACT(DAY FROM ($1::timestamptz - "createdAt")))::int, 0)
                 FROM crm_careers."Career" WHERE status = 'pending') AS "oldestPendingApplicationDays",
               (SELECT COUNT(*) FROM crm_careers."Vacancy" WHERE status = 'active') AS "activeVacancies",
             (SELECT COUNT(*) FROM crm_careers."Vacancy"
                WHERE status = 'active' AND "closingDate" BETWEEN $1 AND $1::timestamptz + interval '14 days') AS "vacanciesClosing14Days"`,
          [at],
        )
      : Promise.resolve(zeroSignal()),
    pool.query(
      `SELECT COUNT(*) AS "totalBookings",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'pending') AS "pendingBookings",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'confirmed') AS "confirmedBookings",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'completed') AS "completedBookings",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'cancelled') AS "cancelledBookings",
        COUNT(*) FILTER (WHERE "paymentStatus" = 'pending' AND "bookingStatus" = 'confirmed') AS "confirmedBookingsUnpaid",
        COUNT(*) FILTER (WHERE "paymentStatus" = 'partial' AND "bookingStatus" = 'confirmed') AS "confirmedBookingsPartPaid",
        COUNT(*) FILTER (WHERE "paymentStatus" = 'paid' AND "bookingStatus" = 'confirmed') AS "confirmedBookingsPaid",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'confirmed' AND "travelDate" BETWEEN $1 AND $1::timestamptz + interval '30 days') AS "confirmedTravelWithin30Days",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'confirmed' AND "travelDate" < $1) AS "pastTravelStillConfirmed",
        COUNT(*) FILTER (WHERE "bookingStatus" = 'pending' AND "createdAt" <= $1::timestamptz - interval '7 days') AS "pendingBookingsOver7Days"
       FROM crm_bookings."Booking"
       WHERE "createdAt" <= $1
         AND ($2::text IS NULL OR "assignedToId" = $2)`,
      [at, owner],
    ),
  ]);

  const unconverted = firstRow(unconvertedResult);
  const cold = firstRow(coldLeadsResult);
  const departure = firstRow(departureResult);
  const conversion = firstRow(conversionResult);
  const lost = firstRow(lostQuotesResult);
  const lapsed = firstRow(lapsedCustomersResult);
  const lowMargin = firstRow(lowMarginResult);
  const responseTime = firstRow(responseTimeResult);
  const concentration = firstRow(concentrationResult);
  const aging = firstRow(agingResult);
  const unassigned = firstRow(unassignedResult);
  const stalled = firstRow(stalledResult);
  const expiring = firstRow(expiringResult);
  const noDeposit = firstRow(noDepositResult);
  const voucherMissing = firstRow(voucherMissingResult);
  const cancellations = firstRow(cancellationResult);
  const silentPackages = firstRow(silentPackagesResult);
  const quotedSilence = firstRow(quotedSilenceResult);
  const partialAging = firstRow(partialAgingResult);
  const flightsNeedingReview = firstRow(flightsNeedingReviewResult);
  const hotelsNeedingReview = firstRow(hotelsNeedingReviewResult);
  const packagePerformance = firstRow(packagePerformanceResult);
  const leadOverview = firstRow(leadOverviewResult);
  const packageOverview = firstRow(packageOverviewResult);
  const flightOverview = firstRow(flightOverviewResult);
  const hotelOverview = firstRow(hotelOverviewResult);
  const websiteOverview = firstRow(websiteOverviewResult);
  const userOverview = firstRow(userOverviewResult);
  const careerOverview = firstRow(careerOverviewResult);
  const bookingOverview = firstRow(bookingOverviewResult);

  res.json({
    success: true,
    data: {
      asOf: now.toISOString(),
      scope: repId ? 'own' : 'org',
      currency: REPORTING_CURRENCY,
      signals: {
        unconvertedQuotes: {
          count: numberOf(unconverted.count),
          value: numberOf(unconverted.value),
          oldestAgeDays: numberOf(unconverted.oldestAgeDays),
          ids: idsOf(unconverted.ids),
        },
        coldLeads: {
          count: numberOf(cold.count),
          value: numberOf(cold.value),
          oldestAgeDays: numberOf(cold.oldestAgeDays),
          ids: idsOf(cold.ids),
        },
        departuresOutstanding: {
          count: numberOf(departure.count),
          value: numberOf(departure.value),
          nearestDeparture: dateOf(departure.nearestDeparture),
          ids: idsOf(departure.ids),
        },
        conversionTrend: {
          curTotal: numberOf(conversion.curTotal),
          curWon: numberOf(conversion.curWon),
          curWinRatePct: percentOf(conversion.curWon, conversion.curTotal),
          prevTotal: numberOf(conversion.prevTotal),
          prevWon: numberOf(conversion.prevWon),
          prevWinRatePct: percentOf(conversion.prevWon, conversion.prevTotal),
          winRateChangePp: percentOf(conversion.curWon, conversion.curTotal) === null || percentOf(conversion.prevWon, conversion.prevTotal) === null
            ? null
            : rounded(percentOf(conversion.curWon, conversion.curTotal) - percentOf(conversion.prevWon, conversion.prevTotal)),
        },
        lostQuotes: {
          count: numberOf(lost.count),
          value: numberOf(lost.value),
          rejectedWithReason: numberOf(lost.rejectedWithReason),
          topReason: lost.topReason || null,
          ids: idsOf(lost.ids),
        },
        lapsedCustomers: {
          count: numberOf(lapsed.count),
          lastTripDate: dateOf(lapsed.lastTripDate),
          ids: idsOf(lapsed.ids),
        },
        lowMarginBookings: {
          count: numberOf(lowMargin.count),
          value: numberOf(lowMargin.value),
          avgMargin: rounded(lowMargin.avgMargin),
          ids: idsOf(lowMargin.ids),
        },
        responseTimeTrend: {
          curHours: rounded(responseTime.curHours),
          prevHours: rounded(responseTime.prevHours),
          curN: numberOf(responseTime.curN),
          prevN: numberOf(responseTime.prevN),
        },
        destinationConcentration: {
          destination: concentration.destination || null,
          share: rounded(concentration.share),
          baseline: rounded(concentration.baseline),
          value: numberOf(concentration.value),
        },
        agingOverdue: {
          count: numberOf(aging.count),
          value: numberOf(aging.value),
          oldestDays: numberOf(aging.oldestDays),
          ids: idsOf(aging.ids),
        },
        unassignedLeads: {
          count: numberOf(unassigned.count),
          oldestCreatedAt: dateOf(unassigned.oldestCreatedAt),
          ids: idsOf(unassigned.ids),
        },
        stalledDrafting: {
          count: numberOf(stalled.count),
          oldestAgeDays: numberOf(stalled.oldestAgeDays),
          ids: idsOf(stalled.ids),
        },
        expiringQuotes: {
          count: numberOf(expiring.count),
          value: numberOf(expiring.value),
          earliestExpiry: dateOf(expiring.earliestExpiry),
          ids: idsOf(expiring.ids),
        },
        noDeposit: {
          count: numberOf(noDeposit.count),
          value: numberOf(noDeposit.value),
          ids: idsOf(noDeposit.ids),
        },
        voucherMissing: {
          count: numberOf(voucherMissing.count),
          ids: idsOf(voucherMissing.ids),
        },
        cancellationSpike: {
          cur: numberOf(cancellations.cur),
          baseline: rounded(cancellations.baseline),
        },
        silentPackages: {
          count: numberOf(silentPackages.count),
          ids: idsOf(silentPackages.ids),
        },
        quotedSilence: {
          count: numberOf(quotedSilence.count),
          oldestAgeDays: numberOf(quotedSilence.oldestAgeDays),
          ids: idsOf(quotedSilence.ids),
        },
        partialAging: {
          count: numberOf(partialAging.count),
          value: numberOf(partialAging.value),
          oldestDays: numberOf(partialAging.oldestDays),
          ids: idsOf(partialAging.ids),
        },
        flightsNeedingReview: {
          count: numberOf(flightsNeedingReview.count),
          nearestDeparture: dateOf(flightsNeedingReview.nearestDeparture),
          ids: idsOf(flightsNeedingReview.ids),
        },
        hotelsNeedingReview: {
          count: numberOf(hotelsNeedingReview.count),
          nearestCheckin: dateOf(hotelsNeedingReview.nearestCheckin),
          ids: idsOf(hotelsNeedingReview.ids),
        },
        packagesLowBookings: {
          count: numberOf(packagePerformance.lowBookingsCount),
          averageRecordedBookings: numberOf(packagePerformance.lowBookingsAverage),
          benchmarkRecordedBookings: numberOf(packagePerformance.bookingBenchmark),
          ids: idsOf(packagePerformance.lowBookingIds),
        },
        packagesLowViews: {
          count: numberOf(packagePerformance.lowViewsCount),
          averageRecordedViews: numberOf(packagePerformance.lowViewsAverage),
          benchmarkRecordedViews: numberOf(packagePerformance.viewsBenchmark),
          ids: idsOf(packagePerformance.lowViewIds),
        },
        packagesLowInquiries: {
          count: numberOf(packagePerformance.lowInquiriesCount),
          averageInquiries90Days: numberOf(packagePerformance.lowInquiriesAverage),
          benchmarkInquiries90Days: numberOf(packagePerformance.inquiryBenchmark),
          ids: idsOf(packagePerformance.lowInquiryIds),
        },
        packagesLowConversions: {
          count: numberOf(packagePerformance.lowConversionsCount),
          averageConversionRate90Days: numberOf(packagePerformance.lowConversionsAverage),
          benchmarkConversionRate90Days: numberOf(packagePerformance.conversionBenchmark),
          qualifiedPackages: numberOf(packagePerformance.qualifiedConversionPackages),
          ids: idsOf(packagePerformance.lowConversionIds),
        },
        packagesNoConversions: {
          count: numberOf(packagePerformance.noConversionCount),
          averageInquiries90Days: numberOf(packagePerformance.noConversionAverageInquiries),
          qualifiedPackages: numberOf(packagePerformance.qualifiedConversionPackages),
          ids: idsOf(packagePerformance.noConversionIds),
        },
        packagesLowRating: {
          count: numberOf(packagePerformance.lowRatingsCount),
          averageRating: numberOf(packagePerformance.lowRatingsAverage),
          benchmarkRating: numberOf(packagePerformance.ratingBenchmark),
          qualifiedPackages: numberOf(packagePerformance.qualifiedRatingPackages),
          ids: idsOf(packagePerformance.lowRatingIds),
        },
        packagesLowReviews: {
          count: numberOf(packagePerformance.lowReviewsCount),
          averageReviews: numberOf(packagePerformance.lowReviewsAverage),
          benchmarkReviews: numberOf(packagePerformance.reviewBenchmark),
          ids: idsOf(packagePerformance.lowReviewIds),
        },
        leadOverview: {
          totalLeads: numberOf(leadOverview.totalLeads),
          newLeads: numberOf(leadOverview.newLeads),
          draftingLeads: numberOf(leadOverview.draftingLeads),
          quotedLeads: numberOf(leadOverview.quotedLeads),
          revisionLeads: numberOf(leadOverview.revisionLeads),
          approvedLeads: numberOf(leadOverview.approvedLeads),
          bookingInProgressLeads: numberOf(leadOverview.bookingInProgressLeads),
          confirmedLeads: numberOf(leadOverview.confirmedLeads),
          closedLostLeads: numberOf(leadOverview.closedLostLeads),
          bookingFailedLeads: numberOf(leadOverview.bookingFailedLeads),
          cancelledLeads: numberOf(leadOverview.cancelledLeads),
        },
        packageOverview: {
          activePackages: numberOf(packageOverview.activePackages),
          inactivePackages: numberOf(packageOverview.inactivePackages),
          catalogViews: numberOf(packageOverview.catalogViews),
          recordedBookings: numberOf(packageOverview.recordedBookings),
          averageActiveRating: rounded(packageOverview.averageActiveRating),
          activePackageReviews: numberOf(packageOverview.activePackageReviews),
          packageInquiries90Days: numberOf(packageOverview.packageInquiries90Days),
          packageConversions90Days: numberOf(packageOverview.packageConversions90Days),
        },
        flightOverview: {
          totalFlightBookings: numberOf(flightOverview.totalFlightBookings),
          pendingFlights: numberOf(flightOverview.pendingFlights),
          confirmedFlights: numberOf(flightOverview.confirmedFlights),
          failedFlights: numberOf(flightOverview.failedFlights),
          cancelledFlights: numberOf(flightOverview.cancelledFlights),
          departuresWithin30Days: numberOf(flightOverview.departuresWithin30Days),
        },
        hotelOverview: {
          totalHotelBookings: numberOf(hotelOverview.totalHotelBookings),
          pendingHotels: numberOf(hotelOverview.pendingHotels),
          pendingRatePct: percentOf(hotelOverview.pendingHotels, hotelOverview.totalHotelBookings),
          confirmedHotels: numberOf(hotelOverview.confirmedHotels),
          failedHotels: numberOf(hotelOverview.failedHotels),
          failedRatePct: percentOf(hotelOverview.failedHotels, hotelOverview.totalHotelBookings),
          cancelledHotels: numberOf(hotelOverview.cancelledHotels),
          checkinsWithin30Days: numberOf(hotelOverview.checkinsWithin30Days),
          pendingCheckins30Days: numberOf(hotelOverview.pendingCheckins30Days),
          failedCheckins30Days: numberOf(hotelOverview.failedCheckins30Days),
          unresolvedCheckinRate30DaysPct: percentOf(
            numberOf(hotelOverview.pendingCheckins30Days) + numberOf(hotelOverview.failedCheckins30Days),
            hotelOverview.checkinsWithin30Days,
          ),
          ids: idsOf(hotelOverview.unresolvedIds),
        },
        websiteOverview: {
          websiteLeads: numberOf(websiteOverview.websiteLeads),
          confirmedWebsiteLeads: numberOf(websiteOverview.confirmedWebsiteLeads),
          uniqueWebsiteDestinations: numberOf(websiteOverview.uniqueWebsiteDestinations),
        },
        userOverview: orgOnly ? {
          totalUsers: numberOf(userOverview.totalUsers),
          activeUsers: numberOf(userOverview.activeUsers),
          activeRatePct: percentOf(userOverview.activeUsers, userOverview.totalUsers),
          verifiedUsers: numberOf(userOverview.verifiedUsers),
          unverifiedUsers: numberOf(userOverview.unverifiedUsers),
          unverifiedRatePct: percentOf(userOverview.unverifiedUsers, userOverview.totalUsers),
          newUsers30Days: numberOf(userOverview.newUsers30Days),
          customerUsers: numberOf(userOverview.customerUsers),
          salesRepUsers: numberOf(userOverview.salesRepUsers),
          vendorUsers: numberOf(userOverview.vendorUsers),
        } : null,
        unverifiedCustomerAccounts: orgOnly ? {
          count: numberOf(userOverview.unverifiedCustomers),
          ratePct: percentOf(userOverview.unverifiedCustomers, userOverview.customerUsers),
          ids: idsOf(userOverview.unverifiedCustomerIds),
        } : null,
        careerOverview: orgOnly ? {
          totalApplications: numberOf(careerOverview.totalApplications),
          pendingApplications: numberOf(careerOverview.pendingApplications),
          applicationsUnderReview: numberOf(careerOverview.applicationsUnderReview),
          shortlistedApplications: numberOf(careerOverview.shortlistedApplications),
          hiredApplications: numberOf(careerOverview.hiredApplications),
          rejectedApplications: numberOf(careerOverview.rejectedApplications),
          oldestPendingApplicationDays: numberOf(careerOverview.oldestPendingApplicationDays),
          activeVacancies: numberOf(careerOverview.activeVacancies),
          vacanciesClosing14Days: numberOf(careerOverview.vacanciesClosing14Days),
        } : null,
        bookingOverview: {
          totalBookings: numberOf(bookingOverview.totalBookings),
          pendingBookings: numberOf(bookingOverview.pendingBookings),
          pendingRatePct: percentOf(bookingOverview.pendingBookings, bookingOverview.totalBookings),
          confirmedBookings: numberOf(bookingOverview.confirmedBookings),
          completedBookings: numberOf(bookingOverview.completedBookings),
          cancelledBookings: numberOf(bookingOverview.cancelledBookings),
          confirmedBookingsUnpaid: numberOf(bookingOverview.confirmedBookingsUnpaid),
          confirmedUnpaidRatePct: percentOf(bookingOverview.confirmedBookingsUnpaid, bookingOverview.confirmedBookings),
          confirmedBookingsPartPaid: numberOf(bookingOverview.confirmedBookingsPartPaid),
          confirmedPartPaidRatePct: percentOf(bookingOverview.confirmedBookingsPartPaid, bookingOverview.confirmedBookings),
          confirmedBookingsPaid: numberOf(bookingOverview.confirmedBookingsPaid),
          confirmedTravelWithin30Days: numberOf(bookingOverview.confirmedTravelWithin30Days),
          pastTravelStillConfirmed: numberOf(bookingOverview.pastTravelStillConfirmed),
          pendingBookingsOver7Days: numberOf(bookingOverview.pendingBookingsOver7Days),
        },
      },
    },
  });
});

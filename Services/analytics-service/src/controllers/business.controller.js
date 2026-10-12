import pool from '../db/pool.js';
import asyncHandler from '../utils/asyncHandler.js';

// Quotations and invoices carry a currency. Bookings do not, so booking-sourced
// amounts are reported in this currency without conversion.
export const REPORTING_CURRENCY = process.env.BUSINESS_REPORTING_CURRENCY || 'USD';
export const ID_SET_CAP = 100;

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
         WHERE flight.status IN ('quoted', 'pending', 'confirmed')
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
          prevTotal: numberOf(conversion.prevTotal),
          prevWon: numberOf(conversion.prevWon),
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
      },
    },
  });
});

/**
 * Demo-scoped reset.
 *
 * Deletes ONLY rows this seed owns. Ownership is proved by the id, which is
 * deterministic and category-prefixed (see lib/ids.mjs): a row whose id starts
 * with the demo prefix for its category cannot have come from the older seeds,
 * from the package editor, or from another session's work.
 *
 * The one deliberate exception is the itinerary of the seven pre-existing
 * packages: those day rows carry the original seed's ids, so they are removed
 * by *package scope* rather than by id, and immediately re-written by
 * domains/packages.mjs. The package rows themselves are never touched.
 *
 * Master dictionaries (Place, Activity_Catalog) are shared across every
 * package in the database and are reused by upsert on their unique name, so
 * they are never deleted here.
 */
import { CATEGORIES } from './ids.mjs';
import { EXISTING_PACKAGE_ITINERARIES } from './destinations.mjs';

/**
 * LIKE patterns for the share of the uuid space this seed owns, across every test agency:
 * '1a00000_-' matches lush-demo's '1a000000-', acme-tours' '1a000001-' and globe-dmc's '1a000002-'.
 */
export const DEMO_ID_PREFIXES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([name, cat]) => [name, `${cat}00000_-`]),
);

const likePrefix = (category) => `${DEMO_ID_PREFIXES[category]}%`;

/**
 * Ordered deletions. Intra-schema foreign keys are the only hard constraint
 * (cross-schema refs are plain strings), so children precede parents within a
 * schema; schema order is arbitrary but kept stable for readable logs.
 */
const STATEMENTS = [
  // ── crm_assistant (no FKs) ────────────────────────────────────────────────
  // AssistantMessage ids are `${sessionId}-m${seq}`, so they carry the session
  // prefix — matching on the message prefix alone would leave every message
  // behind and orphan its session.
  ['crm_assistant', `DELETE FROM crm_assistant."AssistantMessage" WHERE id LIKE $1`, likePrefix('assistantSession')],
  ['crm_assistant', `DELETE FROM crm_assistant."AssistantEvent"    WHERE id LIKE $1`, likePrefix('assistantEvent')],
  ['crm_assistant', `DELETE FROM crm_assistant."InsightDecision"   WHERE id LIKE $1`, likePrefix('insightDecision')],
  ['crm_assistant', `DELETE FROM crm_assistant."InsightState"      WHERE id LIKE $1`, likePrefix('insightState')],
  ['crm_assistant', `DELETE FROM crm_assistant."ManagementLastSeen" WHERE id LIKE $1`, likePrefix('managementLastSeen')],
  ['crm_assistant', `DELETE FROM crm_assistant."AssistantSession"  WHERE id LIKE $1`, likePrefix('assistantSession')],

  // ── crm_flights ───────────────────────────────────────────────────────────
  ['crm_flights', `DELETE FROM crm_flights."FlightBooking" WHERE id LIKE $1`, likePrefix('flightBooking')],

  // ── crm_packages ──────────────────────────────────────────────────────────
  [
    'crm_packages',
    `DELETE FROM crm_packages."Package_Day_Transport" WHERE "itineraryDayId" IN (
       SELECT id FROM crm_packages."Itinerary_Day" WHERE "packageId" LIKE $1 OR "packageId" IN (${EXISTING_PACKAGE_ITINERARIES.map((p) => `'${p.id}'`).join(',')})
     )`,
    likePrefix('package'),
  ],
  [
    'crm_packages',
    `DELETE FROM crm_packages."Package_Day_Place" WHERE "itineraryDayId" IN (
       SELECT id FROM crm_packages."Itinerary_Day" WHERE "packageId" LIKE $1 OR "packageId" IN (${EXISTING_PACKAGE_ITINERARIES.map((p) => `'${p.id}'`).join(',')})
     )`,
    likePrefix('package'),
  ],
  [
    'crm_packages',
    `DELETE FROM crm_packages."Package_Day_Activity" WHERE "itineraryDayId" IN (
       SELECT id FROM crm_packages."Itinerary_Day" WHERE "packageId" LIKE $1 OR "packageId" IN (${EXISTING_PACKAGE_ITINERARIES.map((p) => `'${p.id}'`).join(',')})
     )`,
    likePrefix('package'),
  ],
  [
    'crm_packages',
    `DELETE FROM crm_packages."Review" WHERE "packageId" LIKE $1 OR "packageId" IN (${EXISTING_PACKAGE_ITINERARIES.map((p) => `'${p.id}'`).join(',')})`,
    likePrefix('package'),
  ],
  [
    'crm_packages',
    `DELETE FROM crm_packages."Itinerary_Day" WHERE "packageId" LIKE $1 OR "packageId" IN (${EXISTING_PACKAGE_ITINERARIES.map((p) => `'${p.id}'`).join(',')})`,
    likePrefix('package'),
  ],
  ['crm_packages', `DELETE FROM crm_packages."Package_Image" WHERE id LIKE $1`, likePrefix('packageImage')],
  ['crm_packages', `DELETE FROM crm_packages."HotelBooking"   WHERE id LIKE $1`, likePrefix('hotelBooking')],
  ['crm_packages', `DELETE FROM crm_packages."Package"        WHERE id LIKE $1`, likePrefix('package')],

  // ── crm_bookings ──────────────────────────────────────────────────────────
  ['crm_bookings', `DELETE FROM crm_bookings."Booking" WHERE id LIKE $1`, likePrefix('booking')],

  // ── crm_billing (children before parents) ────────────────────────────────
  ['crm_billing', `DELETE FROM crm_billing."PaymentHistory"     WHERE id LIKE $1`, likePrefix('paymentHistory')],
  ['crm_billing', `DELETE FROM crm_billing."PaymentReceipt"     WHERE id LIKE $1`, likePrefix('receipt')],
  ['crm_billing', `DELETE FROM crm_billing."CreditNoteItem"     WHERE id LIKE $1`, likePrefix('creditNoteItem')],
  ['crm_billing', `DELETE FROM crm_billing."CreditNote"         WHERE id LIKE $1`, likePrefix('creditNote')],
  ['crm_billing', `DELETE FROM crm_billing."InvoiceItem"        WHERE id LIKE $1`, likePrefix('invoiceItem')],
  ['crm_billing', `DELETE FROM crm_billing."Invoice"            WHERE id LIKE $1`, likePrefix('invoice')],
  ['crm_billing', `DELETE FROM crm_billing."VoucherFlightSegment"    WHERE id LIKE $1`, likePrefix('voucherFlightSegment')],
  ['crm_billing', `DELETE FROM crm_billing."VoucherMealPlan"         WHERE id LIKE $1`, likePrefix('voucherMealPlan')],
  ['crm_billing', `DELETE FROM crm_billing."VoucherLocationDate"     WHERE id LIKE $1`, likePrefix('voucherLocationDate')],
  ['crm_billing', `DELETE FROM crm_billing."VoucherItinerarySummary" WHERE id LIKE $1`, likePrefix('voucherItinerarySummary')],
  ['crm_billing', `DELETE FROM crm_billing."Voucher"            WHERE id LIKE $1`, likePrefix('voucher')],
  ['crm_billing', `DELETE FROM crm_billing."QuotationItem"      WHERE id LIKE $1`, likePrefix('quotationItem')],
  ['crm_billing', `DELETE FROM crm_billing."QuotationImage"     WHERE id LIKE $1`, likePrefix('quotationImage')],
  ['crm_billing', `DELETE FROM crm_billing."QuotationRevision"  WHERE id LIKE $1`, likePrefix('quotationRevision')],
  ['crm_billing', `DELETE FROM crm_billing."Quotation"          WHERE id LIKE $1`, likePrefix('quotation')],

  // ── crm_leads ─────────────────────────────────────────────────────────────
  // Children are deleted by their own prefix before the Lead. Deleting a Lead
  // cascades, but this step also enriches pre-existing leads the older seeds
  // left thin, and those children hang off a selection this seed does not own —
  // so the cascade never reaches them and they must be named explicitly.
  ['crm_leads', `DELETE FROM crm_leads."LeadDayPlace"     WHERE id LIKE $1`, likePrefix('leadDayPlace')],
  ['crm_leads', `DELETE FROM crm_leads."LeadDayActivity"  WHERE id LIKE $1`, likePrefix('leadDayActivity')],
  ['crm_leads', `DELETE FROM crm_leads."LeadDayImage"     WHERE id LIKE $1`, likePrefix('leadDayImage')],
  ['crm_leads', `DELETE FROM crm_leads."LeadDayTransport" WHERE id LIKE $1`, likePrefix('leadDayTransport')],
  ['crm_leads', `DELETE FROM crm_leads."LeadItineraryDay" WHERE id LIKE $1`, likePrefix('leadItineraryDay')],
  ['crm_leads', `DELETE FROM crm_leads."LeadCostLine"     WHERE id LIKE $1`, likePrefix('costLine')],
  ['crm_leads', `DELETE FROM crm_leads."LeadPricing"      WHERE id LIKE $1`, likePrefix('pricing')],
  ['crm_leads', `DELETE FROM crm_leads."LeadOptionalFlight" WHERE id LIKE $1`, likePrefix('optionalFlight')],
  ['crm_leads', `DELETE FROM crm_leads."LeadRemark"          WHERE id LIKE $1`, likePrefix('remark')],
  ['crm_leads', `DELETE FROM crm_leads."LeadStatusHistory"   WHERE id LIKE $1`, likePrefix('statusHistory')],
  ['crm_leads', `DELETE FROM crm_leads."LeadCommunicationLog" WHERE id LIKE $1`, likePrefix('commLog')],
  ['crm_leads', `DELETE FROM crm_leads."LeadInternalEvent"   WHERE id LIKE $1`, likePrefix('internalEvent')],
  ['crm_leads', `DELETE FROM crm_leads."CustomizedPackage"   WHERE id LIKE $1`, likePrefix('customizedPackage')],
  ['crm_leads', `DELETE FROM crm_leads."ManualItinerary"     WHERE id LIKE $1`, likePrefix('manualItinerary')],
  ['crm_leads', `DELETE FROM crm_leads."LeadPackageSelection" WHERE id LIKE $1`, likePrefix('selection')],
  // Lead last: it owns the only cascade that can reach anything left above.
  ['crm_leads', `DELETE FROM crm_leads."Lead" WHERE id LIKE $1`, likePrefix('lead')],

  // ── crm_careers ───────────────────────────────────────────────────────────
  ['crm_careers', `DELETE FROM crm_careers."Vacancy" WHERE id LIKE $1`, likePrefix('vacancy')],
  ['crm_careers', `DELETE FROM crm_careers."Career"  WHERE id LIKE $1`, likePrefix('career')],

  // ── crm_auth ──────────────────────────────────────────────────────────────
  ['crm_auth', `DELETE FROM crm_auth."Otp" WHERE id LIKE $1`, likePrefix('otp')],

  // ── crm_users (profiles before users; settings row is updated, not deleted) ─
  ['crm_users', `DELETE FROM crm_users."VendorProfile"  WHERE id LIKE $1`, likePrefix('vendorProfile')],
  ['crm_users', `DELETE FROM crm_users."PolicyDocument" WHERE id LIKE $1`, likePrefix('policyDoc')],
  ['crm_users', `DELETE FROM crm_users."User"           WHERE id LIKE $1`, likePrefix('user')],
];

export async function resetDemoData(db, { dryRun = false, log = console.log } = {}) {
  const total = { rows: 0 };
  const rows = [];

  // A dry run executes the real statements and rolls them back. Counting with a
  // generated SELECT instead is what made an earlier version of this script
  // delete data it had promised only to report: the rewrite silently failed on
  // any statement whose table carried an alias, leaving the DELETE in place.
  await db.sql.query('BEGIN');
  try {
    for (const [schema, statement, prefix] of STATEMENTS) {
      // One parameter per statement. The itinerary-day statements are scoped by
      // their package rather than by their own id, so their single $1 is the
      // package prefix instead of their category prefix.
      const res = await db.sql.query(statement, [prefix]);
      const n = res.rowCount ?? 0;
      if (n) rows.push([schema, n, statement.match(/"(?:[A-Za-z_]+)"/)?.[0] ?? '']);
      total.rows += n;
    }
  } catch (err) {
    await db.sql.query('ROLLBACK').catch(() => {});
    throw err;
  }
  await db.sql.query(dryRun ? 'ROLLBACK' : 'COMMIT');

  if (dryRun) {
    log(`\n  --reset --dry-run — nothing was deleted.`);
    if (!rows.length) {
      log(`  No demo-owned rows found.\n`);
      return total;
    }
    log(`  Would delete ${total.rows} demo-owned row(s):`);
    for (const [schema, n, table] of rows) log(`    ${schema.padEnd(16)} ${String(n).padStart(6)}  ${table}`);
    log('');
    return total;
  }

  log(`  reset        deleted ${total.rows} demo-owned row(s)`);
  return total;
}

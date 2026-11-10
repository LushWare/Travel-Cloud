/**
 * Deterministic, collision-free ids for the demo seed.
 *
 * Shape: <cat><000000>-0000-4000-8000-<12-digit index>
 * Valid UUID v4 *shape* (version nibble 4, variant 8) so any zod `.uuid()`
 * validation on a route accepts an id the seed wrote, while staying readable
 * and — crucially — derivable: `id('lead', 42)` is the same string on every
 * machine and every run, which is what makes the seed idempotent.
 *
 * The two-hex-digit category prefixes are chosen to avoid every id the older
 * seeds already own (a0/b0/c1/c9/d0/e0/e1/f0) and the rows a live editor or
 * the package chatbot mint at runtime (random v4 uuids).
 */

const CATEGORY = {
  user: '1a',
  vendorProfile: '1b',
  policyDoc: '1c',
  orgSettings: '1d',
  package: '1e',
  packageImage: '1f',
  itineraryDay: '20',
  place: '21',
  activity: '22',
  packageDayPlace: '23',
  packageDayActivity: '24',
  packageDayTransport: '25',
  review: '26',
  hotelBooking: '27',
  lead: '2a',
  selection: '2b',
  pricing: '2c',
  costLine: '2d',
  leadItineraryDay: '2e',
  leadDayPlace: '2f',
  leadDayActivity: '30',
  leadDayImage: '31',
  leadDayTransport: '32',
  optionalFlight: '33',
  remark: '34',
  statusHistory: '35',
  commLog: '36',
  internalEvent: '37',
  customizedPackage: '38',
  manualItinerary: '39',
  leadSettings: '3a',
  booking: '3b',
  bookingTraveler: '3c',
  quotation: '3d',
  quotationItem: '3e',
  quotationImage: '3f',
  quotationRevision: '40',
  invoice: '41',
  invoiceItem: '42',
  receipt: '43',
  paymentHistory: '44',
  creditNote: '45',
  creditNoteItem: '46',
  voucher: '47',
  voucherLocationDate: '48',
  voucherMealPlan: '49',
  voucherItinerarySummary: '4a',
  voucherFlightSegment: '4b',
  career: '4c',
  vacancy: '4d',
  flightBooking: '4e',
  flightSegment: '4f',
  flightTraveler: '50',
  assistantSession: '51',
  assistantMessage: '52',
  assistantEvent: '53',
  insightState: '54',
  insightDecision: '55',
  managementLastSeen: '56',
  otp: '57',
};

// Which test agency the rows being written belong to: 0 = lush-demo, 1 = acme-tours, 2 = globe-dmc.
// It is part of every id, so each agency's rows are told apart (and cleared) by prefix alone.
let currentAgency = 0;
export function setAgencyIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index > 9) throw new Error(`agency index out of range: ${index}`);
  currentAgency = index;
}
const agencyPart = (agency) => String(agency).padStart(6, '0');

/** The id prefix one category owns for the current agency, e.g. '3b000001-' for acme-tours bookings. */
export function ownedPrefix(category, agency = currentAgency) {
  const cat = CATEGORY[category];
  if (!cat) throw new Error(`ownedPrefix(): unknown category "${category}"`);
  return `${cat}${agencyPart(agency)}-`;
}

/** `id('lead', 42)` → '2a000000-0000-4000-8000-000000000042' */
export function id(category, n, agency = currentAgency) {
  const cat = CATEGORY[category];
  if (!cat) throw new Error(`id(): unknown category "${category}"`);
  if (!Number.isInteger(n) || n < 1 || n > 999_999_999_999) {
    throw new Error(`id(): index out of range for "${category}": ${n}`);
  }
  return `${cat}${agencyPart(agency)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * A per-category counter so a domain module never has to track its own
 * numbering — `next('invoice')` walks 1, 2, 3… in call order.
 */
export function makeCounters() {
  const counters = new Map();
  return {
    next(category) {
      const n = (counters.get(category) ?? 0) + 1;
      counters.set(category, n);
      return id(category, n);
    },
    /** How many of a category were minted — used by the post-run audit. */
    count(category) {
      return counters.get(category) ?? 0;
    },
    snapshot() {
      return Object.fromEntries(counters);
    },
  };
}

/**
 * Document numbers, matching each service's own `PREFIX-YYYYMM-NNNNN`
 * convention (billing derives theirs in the service layer; the seed writes
 * the same shape so the two are indistinguishable in the UI).
 */
export function documentNumber(prefix, period, n) {
  return `${prefix}-${period}-${String(n).padStart(5, '0')}`;
}

export const CATEGORIES = CATEGORY;

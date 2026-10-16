import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════
//  Reusable fragments
// ═══════════════════════════════════════════════════════════════════

const iataCode = z.string().length(3, 'Must be 3-letter IATA code').regex(/^[A-Z]{3}$/, 'Must be uppercase IATA code');

// Looser than z.string().uuid(): accepts any UUID-shaped string rather than
// enforcing RFC 4122 v1-5 version/variant nibbles. Seed data hand-crafts
// readable IDs (e.g. d0000000-0000-0000-0000-00000000000c) that are valid
// Prisma primary keys — Prisma stores id/foreign-key columns as plain
// strings with no format constraint — but fail the strict v1-5 check.
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const crossServiceId = (message = 'Invalid ID') => z.string().regex(UUID_SHAPE_RE, message);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const duffelOfferId = z.string().regex(/^off_[A-Za-z0-9_-]+$/, 'Invalid Duffel offer ID');

const cabinClass = z.enum(['Economy', 'Premium Economy', 'Business', 'First']);

const tripType = z.enum(['oneWay', 'roundTrip']);

const travelerType = z.enum(['adult', 'child', 'infant']);

const traveler = z.object({
  type: travelerType,
  title: z.enum(['Mr', 'Mrs', 'Ms', 'Miss']).optional(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid passenger email is required'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Passenger phone must use international format'),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  gender: z.enum(['M', 'F']),
  passportNumber: z.string().max(12).nullable().optional(),
  passportExpiry: dateString.nullable().optional(),
  nationality: z.string().length(2, 'Must be 2-letter country code').nullable().optional(),
  frequentFlyerNumber: z.string().nullable().optional(),
  infantPassengerId: z.string().min(1).optional(),
  // Provider (Duffel) passenger id from the offer's passengerIds. Required to
  // book a Duffel offer; stripped here it never reaches createOrder and the
  // order 422s at /passengers/{i}/id.
  passengerId: z.string().min(1).optional(),
});

// ═══════════════════════════════════════════════════════════════════
//  Request schemas
// ═══════════════════════════════════════════════════════════════════

/** POST /flights/search */
export const searchSchema = z.object({
  origin: iataCode,
  destination: iataCode,
  departureDate: dateString,
  returnDate: dateString.optional(),
  adults: z.coerce.number().int().min(1).max(9).default(1),
  children: z.coerce.number().int().min(0).max(9).default(0),
  infants: z.coerce.number().int().min(0).max(4).default(0),
  childAges: z.array(z.coerce.number().int().min(2).max(17)).optional(),
  infantAges: z.array(z.coerce.number().int().min(0).max(1)).optional(),
  cabinClass: cabinClass.default('Economy'),
  tripType: tripType.default('oneWay'),
}).refine(
  (d) => d.origin !== d.destination,
  { message: 'Origin and destination must be different', path: ['destination'] },
).refine(
  (d) => d.childAges === undefined || d.childAges.length === d.children,
  { message: 'Provide an age for each child', path: ['childAges'] },
).refine(
  (d) => d.infantAges === undefined || d.infantAges.length === d.infants,
  { message: 'Provide an age for each infant', path: ['infantAges'] },
);

/** POST /flights/price */
export const priceSchema = z.object({
  offerId: z.string().min(1, 'offerId is required'),
  cardId: z.string().startsWith('tcd_').optional(),
  services: z.array(z.object({
    id: z.string().min(1),
    quantity: z.number().int().min(1).max(9),
  })).default([]),
  expectedTotal: z.number().finite().positive().optional(),
});

export const offerIdParamSchema = z.object({ offerId: duffelOfferId });

/** POST /flights/book */
export const bookSchema = z.object({
  offer: z.object({
    offerId: z.string().min(1, 'offer.offerId is required'),
  }).passthrough(), // allow extra offer fields through
  tripType: tripType.default('oneWay'),
  travelers: z.array(traveler).min(1, 'At least one traveler is required'),
  services: z.array(z.object({
    id: z.string().min(1),
    quantity: z.number().int().min(1).max(9),
  })).default([]),
  expectedTotal: z.number().finite().positive().optional(),
  expectedCurrency: z.string().length(3).regex(/^[A-Z]{3}$/).optional(),
  payment: z.object({
    cardId: z.string().startsWith('tcd_'),
    threeDSecureSessionId: z.string().startsWith('3ds_'),
  }).optional(),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().email('Invalid contact email'),
    phone: z.string().optional(),
  }),
}).superRefine(({ travelers, payment, expectedTotal, expectedCurrency }, ctx) => {
  const adults = travelers.map((traveler, index) => ({ traveler, index }))
    .filter(({ traveler }) => traveler.type === 'adult');
  const infants = travelers.map((traveler, index) => ({ traveler, index }))
    .filter(({ traveler }) => traveler.type === 'infant');
  const assignedInfantIds = new Set();
  const infantPassengerIds = new Set(infants.map(({ traveler }) => traveler.passengerId).filter(Boolean));

  if (infants.length > adults.length) {
    ctx.addIssue({ code: 'custom', path: ['travelers'], message: 'Each infant must travel with a different adult' });
  }

  adults.forEach(({ traveler: adult, index }) => {
    if (!adult.infantPassengerId) return;
    if (!infantPassengerIds.has(adult.infantPassengerId)) {
      ctx.addIssue({ code: 'custom', path: ['travelers', index, 'infantPassengerId'], message: 'The assigned infant must be a traveler on this booking' });
    } else if (assignedInfantIds.has(adult.infantPassengerId)) {
      ctx.addIssue({ code: 'custom', path: ['travelers', index, 'infantPassengerId'], message: 'Each infant must be assigned to only one adult' });
    } else {
      assignedInfantIds.add(adult.infantPassengerId);
    }
  });
  infants.forEach(({ traveler: infant, index }) => {
    if (!infant.passengerId || !assignedInfantIds.has(infant.passengerId)) {
      ctx.addIssue({ code: 'custom', path: ['travelers', index, 'passengerId'], message: 'An infant must be assigned to a responsible adult' });
    }
  });
  if (payment && expectedTotal == null) {
    ctx.addIssue({ code: 'custom', path: ['expectedTotal'], message: 'Checkout total confirmation is required for card payment' });
  }
  if (payment && expectedCurrency == null) {
    ctx.addIssue({ code: 'custom', path: ['expectedCurrency'], message: 'Checkout currency confirmation is required for card payment' });
  }
});

/** POST /flights/bookings/:id/cancel */
export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
  cancellationId: z.string().min(1).max(100).optional(),
});

/** GET /flights/bookings — query params.
 * Paging/sorting stay optional so existing callers that expect the full list
 * keep their current behavior. The copilot opts into a bounded, deadline-first
 * page explicitly. */
export const listBookingsQuerySchema = z.object({
  status: z.enum(['pending', 'confirmed', 'cancelled', 'failed']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.enum(['createdAt', 'ticketingDeadline']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

/** Route params with UUID */
export const bookingIdParamSchema = z.object({
  id: crossServiceId('Invalid booking ID'),
});

/** Route params — leadId */
export const leadIdParamSchema = z.object({
  leadId: crossServiceId('Invalid lead ID'),
});

/** POST /flights/book-for-lead — same as book but with lead context */
export const leadBookSchema = bookSchema.extend({
  leadId: crossServiceId().optional(),
  packageId: crossServiceId().optional(),
  customizedPackageId: crossServiceId().optional(),
  dayNumber: z.coerce.number().int().positive().optional(),
  flightType: z.enum(['itinerary', 'optional']).default('itinerary'),
});

/** PATCH /flights/bookings/:id/link-day */
export const linkDaySchema = z.object({
  leadId: crossServiceId().optional(),
  dayNumber: z.coerce.number().int().positive().optional(),
  flightType: z.enum(['itinerary', 'optional']).optional(),
});

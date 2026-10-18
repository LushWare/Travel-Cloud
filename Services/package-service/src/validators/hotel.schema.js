import { z } from 'zod';

const dateString = z.iso.date();
const childAge = z.number().int().min(0).max(17);

// Looser than z.string().uuid(): accepts any UUID-shaped string rather than
// enforcing RFC 4122 v1-5 version/variant nibbles. Seed data hand-crafts
// readable IDs (e.g. d0000000-0000-0000-0000-00000000000c) that are valid
// Prisma primary keys — Prisma stores id/foreign-key columns as plain
// strings with no format constraint — but fail the strict v1-5 check.
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const crossServiceId = (message = 'Invalid ID') => z.string().regex(UUID_SHAPE_RE, message);

const occupancy = z.object({
  adults: z.number().int().min(1).max(9).default(1),
  children: z.array(childAge).max(9).default([]),
});

/** POST /hotels/search */
export const searchSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radius: z.number().int().min(1000).max(100000).default(10000).optional(),
  checkin: dateString,
  checkout: dateString,
  currency: z.string().length(3).default('USD').optional(),
  guestNationality: z.string().length(2),
  occupancies: z.array(occupancy).min(1).max(4).default([{ adults: 1, children: [] }]),
  limit: z.number().int().min(1).max(5000).default(5000).optional(),
  offset: z.number().int().min(0).default(0).optional(),
  timeout: z.number().int().min(1).max(30).default(6).optional(),
  hotelIds: z.array(z.string().min(1)).min(1).max(50).optional(),
  maxRatesPerHotel: z.number().int().min(1).max(500).optional(),
  hotelName: z.string().trim().min(1).optional(),
  starRating: z.array(z.number().min(1).max(5).multipleOf(0.5)).max(10).optional(),
  minRating: z.number().min(0).max(5).optional(),
  minReviewsCount: z.number().int().min(0).optional(),
  hotelTypeIds: z.array(z.number().int().positive()).max(100).optional(),
  chainIds: z.array(z.number().int().positive()).max(100).optional(),
  facilities: z.array(z.number().int().positive()).max(100).optional(),
  strictFacilityFiltering: z.boolean().optional(),
  refundableRatesOnly: z.boolean().optional(),
  boardType: z.enum(['RO', 'BI', 'HB', 'FB', 'AI', 'DI', 'LI', 'BDI', 'BLI', 'LDI']).optional(),
  sort: z.array(z.object({
    field: z.enum(['top_picks', 'price', 'revenue']),
    direction: z.enum(['ascending', 'descending']).optional(),
  })).max(3).optional(),
  city: z.string().trim().min(1).optional(),
  country: z.string().length(2).optional(),
  iataCode: z.string().length(3).optional(),
}).superRefine((search, context) => {
  if (search.checkout <= search.checkin) {
    context.addIssue({ code: 'custom', path: ['checkout'], message: 'Check-out must be after check-in.' });
  }
  if (Boolean(search.city) !== Boolean(search.country)) {
    context.addIssue({ code: 'custom', path: ['city'], message: 'City and country must be provided together.' });
  }
  if ((search.latitude == null) !== (search.longitude == null)) {
    context.addIssue({ code: 'custom', path: ['longitude'], message: 'Latitude and longitude must be provided together.' });
  }
  const locationMethods = [
    Boolean(search.city && search.country),
    search.latitude != null && search.longitude != null,
    Boolean(search.iataCode),
    Boolean(search.hotelIds?.length),
  ].filter(Boolean).length;
  if (locationMethods !== 1) {
    context.addIssue({ code: 'custom', path: ['city'], message: 'Provide exactly one hotel search location.' });
  }
});

/** POST /hotels/details — body or query */
export const detailsSchema = z.object({
  hotelId: z.string().min(1, 'hotelId is required'),
});

export const reviewsSchema = z.object({
  hotelId: z.string().min(1, 'hotelId is required'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  getSentiment: z.boolean().default(false),
});

/** POST /hotels/prebook */
export const prebookSchema = z.object({
  offerId: z.string().min(1, 'offerId is required'),
  usePaymentSdk: z.boolean().optional(),
  voucherCode: z.string().trim().min(1).max(100).optional(),
  addons: z.array(z.union([
    z.object({
      addon: z.literal('uber'),
      value: z.number().int().min(10).max(100).multipleOf(10),
      currency: z.literal('USD'),
    }),
    z.object({
      addon: z.literal('esimply'),
      value: z.number().positive(),
      currency: z.literal('USD'),
      addonDetails: z.object({
        package_id: z.number().int().positive(),
        destination_code: z.string().length(2),
        start_date: dateString,
        end_date: dateString,
      }),
    }),
  ])).max(2).optional(),
});

export const countryCodeParamSchema = z.object({ countryCode: z.string().length(2) });

/** POST /hotels/book */
export const bookSchema = z.object({
  prebookId: z.string().min(1, 'prebookId is required'),
  clientReference: z.string().uuid().optional(),
  holder: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
  }).optional(),
  payment: z.object({
    method: z.literal('TRANSACTION_ID'),
    transactionId: z.string().min(1),
  }).optional(),
  guests: z.array(z.object({
    occupancyNumber: z.number().int().positive(),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid guest email').optional(),
    phone: z.string().optional(),
    remarks: z.string().max(500).optional(),
  })).min(1, 'At least one guest is required'),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().email('Invalid contact email'),
    phone: z.string().min(1, 'Contact phone is required'),
  }),
  offer: z.object({}).passthrough().optional(),
}).superRefine((booking, context) => {
  const occupancyNumbers = booking.guests.map((guest) => guest.occupancyNumber);
  if (new Set(occupancyNumbers).size !== occupancyNumbers.length) {
    context.addIssue({ code: 'custom', path: ['guests'], message: 'Each room must have one primary guest.' });
  }
});

/** POST /hotels/bookings/:id/cancel */
export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

/** GET /hotels/bookings — query.
 * Paging/sorting stay optional for backward compatibility; the copilot opts
 * into a bounded, deadline-first page. */
export const listBookingsQuerySchema = z.object({
  status: z.enum(['confirmed', 'pending', 'cancelled', 'failed']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.enum(['createdAt', 'checkin']).optional(),
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

/** POST /hotels/book-with-context — same as book but with lead context */
export const bookWithContextSchema = bookSchema.extend({
  leadId: crossServiceId().optional(),
  packageId: crossServiceId().optional(),
  customizedPackageId: crossServiceId().optional(),
  dayNumber: z.coerce.number().int().positive().optional(),
});

export const cityListQuerySchema = z.object({
  countryCode: z.string().length(2),
});
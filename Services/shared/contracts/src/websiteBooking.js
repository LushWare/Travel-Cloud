import { z } from 'zod';
import { moneyField } from './money.js';

// Confirmed against BookingModal.tsx's actual submitted payload
// (PackageDetailsContainer.test.tsx) and booking-service's
// createWebsiteBooking controller: `name` is optional client- and
// server-side (backend defaults to 'Website Traveler' when absent) — do
// not tighten it back to required without re-checking both sides.
export const WebsiteBookingRequest = z.object({
  packageId: z.string(),
  name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  travelers: z.number().int().min(1).optional(),
  travelDate: z.string().optional(),
  endDate: z.string().optional(),
  message: z.string().optional(),
});

export const WebsiteBookingResult = z
  .object({
    bookingId: z.string().optional(),
  })
  .passthrough();

// Mirrors booking-service's getUserBookings raw-SQL rows (the signed-in
// traveller's own bookings, Services/booking-service/src/controllers/booking.controller.js)
// — flat, with package fields prefixed `package*`. There is no nested `package`
// object on the wire. packageMarginType/etc. never survive
// withPackageSellPrice() (replaced by packagePrice).
export const UserBooking = z
  .object({
    id: z.string().optional(),
    userId: z.string().optional(),
    packageId: z.string().optional(),
    travelDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    numberOfTravelers: z.number().optional(),
    totalAmount: moneyField.optional(),
    paidAmount: moneyField.optional(),
    paymentStatus: z.string().optional(),
    bookingStatus: z.string().optional(),
    specialRequests: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    packageName: z.string().nullable().optional(),
    packageDestination: z.string().nullable().optional(),
    packageDuration: z.number().nullable().optional(),
    packageCoverImage: z.string().nullable().optional(),
    packageSlug: z.string().nullable().optional(),
    packagePrice: moneyField.nullable().optional(),
  })
  .passthrough();

// The public GET /bookings/recent row (website "Recently booked" slider). Anonymous visitors
// read it, so it carries only package details and when it was booked — never the traveller,
// amounts or payment state. Unknown keys are dropped rather than passed through.
export const RecentBooking = z.object({
  id: z.string(),
  packageId: z.string().nullable(),
  packageName: z.string().nullable(),
  packageDestination: z.string().nullable(),
  packageDuration: z.number().nullable(),
  packageCoverImage: z.string().nullable(),
  packageSlug: z.string().nullable(),
  packagePrice: moneyField.nullable(),
  numberOfTravelers: z.number().nullable(),
  createdAt: z.string(),
});

// Fields that must never appear on a public recent-booking row.
export const RECENT_BOOKING_PRIVATE_FIELDS = Object.freeze([
  'userId', 'userName', 'userEmail', 'totalAmount', 'paidAmount', 'paymentStatus',
  'bookingStatus', 'specialRequests', 'travelDate', 'endDate', 'confirmedAt',
]);

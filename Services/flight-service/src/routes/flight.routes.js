import { Router } from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import { injectFlightClient } from '../middleware/flightClient.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  searchSchema, priceSchema, bookSchema, offerIdParamSchema,
  cancelBookingSchema, listBookingsQuerySchema, bookingIdParamSchema, emptyBodySchema,
} from '../validators/flight.schema.js';
import {
  search, price, getCheckoutData, book, listBookings, getBooking, cancelBooking, createLinksSession,
  createCancellationQuote, acknowledgeAirlineChange,
} from '../controllers/flight.controller.js';
import { FLIGHT_AUTHORISED_ROLES } from '../constants/roles.js';

const router = Router();

router.use(requireAuth, authorize(...FLIGHT_AUTHORISED_ROLES), injectFlightClient);

// ── Search & Book ─────────────────────────────────────────────────
router.post('/search', validateBody(searchSchema), search);
router.post('/price', validateBody(priceSchema), price);
router.get('/offers/:offerId/checkout', validateParams(offerIdParamSchema), getCheckoutData);
router.post('/book', validateBody(bookSchema), book);
router.post('/links/session', createLinksSession);

// ── Booking management ────────────────────────────────────────────
router.get('/bookings', validateQuery(listBookingsQuerySchema), listBookings);
router.get('/bookings/:id', validateParams(bookingIdParamSchema), getBooking);
router.post('/bookings/:id/cancellation-quote', validateParams(bookingIdParamSchema), validateBody(cancelBookingSchema), createCancellationQuote);
router.post('/bookings/:id/cancel', validateParams(bookingIdParamSchema), validateBody(cancelBookingSchema), cancelBooking);
router.post('/bookings/:id/airline-change/seen', validateParams(bookingIdParamSchema), validateBody(emptyBodySchema), acknowledgeAirlineChange);

export default router;

import { Router } from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import { injectFlightClient } from '../middleware/flightClient.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  leadBookSchema, linkDaySchema, leadIdParamSchema, bookingIdParamSchema,
} from '../validators/flight.schema.js';
import {
  bookForLead, getByLead, getItineraryFlights, getOptionalFlights, linkToDay,
} from '../controllers/leadFlight.controller.js';
import { FLIGHT_AUTHORISED_ROLES } from '../constants/roles.js';

const router = Router();

router.use(requireAuth, authorize(...FLIGHT_AUTHORISED_ROLES), injectFlightClient);

// ── Book for lead ───────────────────────────────────────────────────
router.post('/book-for-lead', validateBody(leadBookSchema), bookForLead);

// ── Lead-scoped queries ─────────────────────────────────────────────
router.get(
  '/bookings/by-lead/:leadId/itinerary-flights',
  validateParams(leadIdParamSchema),
  getItineraryFlights,
);

router.get(
  '/bookings/by-lead/:leadId/optional-flights',
  validateParams(leadIdParamSchema),
  getOptionalFlights,
);

router.get(
  '/bookings/by-lead/:leadId',
  validateParams(leadIdParamSchema),
  getByLead,
);

// ── Retroactive link ────────────────────────────────────────────────
router.patch(
  '/bookings/:id/link-day',
  validateParams(bookingIdParamSchema),
  validateBody(linkDaySchema),
  linkToDay,
);

export default router;

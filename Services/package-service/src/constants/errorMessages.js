// ── Hotel Search ─────────────────────────────────────────────────
export const SEARCH_CHECKIN_CHECKOUT = 'checkin and checkout are required';
export const SEARCH_COORDINATES_OR_LOCATION = 'Provide coordinates (lat/lng), city, country, or IATA code';

// ── Hotel Booking ────────────────────────────────────────────────
export const HOTEL_ID_REQUIRED = 'hotelId is required';
export const OFFER_ID_REQUIRED = 'offerId is required';
export const PREBOOK_ID_REQUIRED = 'prebookId is required';
export const BOOKING_ID_REQUIRED = 'bookingId is required';
export const GUESTS_REQUIRED = 'At least one guest is required';
export const CONTACT_EMAIL_REQUIRED = 'contact.email is required';
export const CONTACT_PHONE_REQUIRED = 'contact.phone is required';
export const BOOKING_NOT_FOUND = 'Hotel booking not found';
export const BOOKING_ALREADY_CANCELLED = 'Booking is already cancelled';

// ── Auth ─────────────────────────────────────────────────────────
export const NOT_AUTHORIZED = 'Not authorized to access this route';
export const ROLE_NOT_AUTHORIZED = (role) => `Role '${role}' is not authorized to access this route`;

// ── Provider failures (LiteAPI) ──────────────────────────────────
// Written for a traveller, not an operator. Each one answers "what do I do now?"
// and never names the supplier, repeats its error text, or mentions an environment
// variable. The provider's payload is logged by the client that caught it, so
// nothing is lost for debugging — it just does not reach a browser.
export const HOTELS_NOT_CONFIGURED =
  'Hotel search is temporarily unavailable. Please try again in a moment.';

const SEARCH_REJECTED =
  "We couldn't find hotels for that search. Check the dates and destination and try again.";
const SEARCH_UNAVAILABLE = 'Hotel search is temporarily unavailable. Please try again in a moment.';
const HOTEL_GONE = "We couldn't find that hotel.";
const HOTEL_LOAD_UNAVAILABLE = "We couldn't load that hotel right now. Please try again.";
const BOOKING_REJECTED =
  "We couldn't complete that hotel booking. Check the guest details and try again.";
const BOOKING_UNAVAILABLE = 'Hotel booking is temporarily unavailable. Please try again in a moment.';
const BOOKING_GONE = "We couldn't find that hotel booking.";
const BOOKING_LOAD_UNAVAILABLE = "We couldn't load that hotel booking right now. Please try again.";
const BOOKINGS_LIST_UNAVAILABLE = "We couldn't load your hotel bookings right now. Please try again.";
const CANCEL_UNAVAILABLE =
  "We couldn't cancel that hotel booking right now. Please try again in a moment.";
const HOTEL_SERVICE_UNAVAILABLE = 'Hotel service is temporarily unavailable. Please try again in a moment.';

/**
 * Maps a provider failure to the status, code and sentence a client is shown.
 *
 * A 4xx the traveller cannot act on collapses to a retryable 502, so the frontend
 * never has to explain a supplier's validation vocabulary. PROVIDER_REJECTED means
 * the request needs changing; PROVIDER_UNAVAILABLE means retrying later will help.
 *
 * @param {'search'|'details'|'book'|'retrieve'|'list'|'cancel'} operation
 * @param {number|undefined} providerStatus the provider's HTTP status, if it responded
 * @returns {{ statusCode: number, code: string, message: string }}
 */
export function hotelProviderFailure(operation, providerStatus) {
  const status = Number.isFinite(providerStatus) ? providerStatus : undefined;
  const clientError = status >= 400 && status < 500;

  switch (operation) {
    case 'search':
      return clientError
        ? { statusCode: 400, code: 'PROVIDER_REJECTED', message: SEARCH_REJECTED }
        : { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: SEARCH_UNAVAILABLE };
    case 'details':
      return status === 404
        ? { statusCode: 404, code: 'NOT_FOUND', message: HOTEL_GONE }
        : { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: HOTEL_LOAD_UNAVAILABLE };
    case 'book':
      return clientError
        ? { statusCode: 400, code: 'PROVIDER_REJECTED', message: BOOKING_REJECTED }
        : { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: BOOKING_UNAVAILABLE };
    case 'retrieve':
      return status === 404
        ? { statusCode: 404, code: 'NOT_FOUND', message: BOOKING_GONE }
        : { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: BOOKING_LOAD_UNAVAILABLE };
    case 'list':
      return { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: BOOKINGS_LIST_UNAVAILABLE };
    case 'cancel':
      return { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: CANCEL_UNAVAILABLE };
    default:
      return { statusCode: 502, code: 'PROVIDER_UNAVAILABLE', message: HOTEL_SERVICE_UNAVAILABLE };
  }
}
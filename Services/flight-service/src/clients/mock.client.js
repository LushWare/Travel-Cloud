import AppError from '../utils/appError.js';
import { BAD_REQUEST } from '../constants/httpStatus.js';
import { SEARCH_REQUIRED_FIELDS, OFFER_ID_REQUIRED, TRAVELERS_REQUIRED, TRAVELPORT_ORDER_ID_REQUIRED } from '../constants/errorMessages.js';
import logger from '../config/logger.js';

/**
 * @implements {import('./interface.js').FlightApiClient}
 *
 * Deterministic mock flight provider for development and testing.
 * Returns realistic fake data with no network calls.
 */
export class MockFlightClient {
  constructor() {
    this.airlines = Object.freeze([
      { code: 'BA', name: 'British Airways' },
      { code: 'EK', name: 'Emirates' },
      { code: 'QR', name: 'Qatar Airways' },
      { code: 'SQ', name: 'Singapore Airlines' },
    ]);
    logger.info('Using MockFlightClient — no external API calls');
  }

  // ── Public API (implements FlightApiClient) ──────────────────────

  /** @param {import('./interface.js').SearchParams} params */
  async searchFlights({ origin, destination, departureDate, returnDate, adults = 1, children = 0, infants = 0, cabinClass, tripType }) {
    if (!origin || !destination || !departureDate) {
      throw new AppError(SEARCH_REQUIRED_FIELDS, BAD_REQUEST);
    }

    const paxMultiplier = adults + children + infants;
    return Array.from({ length: 5 }, (_, index) => {
      const offer = this.#buildMockOffer({ origin, destination, departureDate, returnDate, cabinClass, index });
      offer.baseFare *= paxMultiplier;
      offer.taxes = Math.round(offer.taxes * paxMultiplier);
      offer.fareTotal = offer.baseFare + offer.taxes;
      return offer;
    });
  }

  /** @param {string} offerId */
  async priceOffer(offerId) {
    if (!offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);
    return { offerId, revalidated: true, priceChanged: false };
  }

  /** @param {import('./interface.js').CreateOrderParams} params */
  async createOrder({ offerId, travelers, contact }) {
    if (!offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);
    if (!Array.isArray(travelers) || travelers.length === 0) {
      throw new AppError(TRAVELERS_REQUIRED, BAD_REQUEST);
    }

    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return {
      pnr: `MOCK${suffix}`,
      travelportOrderId: `MOCK-ORDER-${suffix}`,
      status: 'confirmed',
      ticketingDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /** @param {string} travelportOrderId */
  async getOrder(travelportOrderId) {
    if (!travelportOrderId) throw new AppError(TRAVELPORT_ORDER_ID_REQUIRED, BAD_REQUEST);
    return { travelportOrderId, status: 'confirmed' };
  }

  /** @param {string} travelportOrderId */
  async cancelOrder(travelportOrderId) {
    if (!travelportOrderId) throw new AppError(TRAVELPORT_ORDER_ID_REQUIRED, BAD_REQUEST);
    return { travelportOrderId, status: 'cancelled' };
  }

  /** @param {import('./interface.js').FlightDetailsParams} params */
  async getFlightDetails({ flightNumber, departureDate }) {
    return {
      flightNumber,
      status: 'ON_TIME',
      aircraft: { code: '77W', name: 'Boeing 777-300ER' },
      departure: {
        airport: 'DXB',
        terminal: '3',
        gate: 'B12',
        scheduled: `${departureDate}T08:30:00Z`,
        estimated: null,
        actual: null,
      },
      arrival: {
        airport: 'CMB',
        terminal: '1',
        gate: 'A5',
        scheduled: `${departureDate}T14:45:00Z`,
        estimated: null,
        actual: null,
      },
      baggage: { checked: '30kg', cabin: '7kg' },
      seatMap: { available: true },
      mealService: true,
      wifiAvailable: true,
    };
  }

  async createLinksSession() {
    return { url: 'https://links.duffel.com/s/mock-session' };
  }

  // ── Private mock data builders ───────────────────────────────────

  #buildMockSegment({ origin, destination, departureDate, sequence, airline }) {
    const depHour = 6 + ((sequence * 3) % 14);
    const durationMinutes = 120 + ((sequence * 47) % 480);
    const departureAt = new Date(`${departureDate}T${String(depHour).padStart(2, '0')}:00:00Z`);
    const arrivalAt = new Date(departureAt.getTime() + durationMinutes * 60_000);

    return {
      sequence,
      marketingCarrier: airline.code,
      operatingCarrier: airline.code,
      flightNumber: `${airline.code}${100 + sequence * 37}`,
      bookingClass: 'Y',
      origin,
      destination,
      departureAt: departureAt.toISOString(),
      arrivalAt: arrivalAt.toISOString(),
      durationMinutes,
      stops: 0,
    };
  }

  #buildMockOffer({ origin, destination, departureDate, returnDate, cabinClass, index }) {
    const airline = this.airlines[index % this.airlines.length];
    const baseFare = 220 + index * 65;
    const taxes = Math.round(baseFare * 0.18);
    const segments = [this.#buildMockSegment({ origin, destination, departureDate, sequence: 1, airline })];
    if (returnDate) {
      segments.push(this.#buildMockSegment({ origin: destination, destination: origin, departureDate: returnDate, sequence: 2, airline }));
    }

    return {
      offerId: `MOCK-OFFER-${origin}${destination}-${departureDate}-${index}`,
      airline: airline.name,
      airlineCode: airline.code,
      legCount: returnDate ? 2 : 1,
      cabinClass: cabinClass || 'Economy',
      currency: 'USD',
      baseFare,
      taxes,
      fareTotal: baseFare + taxes,
      refundable: index % 2 === 0,
      segments,
    };
  }
}

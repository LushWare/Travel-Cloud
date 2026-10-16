import axios from 'axios';
import AppError from '../utils/appError.js';
import logger from '../config/logger.js';
import { BAD_REQUEST, CONFLICT, SERVICE_UNAVAILABLE } from '../constants/httpStatus.js';
import {
  SEARCH_REQUIRED_FIELDS,
  OFFER_ID_REQUIRED,
  TRAVELERS_REQUIRED,
  TRAVELPORT_ORDER_ID_REQUIRED,
  PROVIDER_NOT_CONFIGURED_FRIENDLY,
  flightProviderFailure,
} from '../constants/errorMessages.js';

/**
 * Duffel API base URL.
 * @type {string}
 */
const DUFFEL_BASE_URL = 'https://api.duffel.com';

/**
 * @implements {import('./interface.js').FlightApiClient}
 *
 * Duffel Flights API integration.
 * Auth: Bearer token (API access key)
 * Version: Duffel-Version: v2 header required
 * Rate limit: 60 requests per 60 seconds
 *
 * Key differences from Travelport:
 * - API token auth instead of OAuth2
 * - Search returns priced offers immediately (no separate price step)
 * - Cancellation is two-step: create cancellation → confirm
 * - All request bodies wrapped in { data: {...} }
 */
export class DuffelClient {
  constructor() {
    this.#ensureConfig();
    logger.info('Using DuffelClient — live Duffel API integration');
  }

  // ── Public API (implements FlightApiClient) ──────────────────────

  /** @param {import('./interface.js').SearchParams} params */
  async searchFlights({ origin, destination, departureDate, returnDate, adults = 1, children = 0, infants = 0, childAges = [], infantAges = [], cabinClass, tripType }) {
    if (!origin || !destination || !departureDate) {
      throw new AppError(SEARCH_REQUIRED_FIELDS, BAD_REQUEST);
    }

    const slices = this.#buildSlices({ origin, destination, departureDate, returnDate });
    const passengers = this.#buildPassengers({ adults, children, infants, childAges, infantAges });

    try {
      const { data } = await this.#client().post('/air/offer_requests', {
        data: {
          slices,
          passengers,
          cabin_class: this.#mapCabinClass(cabinClass),
          return_offers: true,
        },
      });

      return this.#normalizeOffers(data.data);
    } catch (err) {
      this.#unwrapError(err, 'search');
    }
  }

  /**
   * Duffel offers are priced at search time. Price revalidation fetches the
   * latest offer state (price may have changed since search).
   * @param {string} offerId
   */
  async priceOffer(offerId, { cardId, services = [], expectedTotal } = {}) {
    if (!offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);
    if (cardId) this.#assertCardCheckoutEnabled();

    try {
      const client = this.#client();
      let offer;
      let servicesTotal = 0;
      let surchargeTotal = 0;
      if (cardId) {
        const currentResponse = await client.get(`/air/offers/${offerId}`, {
          params: { return_available_services: true },
        });
        servicesTotal = await this.#selectedServicesTotal(client, offerId, currentResponse.data.data, services);
        const response = await client.post(`/air/offers/${offerId}/actions/price`, {
          data: {
            intended_payment_methods: [{ type: 'card', card_id: cardId }],
            intended_services: services,
          },
        });
        offer = response.data.data;
        surchargeTotal = (offer.intended_payment_methods || [])
          .filter((method) => method.type === 'card' && method.card_id === cardId)
          .reduce((total, method) => total + (Number(method.surcharge_amount) || 0), 0);
      } else {
        const response = await client.get(`/air/offers/${offerId}`, { params: { return_available_services: false } });
        offer = response.data.data;
      }
      const totalAmount = Number(offer.total_amount) + servicesTotal + surchargeTotal;
      return {
        offerId: offer.id,
        revalidated: true,
        priceChanged: expectedTotal != null && Math.abs(totalAmount - Number(expectedTotal)) > 0.01,
        totalAmount,
        currency: offer.total_currency,
      };
    } catch (err) {
      this.#unwrapError(err, 'price');
    }
  }

  /**
   * Load fresh Duffel data needed to present checkout options.
   * Seat maps and upsells are optional because airline support varies.
   * @param {string} offerId
   */
  async getCheckoutData(offerId) {
    if (!offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);

    const client = this.#client();
    try {
      const [offerResponse, keyResponse] = await Promise.all([
        client.get(`/air/offers/${offerId}`, { params: { return_available_services: true } }),
        client.post('/identity/component_client_keys', { data: {} }),
      ]);

      const optionalResponses = await Promise.allSettled([
        client.get('/air/seat_maps', { params: { offer_id: offerId } }),
        client.post(`/air/offers/${offerId}/upsell_offers`),
      ]);

      const [seatMapsResult, upsellsResult] = optionalResponses;
      if (seatMapsResult.status === 'rejected') {
        logger.warn({ status: seatMapsResult.reason.response?.status }, 'Duffel seat maps unavailable for offer');
      }
      if (upsellsResult.status === 'rejected') {
        logger.warn({ status: upsellsResult.reason.response?.status }, 'Duffel upsell offers unavailable for offer');
      }

      return {
        offer: offerResponse.data.data,
        seatMaps: seatMapsResult.status === 'fulfilled' ? seatMapsResult.value.data.data || [] : [],
        upsellOffers: upsellsResult.status === 'fulfilled' ? upsellsResult.value.data.data || [] : [],
        clientKey: keyResponse.data.data.component_client_key,
        cardCheckoutEnabled: this.#isCardCheckoutEnabled(),
      };
    } catch (err) {
      this.#unwrapError(err, 'price');
    }
  }

  /**
   * Create a hosted Duffel Links session for turnkey search and booking.
   * @param {object} [params]
   */
  async createLinksSession({ reference = 'CRM_SESSION', successUrl, failureUrl, abandonmentUrl } = {}) {
    const client = this.#client();
    try {
      const validSuccess = successUrl || process.env.DUFFEL_SUCCESS_URL || 'https://example.com/flights/success';
      const validFailure = failureUrl || process.env.DUFFEL_FAILURE_URL || 'https://example.com/flights/failure';
      const validAbandon = abandonmentUrl || process.env.DUFFEL_ABANDON_URL || 'https://example.com/flights';

      const { data } = await client.post('/links/sessions', {
        data: {
          reference,
          success_url: validSuccess,
          failure_url: validFailure,
          abandonment_url: validAbandon,
          flights: { enabled: true },
          stays: { enabled: false },
        },
      });

      return { url: data.data.url };
    } catch (err) {
      this.#unwrapError(err, 'links');
    }
  }

  /** @param {import('./interface.js').CreateOrderParams & { totalAmount?: number, currency?: string, services?: Array<{id: string, quantity: number}>, payment?: {cardId: string, threeDSecureSessionId: string} }} params */
  async createOrder({ offerId, travelers, contact, services = [], payment, totalAmount, currency }) {
    if (!offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);
    if (!Array.isArray(travelers) || travelers.length === 0) {
      throw new AppError(TRAVELERS_REQUIRED, BAD_REQUEST);
    }

    try {
      const passengerDetails = this.#normalizePassengersForOrder(travelers);
      if (payment) this.#assertCardCheckoutEnabled();

      const client = this.#client();
      const { data: offerResponse } = await client.get(`/air/offers/${offerId}`, {
        params: { return_available_services: true },
      });
      const currentOffer = offerResponse.data;
      const servicesTotal = await this.#selectedServicesTotal(client, offerId, currentOffer, services);

      let pricedOffer = currentOffer;
      let surchargeTotal = 0;
      if (payment) {
        const { data: priceResponse } = await client.post(`/air/offers/${offerId}/actions/price`, {
          data: {
            intended_payment_methods: [{ type: 'card', card_id: payment.cardId }],
            intended_services: services,
          },
        });
        pricedOffer = priceResponse.data;
        surchargeTotal = (pricedOffer.intended_payment_methods || [])
          .filter((method) => method.type === 'card' && method.card_id === payment.cardId)
          .reduce((total, method) => total + (Number(method.surcharge_amount) || 0), 0);
      }

      const currentTotal = (Number(pricedOffer.total_amount) || 0) + servicesTotal + surchargeTotal;
      if (totalAmount != null && (
        Math.abs(currentTotal - Number(totalAmount)) > 0.01
        || (currency && pricedOffer.total_currency !== currency)
      )) {
        throw new AppError('The fare or selected services changed. Refresh checkout and confirm the new total.', CONFLICT, {
          code: 'PRICE_CHANGED',
        });
      }
      const paymentDetails = payment
        ? {
            type: 'card',
            card_id: payment.cardId,
            three_d_secure_session_id: payment.threeDSecureSessionId,
            amount: currentTotal.toFixed(2),
            currency: pricedOffer.total_currency,
          }
        : {
            type: 'balance',
            amount: currentTotal.toFixed(2),
            currency: pricedOffer.total_currency || currency || 'USD',
          };

      const response = await client.post('/air/orders', {
        data: {
          type: 'instant',
          selected_offers: [offerId],
          passengers: passengerDetails,
          ...(services.length > 0 && { services }),
          payments: [paymentDetails],
        },
      });

      const order = response.data.data;
      if ([200, 202].includes(response.status) || !order?.id) {
        return {
          pnr: null,
          travelportOrderId: null,
          status: 'pending',
          ticketingDeadline: null,
          totalAmount: currentTotal,
          currency: pricedOffer.total_currency,
          cancelledAt: null,
          cancellationReason: null,
        };
      }

      return { ...this.#normalizeOrder(order), status: 'pending' };
    } catch (err) {
      this.#unwrapError(err, 'book');
    }
  }

  /** @param {string} orderId */
  async getOrder(orderId) {
    if (!orderId) throw new AppError(TRAVELPORT_ORDER_ID_REQUIRED, BAD_REQUEST);

    try {
      const { data } = await this.#client().get(`/air/orders/${orderId}`);
      return this.#normalizeOrder(data.data);
    } catch (err) {
      this.#unwrapError(err, 'retrieve');
    }
  }

  async createCancellationQuote(orderId) {
    if (!orderId) throw new AppError(TRAVELPORT_ORDER_ID_REQUIRED, BAD_REQUEST);

    try {
      const order = await this.getOrder(orderId);
      if (!order.availableActions.includes('cancel')) {
        throw new AppError('This airline booking is not currently eligible for cancellation.', BAD_REQUEST, {
          code: 'CANCELLATION_UNAVAILABLE',
        });
      }

      const { data } = await this.#client().post('/air/order_cancellations', {
        data: { order_id: orderId },
      });
      const quote = data.data;
      return {
        cancellationId: quote.id,
        orderId: quote.order_id,
        refundAmount: quote.refund_amount,
        refundCurrency: quote.refund_currency,
        refundTo: quote.refund_to,
        expiresAt: quote.expires_at,
        airlineCredits: quote.airline_credits || [],
        confirmedAt: quote.confirmed_at,
      };
    } catch (err) {
      this.#unwrapError(err, 'cancel');
    }
  }

  async confirmCancellation(orderId, cancellationId) {
    if (!orderId || !cancellationId) throw new AppError('A cancellation quote is required.', BAD_REQUEST);

    try {
      const client = this.#client();
      const { data: quoteResponse } = await client.get(`/air/order_cancellations/${cancellationId}`);
      const quote = quoteResponse.data;
      if (quote.order_id !== orderId) {
        throw new AppError('The cancellation quote does not belong to this booking.', BAD_REQUEST, {
          code: 'CANCELLATION_QUOTE_MISMATCH',
        });
      }
      if (quote.confirmed_at) {
        throw new AppError('This cancellation quote has already been confirmed.', BAD_REQUEST, {
          code: 'CANCELLATION_ALREADY_CONFIRMED',
        });
      }
      if (quote.expires_at && new Date(quote.expires_at).getTime() <= Date.now()) {
        throw new AppError('This cancellation quote has expired. Request a new quote.', BAD_REQUEST, {
          code: 'CANCELLATION_QUOTE_EXPIRED',
        });
      }

      const { data } = await client.post(`/air/order_cancellations/${cancellationId}/actions/confirm`);
      return {
        travelportOrderId: orderId,
        status: 'cancelled',
        refundAmount: data.data.refund_amount,
        refundCurrency: data.data.refund_currency,
        refundTo: data.data.refund_to,
        airlineCredits: data.data.airline_credits || [],
      };
    } catch (err) {
      this.#unwrapError(err, 'cancel');
    }
  }

  /**
   * Duffel cancellation is two-step:
   * 1. POST /air/order_cancellations → get preview + cancellation ID
   * 2. POST /air/order_cancellations/:id/actions/confirm → finalise
   * @param {string} orderId
   */
  async cancelOrder(orderId) {
    if (!orderId) throw new AppError(TRAVELPORT_ORDER_ID_REQUIRED, BAD_REQUEST);

    try {
      // Step 1: Create pending cancellation
      const { data: cancellation } = await this.#client().post('/air/order_cancellations', {
        data: { order_id: orderId },
      });

      // Step 2: Confirm immediately (irreversible)
      await this.#client().post(
        `/air/order_cancellations/${cancellation.data.id}/actions/confirm`,
      );

      return {
        travelportOrderId: orderId,
        status: 'cancelled',
        refundAmount: cancellation.data.refund_amount,
        refundCurrency: cancellation.data.refund_currency,
      };
    } catch (err) {
      this.#unwrapError(err, 'cancel');
    }
  }

  /** @param {import('./interface.js').FlightDetailsParams} params */
  async getFlightDetails({ flightNumber, departureDate, origin, destination }) {
    // Duffel doesn't provide real-time flight status. Return a stub
    // directing users to use airline-specific tools for live tracking.
    return {
      flightNumber,
      status: 'SCHEDULED',
      aircraft: null,
      departure: {
        airport: origin || null,
        scheduled: departureDate ? `${departureDate}T00:00:00Z` : null,
      },
      arrival: { airport: destination || null },
      baggage: null,
      seatMap: { available: false },
      mealService: false,
      wifiAvailable: false,
      note: 'Live flight details are not available via Duffel. Use airline-specific status APIs.',
    };
  }

  // ── Private: config ──────────────────────────────────────────────

  #isCardCheckoutEnabled() {
    return process.env.DUFFEL_CARD_CHECKOUT_ENABLED === 'true';
  }

  #assertCardCheckoutEnabled() {
    if (!this.#isCardCheckoutEnabled()) {
      throw new AppError(
        'Duffel customer-card checkout is not enabled for this account. Contact help@duffel.com or use Duffel balance.',
        BAD_REQUEST,
        { code: 'CARD_CHECKOUT_DISABLED' },
      );
    }
  }

  #ensureConfig() {
    const token = process.env.DUFFEL_ACCESS_TOKEN;
    if (!token) {
      throw new AppError(PROVIDER_NOT_CONFIGURED_FRIENDLY, SERVICE_UNAVAILABLE, {
        code: 'PROVIDER_UNAVAILABLE',
      });
    }
    this._token = token;
  }

  #client() {
    return axios.create({
      baseURL: DUFFEL_BASE_URL,
      headers: {
        Authorization: `Bearer ${this._token}`,
        'Duffel-Version': 'v2',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  // ── Private: data transforms ─────────────────────────────────────

  /**
   * Build Duffel slices from our search params.
   * @returns {Array<{origin: string, destination: string, departure_date: string}>}
   */
  #buildSlices({ origin, destination, departureDate, returnDate }) {
    const slices = [
      { origin: origin.toUpperCase(), destination: destination.toUpperCase(), departure_date: departureDate },
    ];

    if (returnDate) {
      slices.push({
        origin: destination.toUpperCase(),
        destination: origin.toUpperCase(),
        departure_date: returnDate,
      });
    }

    return slices;
  }

  /**
   * Duffel requires passenger type and age at search time.
   * @returns {Array<{type?: string, age?: number}>}
   */
  #buildPassengers({ adults, children, infants, childAges = [], infantAges = [] }) {
    const passengers = [];

    for (let i = 0; i < adults; i++) {
      passengers.push({ type: 'adult' });
    }
    for (let i = 0; i < children; i++) passengers.push({ age: childAges[i] ?? 8 });
    for (let i = 0; i < infants; i++) {
      passengers.push(infantAges[i] == null ? { type: 'infant_without_seat' } : { age: infantAges[i] });
    }

    return passengers;
  }

  /** @param {string} [cabinClass] */
  #mapCabinClass(cabinClass) {
    const map = {
      Economy: 'economy',
      'Premium Economy': 'premium_economy',
      Business: 'business',
      First: 'first',
    };
    return map[cabinClass] || 'economy';
  }

  /**
   * Normalise Duffel offer response → our FlightOffer shape.
   */
  #normalizeOffers(offerRequest) {
    const offers = offerRequest.offers || [];
    const passengers = offerRequest.passengers || [];

    return offers.map((offer) => {
      const firstSlice = offer.slices?.[0];
      const firstSegment = firstSlice?.segments?.[0];
      const lastSlice = offer.slices?.[offer.slices.length - 1];
      const lastSegment = lastSlice?.segments?.[lastSlice.segments.length - 1];

      // Baggage info from first passenger of first segment
      const firstPax = firstSegment?.passengers?.[0];
      const checkedBags = firstPax?.baggages?.find((b) => b.type === 'checked')?.quantity ?? 0;
      const carryOnBags = firstPax?.baggages?.find((b) => b.type === 'carry_on')?.quantity ?? 1;

      return {
        offerId: offer.id,
        airline: offer.owner?.name || 'Unknown',
        airlineCode: offer.owner?.iata_code || 'XX',
        airlineLogo: offer.owner?.logo_symbol_url || null,
        legCount: (offer.slices || []).length,
        cabinClass: firstSlice?.cabin_class || firstPax?.cabin_class || 'economy',
        cabinMarketingName: firstPax?.cabin_class_marketing_name || null,
        fareBrandName: firstSlice?.fare_brand_name || firstPax?.fare_brand_name || null,
        currency: offer.total_currency,
        baseFare: parseFloat(offer.base_amount) || 0,
        taxes: parseFloat(offer.tax_amount) || 0,
        fareTotal: parseFloat(offer.total_amount) || 0,
        refundable: offer.conditions?.refund_before_departure?.allowed,
        changeable: offer.conditions?.change_before_departure?.allowed,
        refundPenalty: offer.conditions?.refund_before_departure?.penalty_amount
          ? `${offer.conditions.refund_before_departure.penalty_amount} ${offer.conditions.refund_before_departure.penalty_currency}`
          : null,
        changePenalty: offer.conditions?.change_before_departure?.penalty_amount
          ? `${offer.conditions.change_before_departure.penalty_amount} ${offer.conditions.change_before_departure.penalty_currency}`
          : null,
        baggageAllowance: {
          checkedBags,
          carryOnBags,
        },
        passengerIds: passengers.map((p) => p.id),
        segments: (offer.slices || []).flatMap((slice, sliceIdx) =>
          (slice.segments || []).map((seg, segIdx) => ({
            sequence: sliceIdx * 100 + segIdx + 1,
            marketingCarrier: seg.marketing_carrier?.iata_code || 'XX',
            operatingCarrierName: seg.operating_carrier?.name || seg.marketing_carrier?.name || 'Unknown carrier',
            operatingCarrier: seg.operating_carrier?.iata_code || seg.marketing_carrier?.iata_code || null,
            flightNumber: `${seg.marketing_carrier?.iata_code || 'XX'}${seg.marketing_carrier_flight_number || ''}`,
            bookingClass: null,
            origin: seg.origin?.iata_code || '',
            destination: seg.destination?.iata_code || '',
            originTerminal: seg.origin_terminal || null,
            destinationTerminal: seg.destination_terminal || null,
            aircraft: seg.aircraft?.name || null,
            departureAt: seg.departing_at,
            arrivalAt: seg.arriving_at,
            durationMinutes: seg.duration ? this.#parseDuration(seg.duration) : null,
            stops: slice.segments.length - 1,
            cabinMarketingName: seg.passengers?.[0]?.cabin_class_marketing_name || null,
          })),
        ),
      };
    });
  }

  /**
   * Normalise Duffel order response → our OrderResult shape.
   */
  #normalizeOrder(order) {
    const status = order.cancelled_at
      ? 'cancelled'
      : order.payment_status?.awaiting_payment
        ? 'pending'
        : 'confirmed';

    return {
      pnr: order.booking_reference,
      travelportOrderId: order.id,
      status,
      ticketingDeadline: null,
      baseFare: parseFloat(order.base_amount) || 0,
      taxes: parseFloat(order.tax_amount) || 0,
      totalAmount: parseFloat(order.total_amount) || 0,
      currency: order.total_currency,
      cancelledAt: order.cancelled_at || null,
      cancellationReason: null,
      availableActions: order.available_actions || [],
      documents: order.documents || [],
      services: order.services || [],
      paymentStatus: order.payment_status || null,
      conditions: order.conditions || null,
    };
  }

  async #selectedServicesTotal(client, offerId, offer, services) {
    if (services.length === 0) return 0;

    const seatMapsResponse = await client.get('/air/seat_maps', { params: { offer_id: offerId } })
      .catch(() => ({ data: { data: [] } }));
    const seatServices = (seatMapsResponse.data.data || []).flatMap((seatMap) =>
      (seatMap.cabins || []).flatMap((cabin) =>
        (cabin.rows || []).flatMap((row) =>
          (row.sections || []).flatMap((section) =>
            (section.elements || []).flatMap((element) => element.available_services || []),
          ),
        ),
      ),
    );
    const availableServices = [...(offer.available_services || []), ...seatServices];
    let servicesTotal = 0;
    for (const selection of services) {
      const available = availableServices.find((service) => service.id === selection.id);
      if (!available || selection.quantity > (available.maximum_quantity || 1)) {
        throw new AppError('A selected bag or seat is no longer available. Refresh the offer and try again.', BAD_REQUEST, { code: 'SERVICE_UNAVAILABLE' });
      }
      servicesTotal += (Number(available.total_amount) || 0) * selection.quantity;
    }
    return servicesTotal;
  }

  #normalizePassengersForOrder(travelers) {
    return travelers.map((t) => {
      const givenName = String(t.firstName ?? '').trim();
      const familyName = String(t.lastName ?? '').trim();
      const dob = String(t.dob ?? '').trim();
      const email = String(t.email ?? '').trim();
      const phone = String(t.phone ?? '').trim();

      if (!givenName) throw new AppError('Passenger first name is required', BAD_REQUEST, { code: 'BAD_REQUEST' });
      if (!familyName) throw new AppError('Passenger last name is required', BAD_REQUEST, { code: 'BAD_REQUEST' });
      if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        throw new AppError('Passenger date of birth is required', BAD_REQUEST, { code: 'BAD_REQUEST' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError('Passenger email is required and must be valid', BAD_REQUEST, { code: 'BAD_REQUEST' });
      }
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
        throw new AppError('Passenger phone must use international format', BAD_REQUEST, { code: 'BAD_REQUEST' });
      }
      if (!t.passengerId) {
        throw new AppError('Duffel passenger ID is required. Refresh the selected offer and try again.', BAD_REQUEST, { code: 'PASSENGER_ID_REQUIRED' });
      }
      if (!['M', 'F'].includes(t.gender || '')) {
        throw new AppError('Passenger gender is required', BAD_REQUEST, { code: 'BAD_REQUEST' });
      }

      const passenger = {
        id: t.passengerId,
        given_name: givenName,
        family_name: familyName,
        born_on: dob,
        email,
        phone_number: phone,
        ...(t.infantPassengerId && { infant_passenger_id: t.infantPassengerId }),
        ...(t.passportNumber && {
          identity_documents: [{
            type: 'passport',
            unique_identifier: t.passportNumber,
            ...(t.passportExpiry && { expires_on: t.passportExpiry }),
            ...(t.nationality && { issuing_country_code: t.nationality }),
          }],
        }),
        ...(t.gender && (t.gender === 'M' || t.gender === 'F') && { gender: t.gender === 'M' ? 'm' : 'f' }),
        ...(t.title && { title: String(t.title).toLowerCase() }),
      };

      return passenger;
    });
  }

  /**
   * Convert ISO 8601 duration string (e.g. "PT2H30M") to minutes.
   */
  #parseDuration(iso) {
    const match = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return null;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    return hours * 60 + minutes;
  }

  // ── Private: error handling ───────────────────────────────────────

  /**
   * Turns a provider failure into a user-facing AppError.
   *
   * The provider's payload is logged here and nowhere else; what reaches the caller
   * carries only a sentence written for a traveller. `operation` selects which one,
   * because "that fare has gone" and "search is down" need different advice.
   *
   * @param {unknown} err
   * @param {'search'|'price'|'book'|'retrieve'|'cancel'} operation
   */
  #unwrapError(err, operation) {
    if (err instanceof AppError) throw err;

    logger.error(
      { status: err.response?.status, data: err.response?.data, operation },
      'Duffel API error details',
    );

    const { statusCode, code, message } = flightProviderFailure(operation, err.response?.status);
    throw new AppError(message, statusCode, { code });
  }
}

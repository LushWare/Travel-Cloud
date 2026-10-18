import { faker } from '@faker-js/faker';

/**
 * @typedef {import('../../docs/openapi.yaml').components.schemas.FlightOffer} FlightOffer
 * @typedef {import('../../docs/openapi.yaml').components.schemas.FlightSegment} FlightSegment
 * @typedef {import('../../docs/openapi.yaml').components.schemas.FlightTraveler} FlightTraveler
 */

const AIRLINES = [
  { code: 'EK', name: 'Emirates' },
  { code: 'QR', name: 'Qatar Airways' },
  { code: 'BA', name: 'British Airways' },
  { code: 'SQ', name: 'Singapore Airlines' },
];

/**
 * Build a single flight segment.
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildFlightSegment(overrides = {}) {
  const origin = overrides.origin || faker.airline.airport().iataCode;
  const destination = overrides.destination || faker.airline.airport().iataCode;
  const departureAt = overrides.departureAt
    ? new Date(overrides.departureAt)
    : faker.date.soon({ days: 30 });

  const arrivalAt = new Date(departureAt.getTime() + (overrides.durationMinutes || 240) * 60_000);

  return {
    sequence: overrides.sequence ?? 1,
    marketingCarrier: overrides.marketingCarrier || 'EK',
    operatingCarrier: overrides.operatingCarrier || null,
    flightNumber: overrides.flightNumber || 'EK502',
    bookingClass: overrides.bookingClass || 'Y',
    origin,
    destination,
    departureAt: departureAt.toISOString(),
    arrivalAt: arrivalAt.toISOString(),
    durationMinutes: overrides.durationMinutes ?? 240,
    stops: overrides.stops ?? 0,
  };
}

/**
 * Build a flight offer (search result).
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildFlightOffer(overrides = {}) {
  const segments = overrides.segments || [buildFlightSegment(overrides)];

  return {
    offerId: overrides.offerId || faker.string.uuid(),
    airline: overrides.airline || 'Emirates',
    airlineCode: overrides.airlineCode || 'EK',
    legCount: overrides.legCount ?? 1,
    cabinClass: overrides.cabinClass || 'Economy',
    currency: overrides.currency || 'USD',
    baseFare: overrides.baseFare ?? 220,
    taxes: overrides.taxes ?? 40,
    fareTotal: overrides.fareTotal ?? 260,
    refundable: overrides.refundable ?? true,
    segments,
  };
}

/**
 * Build a traveler object.
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildTraveler(overrides = {}) {
  return {
    type: overrides.type || 'adult',
    title: overrides.title || 'Mr',
    firstName: overrides.firstName || faker.person.firstName(),
    lastName: overrides.lastName || faker.person.lastName(),
    email: overrides.email || faker.internet.email().toLowerCase(),
    phone: overrides.phone || '',
    dob: overrides.dob || '1990-05-15',
    gender: overrides.gender || 'M',
    passportNumber: overrides.passportNumber || faker.string.alphanumeric(9).toUpperCase(),
    passportExpiry: overrides.passportExpiry || '2028-12-31',
    nationality: overrides.nationality || 'LK',
    frequentFlyerNumber: overrides.frequentFlyerNumber || null,
  };
}

/**
 * Build a booking request payload.
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildBookingRequest(overrides = {}) {
  return {
    offer: overrides.offer || buildFlightOffer(),
    tripType: overrides.tripType || 'oneWay',
    travelers: overrides.travelers || [buildTraveler()],
    contact: overrides.contact || {
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      phone: faker.phone.number(),
    },
  };
}

/**
 * Build a search request payload.
 * @param {object} [overrides]
 * @returns {object}
 */
export function buildSearchRequest(overrides = {}) {
  return {
    origin: overrides.origin || 'CMB',
    destination: overrides.destination || 'DXB',
    departureDate: overrides.departureDate || '2026-08-01',
    returnDate: overrides.returnDate || undefined,
    adults: overrides.adults ?? 1,
    children: overrides.children ?? 0,
    infants: overrides.infants ?? 0,
    cabinClass: overrides.cabinClass || 'Economy',
    tripType: overrides.tripType || 'oneWay',
  };
}

/**
 * Build multiple flight offers.
 * @param {number} count
 * @param {object} [baseOverrides]
 * @returns {object[]}
 */
export function buildFlightOffers(count = 3, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    buildFlightOffer({ ...baseOverrides, offerId: `OFFER-${i + 1}` }),
  );
}

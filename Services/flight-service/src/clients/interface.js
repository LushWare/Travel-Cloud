/**
 * @module clients/interface
 * @description JSDoc interface contract for flight API providers.
 * Every provider (Travelport, Amadeus, Sabre, mock) must implement these methods.
 *
 * @typedef {object} FlightApiClient
 *
 * @property {(params: SearchParams) => Promise<FlightOffer[]>} searchFlights
 * @property {(offerId: string) => Promise<PriceResult>} priceOffer
 * @property {(params: CreateOrderParams) => Promise<OrderResult>} createOrder
 * @property {(travelportOrderId: string) => Promise<OrderStatus>} getOrder
 * @property {(travelportOrderId: string) => Promise<CancelResult>} cancelOrder
 * @property {(params: FlightDetailsParams) => Promise<FlightDetails>} getFlightDetails
 */

/**
 * @typedef {object} SearchParams
 * @property {string} origin - IATA airport code
 * @property {string} destination - IATA airport code
 * @property {string} departureDate - YYYY-MM-DD
 * @property {string} [returnDate] - YYYY-MM-DD
 * @property {number} [adults] - default 1
 * @property {number} [children] - default 0
 * @property {number} [infants] - default 0
 * @property {number[]} [childAges] - passenger ages, required for accurate child fares
 * @property {number[]} [infantAges] - passenger ages, required for accurate infant fares
 * @property {string} [cabinClass] - Economy, Premium Economy, Business, First
 * @property {string} [tripType] - oneWay, roundTrip
 */

/**
 * @typedef {object} PriceResult
 * @property {string} offerId
 * @property {boolean} revalidated
 * @property {boolean} priceChanged
 */

/**
 * @typedef {object} CreateOrderParams
 * @property {string} offerId
 * @property {Traveler[]} travelers
 * @property {Contact} contact
 */

/**
 * @typedef {object} Traveler
 * @property {'adult'|'child'|'infant'} type
 * @property {string} [title]
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} [dob]
 * @property {string} [gender]
 * @property {string} [passportNumber]
 * @property {string} [passportExpiry]
 * @property {string} [nationality]
 * @property {string} [frequentFlyerNumber]
 */

/**
 * @typedef {object} Contact
 * @property {string} name
 * @property {string} email
 * @property {string} [phone]
 */

/**
 * @typedef {object} OrderResult
 * @property {string} pnr
 * @property {string} travelportOrderId
 * @property {string} status
 * @property {string} [ticketingDeadline]
 */

/**
 * @typedef {object} OrderStatus
 * @property {string} travelportOrderId
 * @property {string} status
 */

/**
 * @typedef {object} CancelResult
 * @property {string} travelportOrderId
 * @property {string} status
 */

/**
 * @typedef {object} FlightOffer
 * @property {string} offerId
 * @property {string} airline
 * @property {string} airlineCode
 * @property {number} legCount - journey legs (Duffel slices); 1 for a one-way
 * @property {string} cabinClass
 * @property {string} currency
 * @property {number} baseFare
 * @property {number} taxes
 * @property {number} fareTotal
 * @property {boolean} refundable
 * @property {FlightSegment[]} segments
 */

/**
 * @typedef {object} FlightSegment
 * @property {number} sequence
 * @property {string} marketingCarrier
 * @property {string|null} operatingCarrier
 * @property {string} flightNumber
 * @property {string|null} bookingClass
 * @property {string} origin
 * @property {string} destination
 * @property {string} departureAt
 * @property {string} arrivalAt
 * @property {number|null} durationMinutes
 * @property {number} stops
 */

/**
 * @typedef {object} FlightDetailsParams
 * @property {string} flightNumber
 * @property {string} departureDate
 * @property {string} [origin]
 * @property {string} [destination]
 */

/**
 * @typedef {object} FlightDetails
 * @property {string} flightNumber
 * @property {string} status
 * @property {object} aircraft
 * @property {object} departure
 * @property {object} arrival
 * @property {object} baggage
 * @property {object} seatMap
 * @property {boolean} mealService
 * @property {boolean} wifiAvailable
 */

export default {}; // no runtime value — this file is purely for JSDoc types

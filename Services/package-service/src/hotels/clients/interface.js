/**
 * @module hotels/clients/interface
 * @description JSDoc interface contract for hotel API providers.
 * Every provider (LiteAPI, mock) must implement these methods.
 *
 * @typedef {object} HotelApiClient
 * @property {(params: HotelSearchParams) => Promise<HotelOffer[]>} searchHotels
 *   Search hotels by location, coordinates, or city.
 * @property {(hotelId: string) => Promise<HotelDetails>} getHotelDetails
 *   Get full hotel details by provider ID.
 * @property {(hotelId: string, params?: object) => Promise<HotelReviews>} getHotelReviews
 *   Get authentic guest reviews by provider hotel ID.
 * @property {(countryCode: string) => Promise<string[]>} getCities
 *   Get LiteAPI city names supported for a destination country.
 * @property {() => Promise<Array<{code: string, name: string}>>} getCountries
 *   Get country codes and names supported by LiteAPI.
 * @property {(countryCode: string) => Promise<Array<object>>} getEsimPackages
 *   Get LiteAPI eSIM add-on packages and prices for a country.
 * @property {(params: PrebookParams) => Promise<PrebookResult>} prebook
 *   Validate a rate and get a prebook token (required before booking).
 * @property {(params: BookParams) => Promise<BookingResult>} book
 *   Confirm a booking using a prebook token.
 * @property {(params?: ListBookingsParams) => Promise<BookingResult[]>} listBookings
 *   List all bookings for the account.
 * @property {(bookingId: string) => Promise<BookingResult>} getBooking
 *   Get a single booking by provider ID.
 * @property {(bookingId: string, reason?: string) => Promise<CancelResult>} cancelBooking
 *   Cancel a booking by provider ID.
 */

/**
 * @typedef {object} HotelSearchParams
 * @property {number} [latitude] — coordinate search
 * @property {number} [longitude]
 * @property {number} [radius] — search radius in meters
 * @property {string} checkin — YYYY-MM-DD
 * @property {string} checkout — YYYY-MM-DD
 * @property {string} [currency] — ISO 4217, default USD
 * @property {string} [guestNationality] — ISO 3166-1 alpha-2, default US
 * @property {Array<{adults: number, children?: number[]}>} occupancies
 * @property {number} [limit] — max hotel candidates, default 5000
 * @property {string[]} [hotelIds] — retrieve rates for specific hotels
 * @property {number} [maxRatesPerHotel] — number of rate offers per hotel
 * @property {number} [timeout] — provider search timeout in seconds
 * @property {string} [city] — alternative: search by city
 * @property {string} [country] — alternative: search by country
 * @property {string} [iataCode] — alternative: search by IATA airport code
 */

/**
 * @typedef {object} Occupancy
 * @property {number} adults
 * @property {number[]} [children] — child ages, not a child count
 */

/**
 * @typedef {object} CheapestRate
 * @property {string} roomType
 * @property {string} boardType
 * @property {string} currency
 * @property {number} totalAmount
 * @property {number} taxes
 * @property {boolean} refundable
 */

/**
 * @typedef {object} HotelOffer
 * @property {string} hotelId — provider's hotel ID
 * @property {string} name
 * @property {string} [address]
 * @property {number} starRating
 * @property {string[]} [images]
 * @property {number} [distance] — km from search point
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {number|null} [rating] — provider guest score, commonly out of 10
 * @property {number} [reviewCount]
 * @property {CheapestRate} cheapestRate
 * @property {CheapestRate[]} [rates] — available rate offers for the hotel
 */

/**
 * @typedef {object} HotelDetails
 * @property {string} hotelId
 * @property {string} name
 * @property {string} [address]
 * @property {number} starRating
 * @property {string[]} [images]
 * @property {string[]} [amenities]
 * @property {string} [checkinTime]
 * @property {string} [checkoutTime]
 * @property {string} [description]
 * @property {string[]} [policies]
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {string} [city]
 * @property {string} [country]
 * @property {number|null} [rating]
 * @property {number} [reviewCount]
 */

/**
 * @typedef {object} HotelReviews
 * @property {Array<object>} reviews
 * @property {number} total
 * @property {object|null} sentimentAnalysis
 */

/**
 * @typedef {object} PrebookParams
 * @property {string} offerId — offer identifier from search
 * @property {Array<{adults: number, children?: number}>} occupancies
 * @property {boolean} [usePaymentSdk] — default true; false for promo validation without starting payment
 * @property {string} [voucherCode]
 * @property {Array<object>} [addons]
 */

/**
 * @typedef {object} PrebookResult
 * @property {string} prebookId — token for booking confirmation
 * @property {string} status — 'valid'
 * @property {string} [expiresAt] — ISO datetime
 * @property {string} [transactionId] — LiteAPI Payment SDK transaction
 * @property {string} [secretKey] — short-lived LiteAPI Payment SDK client secret
 * @property {'sandbox'|'live'} [paymentEnvironment] — matching SDK public key environment
 * @property {string[]} [paymentTypes] — payment methods supported by the selected offer
 */

/**
 * @typedef {object} BookParams
 * @property {string} prebookId
 * @property {Array<{firstName: string, lastName: string, title?: string}>} guests
 * @property {{name?: string, email: string, phone?: string}} contact
 * @property {{firstName: string, lastName: string}} [holder]
 * @property {{method: 'TRANSACTION_ID', transactionId: string}} [payment]
 */

/**
 * @typedef {object} BookingResult
 * @property {string} bookingId — provider's booking ID
 * @property {string} [pnr] — optional confirmation code
 * @property {string} status — 'confirmed' | 'pending' | 'cancelled'
 * @property {string} hotelName
 * @property {string} checkin
 * @property {string} checkout
 * @property {number} totalAmount
 * @property {string} currency
 * @property {string} [cancelledAt]
 * @property {string} [cancellationReason]
 */

/**
 * @typedef {object} ListBookingsParams
 * @property {string} [status] — filter by status
 */

/**
 * @typedef {object} CancelResult
 * @property {string} bookingId
 * @property {string} status — 'cancelled'
 */

export default {};

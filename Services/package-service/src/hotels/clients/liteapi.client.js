import axios from 'axios';
import AppError from '../../utils/appError.js';
import logger from '../../config/logger.js';
import { BAD_REQUEST, SERVICE_UNAVAILABLE } from '../../constants/httpStatus.js';
import {
  HOTEL_ID_REQUIRED,
  OFFER_ID_REQUIRED,
  PREBOOK_ID_REQUIRED,
  BOOKING_ID_REQUIRED,
  GUESTS_REQUIRED,
  CONTACT_EMAIL_REQUIRED,
  CONTACT_PHONE_REQUIRED,
  HOTELS_NOT_CONFIGURED,
  hotelProviderFailure,
} from '../../constants/errorMessages.js';

/**
 * @implements {import('./interface.js').HotelApiClient}
 *
 * LiteAPI hotel booking integration.
 * Auth: x-api-key header (API key)
 * Search/Data: https://api.liteapi.travel/v3.0 (search, hotel details)
 * Booking:     https://book.liteapi.travel/v3.0 (prebook, book, cancel)
 */
export class LiteApiClient {
  constructor() {
    this.#ensureConfig();
    console.info('[package-service] Using LiteApiClient — real hotel API integration.');
  }

  /** @param {import('./interface.js').HotelSearchParams} params */
  async searchHotels(params) {
    try {
      const occupancies = (params.occupancies || [{ adults: 1 }]).map((occupancy) => {
        if (typeof occupancy.children === 'number' && occupancy.children > 0) {
          throw new AppError('Enter each child age to search accurate rates.', BAD_REQUEST);
        }
        return {
          adults: occupancy.adults || 1,
          children: Array.isArray(occupancy.children) ? occupancy.children : [],
        };
      });

      const body = {
        checkin: params.checkin,
        checkout: params.checkout,
        currency: params.currency || 'USD',
        guestNationality: params.guestNationality,
        occupancies,
        limit: params.limit || 200,
        maxRatesPerHotel: params.maxRatesPerHotel || (params.hotelIds?.length ? 500 : occupancies.length),
        timeout: params.timeout || 6,
        includeHotelData: true,
        ...(params.hotelName && { hotelName: params.hotelName }),
        ...(params.starRating?.length && { starRating: params.starRating }),
        ...(params.minRating != null && { minRating: params.minRating }),
        ...(params.minReviewsCount != null && { minReviewsCount: params.minReviewsCount }),
        ...(params.hotelTypeIds?.length && { hotelTypeIds: params.hotelTypeIds }),
        ...(params.chainIds?.length && { chainIds: params.chainIds }),
        ...(params.facilities?.length && { facilities: params.facilities }),
        ...(params.strictFacilityFiltering != null && { strictFacilityFiltering: params.strictFacilityFiltering }),
        ...(params.refundableRatesOnly && { refundableRatesOnly: true }),
        ...(params.boardType && { boardType: params.boardType }),
        ...(params.sort?.length && { sort: params.sort }),
        ...(params.hotelIds?.length && { hotelIds: params.hotelIds }),
        ...(params.hotelIds?.length && { roomMapping: true }),
      };

      // Location: pick one method based on what's provided
      if (params.city) {
        body.cityName = params.city;
        body.countryCode = params.country;
      } else if (params.latitude != null && params.longitude != null) {
        body.latitude = params.latitude;
        body.longitude = params.longitude;
        body.radius = params.radius || 10;
      } else if (params.iataCode) {
        body.iataCode = params.iataCode;
      }

      const { data } = await this.#client().post('/hotels/rates', body);
      return this.#normalizeOffers(data.data || [], data.hotels || []);
    } catch (err) {
      this.#unwrapError(err, 'search');
    }
  }

  /** @param {string} hotelId */
  async getHotelDetails(hotelId) {
    if (!hotelId) throw new AppError(HOTEL_ID_REQUIRED, BAD_REQUEST);
    try {
      const { data } = await this.#client().get('/data/hotel', { params: { hotelId } });
      return this.#normalizeDetails(data.data);
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  async getCountries() {
    try {
      const { data } = await this.#client().get('/data/countries');
      return (Array.isArray(data.data) ? data.data : [])
        .filter((country) => country.code && country.name)
        .map(({ code, name }) => ({ code, name }));
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  async getEsimPackages(countryCode) {
    if (!countryCode || !/^[A-Z]{2}$/i.test(countryCode)) {
      throw new AppError('countryCode must be a two-letter code', BAD_REQUEST);
    }
    try {
      const { data } = await this.#client().get(`/addons/esimply/packages/${countryCode.toUpperCase()}`);
      return (Array.isArray(data.data) ? data.data : []).map((item) => ({
        packageId: Number(item.package_id),
        name: item.name,
        dataSizeMb: Number(item.data_size_mb),
        validityDays: Number(item.validity_days),
        price: Number(item.calculated_price),
        currency: item.currency || 'USD',
      })).filter((item) => item.packageId > 0 && item.name && item.price > 0);
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  async getHotelFilterOptions() {
    try {
      const [facilityResponse, typeResponse, chainResponse] = await Promise.all([
        this.#client().get('/data/facilities'),
        this.#client().get('/data/hotelTypes'),
        this.#client().get('/data/chains'),
      ]);
      return {
        facilities: (facilityResponse.data.data || []).map((item) => ({ id: item.facility_id, name: item.facility })),
        hotelTypes: (typeResponse.data.data || []).map(({ id, name }) => ({ id, name })),
        chains: (chainResponse.data.data || []).map(({ id, name }) => ({ id, name })),
      };
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  async getCities(countryCode) {
    if (!countryCode) throw new AppError('countryCode is required', BAD_REQUEST);
    try {
      const { data } = await this.#client().get('/data/cities', { params: { countryCode } });
      return (Array.isArray(data.data) ? data.data : []).map((item) => item.city).filter(Boolean);
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  /** @param {string} hotelId @param {{limit?: number, offset?: number, getSentiment?: boolean}} params */
  async getHotelReviews(hotelId, params = {}) {
    if (!hotelId) throw new AppError(HOTEL_ID_REQUIRED, BAD_REQUEST);
    try {
      const { data } = await this.#client().get('/data/reviews', {
        params: { hotelId, limit: params.limit || 20, offset: params.offset || 0, getSentiment: params.getSentiment || false },
      });
      return {
        reviews: Array.isArray(data.data) ? data.data : [],
        total: data.total ?? (Array.isArray(data.data) ? data.data.length : 0),
        sentimentAnalysis: data.sentimentAnalysis || data.sentiment_analysis || null,
      };
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  /** @param {string[]} hotelIds */
  async getHotelsByIds(hotelIds) {
    if (!hotelIds?.length) return [];
    try {
      const { data } = await this.#client().get('/data/hotels', { params: { hotelIds: hotelIds.join(','), limit: hotelIds.length } });
      const list = Array.isArray(data.data) ? data.data : [];
      return list.map((h) => this.#normalizeDetails(h));
    } catch (err) {
      this.#unwrapError(err, 'details');
    }
  }

  /** @param {import('./interface.js').PrebookParams} params */
  async prebook(params) {
    if (!params.offerId) throw new AppError(OFFER_ID_REQUIRED, BAD_REQUEST);
    try {
      const { data } = await this.#bookClient().post('/rates/prebook', {
        offerId: params.offerId,
        usePaymentSdk: params.usePaymentSdk !== false,
        ...(params.voucherCode && { voucherCode: params.voucherCode }),
        ...(params.addons?.length && { addons: params.addons }),
      });
      const d = data.data;
      return {
        prebookId: d.prebookId,
        hotelId: d.hotelId,
        checkin: d.checkin,
        checkout: d.checkout,
        currency: d.currency,
        price: d.price,
        priceDifferencePercent: d.priceDifferencePercent,
        cancellationChanged: d.cancellationChanged,
        boardChanged: d.boardChanged,
        roomTypes: d.roomTypes || [],
        paymentTypes: d.paymentTypes || [],
        termsAndConditions: d.termsAndConditions || '',
        transactionId: d.transactionId,
        secretKey: d.secretKey,
        paymentEnvironment: process.env.LITEAPI_PAYMENT_ENVIRONMENT
          || (this._apiKey.startsWith('sand_') ? 'sandbox' : 'live'),
        addonsRequest: d.addonsRequest || [],
        addonsTotalAmount: Number(d.addonsTotalAmount) || 0,
        voucherCode: d.voucherCode || null,
        voucherTotalAmount: Number(d.voucherTotalAmount) || 0,
      };
    } catch (err) {
      this.#unwrapError(err, 'book');
    }
  }

  /** @param {import('./interface.js').BookParams} params */
  async book(params) {
    if (!params.prebookId) throw new AppError(PREBOOK_ID_REQUIRED, BAD_REQUEST);
    if (!params.guests?.length) throw new AppError(GUESTS_REQUIRED, BAD_REQUEST);
    if (!params.contact?.email) throw new AppError(CONTACT_EMAIL_REQUIRED, BAD_REQUEST);
    if (!params.contact?.phone) throw new AppError(CONTACT_PHONE_REQUIRED, BAD_REQUEST);

    const contactName = (params.contact.name || `${params.guests[0].firstName} ${params.guests[0].lastName}`).split(' ');

    const body = {
      prebookId: params.prebookId,
      ...(params.clientReference && { clientReference: params.clientReference }),
      holder: {
        firstName: params.holder?.firstName || contactName[0] || 'Guest',
        lastName: params.holder?.lastName || contactName.slice(1).join(' ') || 'User',
        email: params.contact.email,
          phone: params.contact.phone,
      },
      guests: params.guests.map((g, i) => ({
        occupancyNumber: g.occupancyNumber || i + 1,
        email: g.email || params.contact.email,
        phone: g.phone || params.contact.phone,
        firstName: g.firstName,
        lastName: g.lastName,
        ...(g.remarks && { remarks: g.remarks }),
      })),
      payment: params.payment || { method: params.paymentMethod || process.env.LITEAPI_PAYMENT_METHOD || 'ACC_CREDIT_CARD' },
    };

    try {
      const { data } = await this.#bookClient().post('/rates/book', body);
      return this.#normalizeBooking(data.data);
    } catch (err) {
      this.#unwrapError(err, 'book');
    }
  }

  /** @param {import('./interface.js').ListBookingsParams} params */
  async listBookings(params = {}) {
    try {
      const { data } = await this.#bookClient().get('/bookings');
      const bookings = Array.isArray(data.data) ? data.data : [];
      return bookings.map((b) => this.#normalizeBooking(b));
    } catch (err) {
      this.#unwrapError(err, 'list');
    }
  }

  /** @param {string} bookingId */
  async getBooking(bookingId) {
    if (!bookingId) throw new AppError(BOOKING_ID_REQUIRED, BAD_REQUEST);
    try {
      const { data } = await this.#bookClient().get(`/bookings/${bookingId}`);
      return this.#normalizeBooking(data.data);
    } catch (err) {
      this.#unwrapError(err, 'retrieve');
    }
  }

  /** @param {string} bookingId @param {string} [reason] */
  async cancelBooking(bookingId, reason) {
    if (!bookingId) throw new AppError(BOOKING_ID_REQUIRED, BAD_REQUEST);
    try {
      const { data } = await this.#bookClient().put(`/bookings/${bookingId}`);
      const result = data.data || {};
      return {
        bookingId: result.bookingId || bookingId,
        status: (result.status || '').toLowerCase(),
        cancellationFee: result.cancellation_fee ?? null,
        refundAmount: result.refund_amount ?? null,
        currency: result.currency || null,
      };
    } catch (err) {
      this.#unwrapError(err, 'cancel');
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  #ensureConfig() {
    if (!process.env.LITEAPI_API_KEY) {
      throw new AppError(HOTELS_NOT_CONFIGURED, SERVICE_UNAVAILABLE, { code: 'PROVIDER_UNAVAILABLE' });
    }
    this._apiKey = process.env.LITEAPI_API_KEY;
  }

  #client() {
    return axios.create({
      baseURL: 'https://api.liteapi.travel/v3.0',
      headers: {
        'x-api-key': this._apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  #bookClient() {
    return axios.create({
      baseURL: 'https://book.liteapi.travel/v3.0',
      headers: {
        'x-api-key': this._apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  #normalizeOffers(offers, hotels = []) {
    if (!Array.isArray(offers)) return [];
    const hotelData = new Map(hotels.map((hotel) => [hotel.id || hotel.hotelId, hotel]));
    return offers.map((hotel) => {
      const metadata = hotelData.get(hotel.hotelId) || {};
      const roomTypeGroups = (hotel.roomTypes || []).map((roomType) => {
        const normalizedRates = (roomType.rates || []).map((rate, index) => {
          const retail = rate.retailRate || {};
          const totalItem = Array.isArray(retail.total) ? retail.total[0] : retail.total;
          const taxes = Array.isArray(retail.taxesAndFees) ? retail.taxesAndFees : retail.taxesAndFees ? [retail.taxesAndFees] : [];
          const cancellationPolicies = rate.cancellationPolicies || {};

          return {
            offerId: roomType.offerId || rate.offerId,
            occupancyNumber: rate.occupancyNumber || index + 1,
            roomTypeId: roomType.roomTypeId || null,
            mappedRoomId: rate.mappedRoomId || roomType.mappedRoomId || null,
            roomType: rate.name || roomType.name || roomType.roomTypeId || 'Standard',
            boardType: rate.boardName || rate.boardType || 'Room Only',
            currency: totalItem?.currency || hotel.currency || 'USD',
            totalAmount: Number(totalItem?.amount ?? 0),
            taxes: taxes.map((tax) => ({
              description: tax.description || 'Tax or fee',
              amount: Number(tax.amount) || 0,
              currency: tax.currency || totalItem?.currency || hotel.currency || 'USD',
              included: tax.included ?? null,
            })),
            refundable: cancellationPolicies.refundableTag
              ? cancellationPolicies.refundableTag === 'RFN'
              : Array.isArray(cancellationPolicies)
                ? !cancellationPolicies.some((policy) => policy?.nonRefundable)
                : cancellationPolicies.nonRefundable == null ? null : !cancellationPolicies.nonRefundable,
            cancellationPolicies,
            maxOccupancy: rate.maxOccupancy || null,
            remarks: rate.remarks || '',
            paymentTypes: rate.paymentTypes || [],
            perks: rate.perks || [],
          };
        }).filter((rate) => rate.offerId);
        const offerRetailRate = Array.isArray(roomType.offerRetailRate)
          ? roomType.offerRetailRate[0]
          : roomType.offerRetailRate;
        const totalAmount = Number(offerRetailRate?.amount)
          || normalizedRates.reduce((sum, rate) => sum + rate.totalAmount, 0);
        return {
          rates: normalizedRates.map((rate) => ({ ...rate, offerTotalAmount: totalAmount })),
          totalAmount,
        };
      });
      const rates = roomTypeGroups.flatMap((group) => group.rates);
      const cheapestGroup = roomTypeGroups
        .filter((group) => group.rates.length > 0)
        .sort((left, right) => left.totalAmount - right.totalAmount)[0];
      const firstRate = cheapestGroup?.rates[0] || {};

      return {
        hotelId: hotel.hotelId,
        name: hotel.name || hotel.hotel?.name || metadata.name || 'Unknown',
        address: hotel.address || hotel.hotel?.address || metadata.address || null,
        starRating: hotel.starRating ?? hotel.hotel?.starRating ?? metadata.stars ?? 0,
        rating: hotel.rating ?? hotel.hotel?.rating ?? metadata.rating ?? null,
        reviewCount: hotel.reviewCount ?? hotel.hotel?.reviewCount ?? metadata.review_count ?? 0,
        images: hotel.photos || hotel.hotel?.photos || [metadata.main_photo, metadata.thumbnail].filter(Boolean),
        distance: hotel.distance || null,
        latitude: hotel.latitude ?? hotel.hotel?.location?.latitude ?? metadata.latitude ?? null,
        longitude: hotel.longitude ?? hotel.hotel?.location?.longitude ?? metadata.longitude ?? null,
        city: metadata.city_name || null,
        country: metadata.country_code || null,
        cheapestRate: {
          ...firstRate,
          totalAmount: cheapestGroup?.totalAmount ?? firstRate.totalAmount,
          roomType: cheapestGroup?.rates.length > 1 ? `${cheapestGroup.rates.length} rooms` : firstRate.roomType,
          boardType: cheapestGroup?.rates.length > 1 ? 'Multiple room rates' : firstRate.boardType,
        },
        rates,
      };
    });
  }

  #normalizeDetails(d) {
    if (!d) return null;
    const images = d.hotelImages?.map((img) => img.urlHd || img.url).filter(Boolean) || [];
    if (d.main_photo) images.unshift(d.main_photo);
    return {
      hotelId: d.hotelId || d.id,
      name: d.name || 'Unknown',
      address: d.address || null,
      city: d.city || null,
      country: d.country || null,
      postalCode: d.zip || null,
      starRating: d.starRating ?? 0,
      images: [...new Set(images)],
      amenities: d.hotelFacilities?.length ? d.hotelFacilities : d.facilities || [],
      phone: d.phone || null,
      checkinTime: d.checkinCheckoutTimes?.checkin_start || d.checkinCheckoutTimes?.checkin || d.checkInTime || null,
      checkoutTime: d.checkinCheckoutTimes?.checkout || d.checkOutTime || null,
      description: d.normalizedDescription || d.markdownDescription || d.hotelDescription || d.description || null,
      importantInformation: d.hotelImportantInformation || null,
      hotelType: d.hotelType || null,
      chain: d.chain || null,
      policies: (d.policies || []).map((policy) => ({
        name: policy.name || policy.policy_type || 'Policy',
        description: policy.description || '',
      })),
      rating: d.rating ?? null,
      reviewCount: d.reviewCount ?? 0,
      rooms: (d.rooms || []).map((room) => ({
        roomId: room.id,
        name: room.roomTitle || room.roomName || 'Room',
        description: room.markdownDescription || room.normalizedDescription || room.description || '',
        size: room.roomSizeSquare || null,
        sizeUnit: room.roomSizeUnit || null,
        maxAdults: room.maxAdults ?? null,
        maxChildren: room.maxChildren ?? null,
        maxOccupancy: room.maxOccupancy ?? null,
        bedTypes: room.bedTypes || [],
        amenities: (room.roomAmenities || []).map((amenity) => amenity.name).filter(Boolean),
        images: (room.photos || []).map((photo) => photo.hd_url || photo.url).filter(Boolean),
      })),
      latitude: d.location?.latitude ?? d.latitude ?? null,
      longitude: d.location?.longitude ?? d.longitude ?? null,
      checkinInstructions: d.checkinCheckoutTimes?.instructions || [],
      specialInstructions: d.checkinCheckoutTimes?.special_instructions || '',
      sentimentAnalysis: d.sentiment_analysis || null,
      securityDeposit: d.securityDeposit || null,
    };
  }

  #normalizeBooking(b) {
    return {
      bookingId: b.bookingId || b.id,
      clientReference: b.clientReference || b.client_reference || null,
      supplierBookingId: b.supplierBookingId || null,
      supplierBookingName: b.supplierBookingName || null,
      supplier: b.supplier || null,
      supplierId: b.supplierId ?? null,
      feed: b.feed || null,
      pnr: b.hotelConfirmationCode || b.pnr || b.confirmationCode || null,
      hotelConfirmationCode: b.hotelConfirmationCode || null,
      status: (b.status || 'CONFIRMED').toLowerCase(),
      hotelId: b.hotelId || b.hotel?.hotelId || null,
      hotelName: b.hotelName || b.hotel?.name || b.Hotel_name || 'Unknown',
      address: b.hotel?.address || b.address || null,
      checkin: b.checkin || b.checkIn || null,
      checkout: b.checkout || b.checkOut || null,
      totalAmount: Number(b.price ?? b.totalAmount ?? b.total ?? b.retail_rate ?? 0),
      currency: b.currency || 'USD',
      commission: Number(b.commission ?? b.clientCommission ?? 0),
      distributorCommission: Number(b.distributorCommission ?? 0),
      distributorPrice: Number(b.distributorPrice ?? 0),
      processingFee: Number(b.processingFee ?? 0),
      paymentStatus: b.paymentStatus || null,
      paymentTransactionId: b.paymentTransactionId || null,
      paymentScheduledAt: b.paymentScheduledAt || null,
      lastFreeCancellationDate: b.lastFreeCancellationDate || null,
      refundableTag: b.tag || b.cancellationPolicies?.refundableTag || null,
      mandatoryFees: b.mandatoryFees || null,
      optionalFees: b.optionalFees || null,
      specialRemarks: b.specialRemarks || null,
      knowBeforeYouGo: b.knowBeforeYouGo || null,
      addons: Array.isArray(b.addons) ? b.addons : [],
      addonsTotalAmount: Number(b.addonsTotalAmount) || 0,
      voucherCode: b.voucherCode || null,
      voucherTotalAmount: Number(b.voucherTotalAmount) || 0,
      voucherId: b.voucherId ?? null,
      voucherTransactionId: b.voucherTransactionId || b.voucherTransationId || null,
      sellingPrice: b.sellingPrice ?? null,
      exchangeRate: Number(b.exchangeRate) || 0,
      exchangeRateUsd: Number(b.exchangeRateUsd) || 0,
      nationality: b.nationality || null,
      holderTitle: b.holderTitle || null,
      firstName: b.firstName || null,
      lastName: b.lastName || null,
      email: b.email || null,
      adults: Number(b.adults) || 0,
      children: b.children ?? null,
      childrenCount: Number(b.childrenCount) || 0,
      amountRefunded: Number(b.amountRefunded) || 0,
      refundType: b.refundType || null,
      createdAt: b.createdAt || null,
      updatedAt: b.updatedAt || null,
      cancelledAt: b.cancelledAt || null,
      refundedAt: b.refundedAt || null,
      cancellationReason: b.cancellationReason || null,
      cancellationPolicies: b.cancellationPolicies || null,
      bookedRooms: b.bookedRooms || b.rooms || [],
      holder: b.holder || null,
      goodwillPayment: b.goodwillPayment || null,
      customTags: b.customTags || null,
    };
  }

  /**
   * Turns a provider failure into a user-facing AppError.
   *
   * LiteAPI returns its error body as an object, which used to be JSON.stringify'd
   * into the message a user read. The payload is logged here instead, and what
   * reaches the caller is a sentence written for a traveller plus a status that
   * matches the situation — previously every provider failure surfaced as a 500,
   * including a hotel that simply no longer exists.
   *
   * @param {unknown} err
   * @param {'search'|'details'|'book'|'retrieve'|'list'|'cancel'} operation
   */
  #unwrapError(err, operation) {
    if (err instanceof AppError) throw err;

    logger.error(
      { status: err.response?.status, data: err.response?.data, operation },
      'LiteAPI error details',
    );

    const { statusCode, code, message } = hotelProviderFailure(operation, err.response?.status);
    throw new AppError(message, statusCode, { code });
  }
}

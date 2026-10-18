function futureStay() {
  const checkin = new Date();
  checkin.setDate(checkin.getDate() + 30);
  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + 4);
  return {
    checkin: checkin.toISOString().slice(0, 10),
    checkout: checkout.toISOString().slice(0, 10),
  };
}

/**
 * @implements {import('./interface.js').HotelApiClient}
 *
 * Deterministic mock hotel provider for development and testing.
 * Returns realistic fake data with no network calls.
 */
export class MockHotelClient {
  constructor() {
    this.hotels = Object.freeze([
      { name: 'Grand Hyatt', starRating: 5, roomTypes: ['Deluxe King', 'Executive Suite'] },
      { name: 'Marriott Marquis', starRating: 4, roomTypes: ['Standard Double', 'Premium King'] },
      { name: 'Hilton Garden Inn', starRating: 3, roomTypes: ['Queen Room', 'Twin Room'] },
      { name: 'InterContinental', starRating: 5, roomTypes: ['Club Room', 'Presidential Suite'] },
      { name: 'Radisson Blu', starRating: 4, roomTypes: ['Superior Room', 'Junior Suite'] },
    ]);
    console.info('[package-service] Using MockHotelClient — no external API calls.');
  }

  /**
   * @param {import('./interface.js').HotelSearchParams} params
   * @returns {Promise<import('./interface.js').HotelOffer[]>}
   */
  async searchHotels({ latitude = 6.9271, longitude = 79.8612, radius = 10, radiusUnit = 'km', checkin, checkout, occupancies = [{ adults: 1 }], limit = 20, hotelIds }) {
    if (!checkin || !checkout) {
      throw new Error('checkin and checkout are required');
    }

    const totalGuests = occupancies.reduce((sum, occupancy) =>
      sum + (occupancy.adults || 0) + (Array.isArray(occupancy.children) ? occupancy.children.length : occupancy.children || 0), 0);
    const factor = totalGuests > 1 ? totalGuests * 0.8 : 1;

    const offers = this.hotels.map((h, i) => {
      const distKm = 0.3 + i * 1.7;
      const latOffset = (Math.random() - 0.5) * 0.02;
      const lngOffset = (Math.random() - 0.5) * 0.02;
      const basePrice = 80 + i * 45;

      const cheapestRate = {
        roomType: h.roomTypes[0],
        boardType: i % 2 === 0 ? 'Bed & Breakfast' : 'Room Only',
        currency: 'USD',
        totalAmount: Math.round(basePrice * factor * 100) / 100,
        taxes: Math.round(basePrice * factor * 0.12 * 100) / 100,
        refundable: i % 3 !== 0,
        offerId: `MOCK-OFFER-${i + 1}`,
      };
      const rates = [
        cheapestRate,
        {
          ...cheapestRate,
          roomType: h.roomTypes[1],
          totalAmount: Math.round((basePrice + 45) * factor * 100) / 100,
          offerId: `MOCK-OFFER-${i + 1}-2`,
        },
      ];

      return {
        hotelId: `MOCK-HOTEL-${i + 1}`,
        name: h.name,
        address: `${100 + i * 50} Main Street, City Center`,
        starRating: h.starRating,
        images: [`https://picsum.photos/seed/hotel${i}/400/300`],
        distance: parseFloat(distKm.toFixed(1)),
        latitude: parseFloat((latitude + latOffset).toFixed(4)),
        longitude: parseFloat((longitude + lngOffset).toFixed(4)),
        cheapestRate,
        rates,
      };
    });

    return hotelIds?.length ? offers.filter((offer) => hotelIds.includes(offer.hotelId)) : offers;
  }

  /**
   * @param {string} hotelId
   * @returns {Promise<import('./interface.js').HotelDetails>}
   */
  async getHotelDetails(hotelId) {
    if (!hotelId) throw new Error('hotelId is required');

    const idx = parseInt(hotelId.replace('MOCK-HOTEL-', ''), 10) - 1;
    const h = this.hotels[idx % this.hotels.length];

    return {
      hotelId,
      name: h.name,
      address: `${100 + idx * 50} Main Street, City Center`,
      starRating: h.starRating,
      images: [
        `https://picsum.photos/seed/${hotelId}-1/800/600`,
        `https://picsum.photos/seed/${hotelId}-2/800/600`,
      ],
      amenities: ['Free WiFi', 'Pool', 'Gym', 'Restaurant', 'Room Service', 'Parking'],
      checkinTime: '14:00',
      checkoutTime: '12:00',
      description: `${h.name} offers luxurious accommodation in the heart of the city with world-class amenities and exceptional service.`,
      policies: ['No smoking', 'Pets not allowed', 'Credit card required at check-in'],
      rooms: h.roomTypes.map((name, roomId) => ({
        roomId,
        name,
        maxOccupancy: 2,
        bedTypes: [{ quantity: 1, bedType: roomId === 0 ? 'Queen bed' : 'King bed' }],
        amenities: ['Air conditioning', 'Private bathroom', 'Wi-Fi'],
      })),
      latitude: 6.9271 + idx * 0.005,
      longitude: 79.8612 + idx * 0.003,
    };
  }

  async getHotelReviews() {
    return { reviews: [], total: 0, sentimentAnalysis: null };
  }

  async getCities(countryCode) {
    return countryCode === 'LK' ? ['Colombo', 'Kandy', 'Galle', 'Negombo'] : [];
  }

  async getCountries() {
    return [
      { code: 'AE', name: 'United Arab Emirates' },
      { code: 'FR', name: 'France' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'LK', name: 'Sri Lanka' },
      { code: 'US', name: 'United States' },
    ];
  }

  async getEsimPackages() {
    return [];
  }

  async getHotelFilterOptions() {
    return {
      facilities: [{ id: 1, name: 'Free WiFi' }, { id: 2, name: 'Pool' }, { id: 3, name: 'Restaurant' }],
      hotelTypes: [{ id: 201, name: 'Hotels' }, { id: 204, name: 'Resorts' }],
      chains: [],
    };
  }

  /**
   * @param {import('./interface.js').PrebookParams} params
   * @returns {Promise<import('./interface.js').PrebookResult>}
   */
  async prebook({ offerId }) {
    if (!offerId) throw new Error('offerId is required');

    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return {
      prebookId: `MOCK-PREBOOK-${suffix}`,
      status: 'valid',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  /**
   * @param {import('./interface.js').BookParams} params
   * @returns {Promise<import('./interface.js').BookingResult>}
   */
  async book({ prebookId, guests, contact, holder }) {
    if (!prebookId) throw new Error('prebookId is required');
    if (!guests?.length) throw new Error('At least one guest is required');
    if (!holder?.email && !contact?.email) throw new Error('holder.email is required');

    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const stay = futureStay();
    return {
      bookingId: `MOCK-BOOK-${suffix}`,
      pnr: `HTL${suffix}`,
      status: 'confirmed',
      hotelName: 'Mock Hotel',
      checkin: stay.checkin,
      checkout: stay.checkout,
      totalAmount: 250.00,
      currency: 'USD',
    };
  }

  /**
   * @param {import('./interface.js').ListBookingsParams} params
   * @returns {Promise<import('./interface.js').BookingResult[]>}
   */
  async listBookings(params = {}) {
    const base = [
      { bookingId: 'MOCK-BOOK-A1B2C3', pnr: 'HTLABC', status: 'confirmed', hotelName: 'Grand Hyatt', checkin: '2026-08-01', checkout: '2026-08-05', totalAmount: 450, currency: 'USD' },
      { bookingId: 'MOCK-BOOK-D4E5F6', pnr: 'HTLDEF', status: 'cancelled', hotelName: 'Radisson Blu', checkin: '2026-07-15', checkout: '2026-07-18', totalAmount: 320, currency: 'USD', cancelledAt: '2026-07-10T10:00:00Z' },
    ];

    if (params.status) return base.filter((b) => b.status === params.status);
    return base;
  }

  /**
   * @param {string} bookingId
   * @returns {Promise<import('./interface.js').BookingResult>}
   */
  async getBooking(bookingId) {
    if (!bookingId) throw new Error('bookingId is required');
    const stay = futureStay();
    return {
      bookingId,
      pnr: 'HTL' + bookingId.slice(-6),
      status: 'confirmed',
      hotelName: 'Grand Hyatt',
      checkin: stay.checkin,
      checkout: stay.checkout,
      totalAmount: 450,
      currency: 'USD',
    };
  }

  /**
   * @param {string} bookingId
   * @param {string} [reason]
   * @returns {Promise<import('./interface.js').CancelResult>}
   */
  async cancelBooking(bookingId, reason) {
    if (!bookingId) throw new Error('bookingId is required');
    return { bookingId, status: 'cancelled' };
  }
}

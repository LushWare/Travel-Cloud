import { faker } from '@faker-js/faker';

export function buildHotelOffer(overrides = {}) {
  const rate = overrides.cheapestRate || {};
  return {
    hotelId: overrides.hotelId || faker.string.uuid(),
    name: overrides.name || faker.company.name() + ' Hotel',
    address: overrides.address || faker.location.streetAddress(),
    starRating: overrides.starRating ?? faker.number.int({ min: 2, max: 5 }),
    images: overrides.images || [faker.image.urlPicsumPhotos()],
    distance: overrides.distance ?? faker.number.float({ min: 0.1, max: 15, fractionDigits: 1 }),
    latitude: overrides.latitude ?? faker.location.latitude(),
    longitude: overrides.longitude ?? faker.location.longitude(),
    cheapestRate: {
      offerId: rate.offerId || faker.string.uuid(),
      roomType: rate.roomType || 'Deluxe King',
      boardType: rate.boardType || 'Bed & Breakfast',
      currency: rate.currency || 'USD',
      totalAmount: rate.totalAmount ?? faker.number.float({ min: 80, max: 500, fractionDigits: 2 }),
      taxes: rate.taxes ?? faker.number.float({ min: 10, max: 80, fractionDigits: 2 }),
      refundable: rate.refundable ?? true,
    },
  };
}

export function buildHotelOffers(count = 3, baseOverrides = {}) {
  return Array.from({ length: count }, (_, i) => buildHotelOffer({ ...baseOverrides, hotelId: `hotel-${i + 1}` }));
}

export function buildSearchRequest(overrides = {}) {
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const checkout = new Date(); checkout.setDate(checkout.getDate() + 4);
  return {
    city: overrides.city || 'Colombo',
    country: overrides.country || 'LK',
    checkin: overrides.checkin || new Date().toISOString().split('T')[0],
    checkout: overrides.checkout || checkout.toISOString().split('T')[0],
    occupancies: overrides.occupancies || [{ adults: 1, children: [] }],
    currency: overrides.currency || 'USD',
    guestNationality: overrides.guestNationality || 'LK',
    limit: overrides.limit ?? 10,
  };
}

export function buildGuest(overrides = {}) {
  return {
    occupancyNumber: overrides.occupancyNumber ?? 1,
    firstName: overrides.firstName || faker.person.firstName(),
    lastName: overrides.lastName || faker.person.lastName(),
    email: overrides.email || faker.internet.email().toLowerCase(),
  };
}

export function buildBookingRequest(overrides = {}) {
  return {
    prebookId: overrides.prebookId || 'prebook-mock-001',
    guests: overrides.guests || [buildGuest()],
    contact: overrides.contact || {
      name: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      phone: faker.phone.number(),
    },
    offer: overrides.offer || buildHotelOffer(),
  };
}

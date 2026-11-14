import { describe, it, expect } from 'vitest';
import {
  searchSchema, priceSchema, bookSchema,
  cancelBookingSchema, listBookingsQuerySchema, bookingIdParamSchema,
  leadIdParamSchema, leadBookSchema, offerIdParamSchema,
} from '../flight.schema.js';

describe('searchSchema', () => {
  it('should pass a valid one-way search', () => {
    const result = searchSchema.safeParse({
      origin: 'CMB', destination: 'DXB', departureDate: '2026-08-01',
      adults: 2, cabinClass: 'Business', tripType: 'oneWay',
    });
    expect(result.success).toBe(true);
    expect(result.data.adults).toBe(2);
    expect(result.data.children).toBe(0);
    expect(result.data.cabinClass).toBe('Business');
  });

  it('should apply defaults', () => {
    const result = searchSchema.safeParse({
      origin: 'LHR', destination: 'JFK', departureDate: '2026-09-01',
    });
    expect(result.success).toBe(true);
    expect(result.data.adults).toBe(1);
    expect(result.data.children).toBe(0);
    expect(result.data.infants).toBe(0);
    expect(result.data.cabinClass).toBe('Economy');
    expect(result.data.tripType).toBe('oneWay');
  });

  it('should reject same origin and destination', () => {
    const result = searchSchema.safeParse({
      origin: 'DXB', destination: 'DXB', departureDate: '2026-08-01',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('different');
  });

  it('should reject invalid IATA codes', () => {
    const result = searchSchema.safeParse({
      origin: 'XX', destination: 'dubai', departureDate: '2026-08-01',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const result = searchSchema.safeParse({ origin: 'CMB' });
    expect(result.success).toBe(false);
  });
});

describe('priceSchema', () => {
  it('should pass with a valid offerId', () => {
    expect(priceSchema.safeParse({ offerId: 'off_123' }).success).toBe(true);
  });

  it('should reject empty offerId', () => {
    expect(priceSchema.safeParse({ offerId: '' }).success).toBe(false);
  });
});

describe('offerIdParamSchema', () => {
  it('accepts a Duffel offer ID', () => {
    expect(offerIdParamSchema.safeParse({ offerId: 'off_abc123' }).success).toBe(true);
  });

  it('accepts an ID produced by the mock flight provider', () => {
    expect(offerIdParamSchema.safeParse({ offerId: 'MOCK-OFFER-DXBLHR-2026-11-14-0' }).success).toBe(true);
  });

  it('rejects unknown offer ID formats', () => {
    expect(offerIdParamSchema.safeParse({ offerId: 'MOCK-OFFER-invalid' }).success).toBe(false);
  });
});

describe('bookSchema', () => {
  it('should pass a valid booking', () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'off_123', airline: 'EK', fareTotal: 300 },
      tripType: 'oneWay',
      travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe' }],
      contact: { name: 'John', email: 'john@test.com' },
    });
    expect(result.success).toBe(true);
    expect(result.data.offer.airline).toBe('EK');
  });

  it('should reject empty travelers', () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'X' },
      travelers: [],
      contact: { email: 'a@b.com' },
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toContain('At least one traveler');
  });

  it('should reject missing firstName', () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'X' },
      travelers: [{ type: 'adult', lastName: 'Doe' }],
      contact: { email: 'a@b.com' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid contact email', () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'X' },
      travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe' }],
      contact: { email: 'not-an-email' },
    });
    expect(result.success).toBe(false);
  });

  // Without this field travelling through, DuffelClient calls createOrder with
  // its own invented pas_<idx> ids and the provider answers 422.
  it("keeps the offer's passenger id on a traveler", () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'off_1' },
      travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe', passengerId: 'pas_0001' }],
      contact: { email: 'john@test.com' },
    });
    expect(result.success).toBe(true);
    expect(result.data.travelers[0].passengerId).toBe('pas_0001');
  });

  it('rejects an empty passenger id', () => {
    const result = bookSchema.safeParse({
      offer: { offerId: 'off_1' },
      travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe', passengerId: '' }],
      contact: { email: 'john@test.com' },
    });
    expect(result.success).toBe(false);
  });
});

describe('cancelBookingSchema', () => {
  it('should pass with reason', () => {
    expect(cancelBookingSchema.safeParse({ reason: 'Cancelled by agent' }).success).toBe(true);
  });

  it('should pass with empty body', () => {
    expect(cancelBookingSchema.safeParse({}).success).toBe(true);
  });
});

describe('listBookingsQuerySchema', () => {
  it('should pass with valid status', () => {
    expect(listBookingsQuerySchema.safeParse({ status: 'confirmed' }).success).toBe(true);
  });

  it('should reject invalid status', () => {
    expect(listBookingsQuerySchema.safeParse({ status: 'invalid' }).success).toBe(false);
  });

  it('should pass with no params', () => {
    expect(listBookingsQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('bookingIdParamSchema', () => {
  it('should accept valid UUID', () => {
    expect(bookingIdParamSchema.safeParse({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }).success).toBe(true);
  });

  it('should accept a hand-crafted seed-style ID with non-v4 version/variant nibbles', () => {
    // e.g. Services/seed-extended.mjs's readable convention — a valid Prisma
    // primary key, just not something crypto.randomUUID() would ever produce.
    expect(bookingIdParamSchema.safeParse({ id: 'e0000000-0000-0000-0000-00000000000c' }).success).toBe(true);
  });

  it('should reject non-UUID-shaped strings', () => {
    expect(bookingIdParamSchema.safeParse({ id: 'b1' }).success).toBe(false);
  });
});

describe('leadIdParamSchema', () => {
  it('should accept a real UUID', () => {
    expect(leadIdParamSchema.safeParse({ leadId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }).success).toBe(true);
  });

  it('should accept a hand-crafted seed-style lead ID', () => {
    expect(leadIdParamSchema.safeParse({ leadId: 'd0000000-0000-0000-0000-00000000000c' }).success).toBe(true);
  });

  it('should reject a non-UUID-shaped string', () => {
    const result = leadIdParamSchema.safeParse({ leadId: 'not-a-real-id' });
    expect(result.success).toBe(false);
  });

  it('should reject a missing leadId', () => {
    expect(leadIdParamSchema.safeParse({}).success).toBe(false);
  });
});

describe('leadBookSchema — cross-service IDs', () => {
  const validBook = {
    offer: { offerId: 'offer-1' },
    travelers: [{ type: 'adult', firstName: 'Jane', lastName: 'Doe' }],
    contact: { email: 'jane@example.com' },
  };

  it('accepts seed-style leadId/packageId/customizedPackageId', () => {
    const result = leadBookSchema.safeParse({
      ...validBook,
      leadId: 'd0000000-0000-0000-0000-00000000000c',
      packageId: 'b0000000-0000-0000-0000-000000000001',
      customizedPackageId: 'b0000000-0000-0000-0000-000000000002',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a garbage leadId', () => {
    const result = leadBookSchema.safeParse({ ...validBook, leadId: 'nope' });
    expect(result.success).toBe(false);
  });
});

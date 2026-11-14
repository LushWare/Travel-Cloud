import { describe, it, expect } from 'vitest';
import { MockFlightClient } from '../mock.client.js';

describe('MockFlightClient', () => {
  const client = new MockFlightClient();

  describe('searchFlights', () => {
    it('should return 5 offers for a valid search', async () => {
      const offers = await client.searchFlights({
        origin: 'CMB',
        destination: 'DXB',
        departureDate: '2026-08-01',
        adults: 2,
      });

      expect(offers).toHaveLength(5);
      expect(offers[0]).toHaveProperty('offerId');
      expect(offers[0]).toHaveProperty('airline');
      expect(offers[0]).toHaveProperty('segments');
      expect(offers[0].segments).toHaveLength(1);
      expect(offers[0].legCount).toBe(1);
    });

    it('should include return segment for round trip', async () => {
      const offers = await client.searchFlights({
        origin: 'CMB',
        destination: 'DXB',
        departureDate: '2026-08-01',
        returnDate: '2026-08-15',
      });

      expect(offers[0].segments).toHaveLength(2);
      expect(offers[0].legCount).toBe(2);
    });

    it('should multiply fare by passenger count', async () => {
      const solo = await client.searchFlights({
        origin: 'CMB', destination: 'DXB', departureDate: '2026-08-01', adults: 1,
      });
      const family = await client.searchFlights({
        origin: 'CMB', destination: 'DXB', departureDate: '2026-08-01',
        adults: 2, children: 1,
      });

      // 3 pax fare should be 3x 1 pax fare for the same offer
      const ratio = family[0].baseFare / solo[0].baseFare;
      expect(ratio).toBeCloseTo(3, 0);
    });

    it('should reject when required fields are missing', async () => {
      await expect(
        client.searchFlights({ origin: 'CMB', destination: '', departureDate: '2026-08-01' }),
      ).rejects.toThrow('origin');
    });
  });

  describe('priceOffer', () => {
    it('should return revalidated result', async () => {
      const result = await client.priceOffer('OFFER-1');
      expect(result).toEqual({
        offerId: 'OFFER-1',
        revalidated: true,
        priceChanged: false,
      });
    });

    it('should reject when offerId is missing', async () => {
      await expect(client.priceOffer('')).rejects.toThrow('offerId');
    });
  });

  describe('getCheckoutData', () => {
    it('returns mock checkout data for a mock offer', async () => {
      const offers = await client.searchFlights({
        origin: 'CMB',
        destination: 'DXB',
        departureDate: '2026-08-01',
        adults: 2,
      });

      const checkout = await client.getCheckoutData(offers[0].offerId);

      expect(checkout.provider).toBe('mock');
      expect(checkout.offer.id).toBe(offers[0].offerId);
      expect(checkout.offer.passengers).toHaveLength(22);
      expect(checkout.seatMaps).toEqual([]);
      expect(checkout.upsellOffers).toEqual([]);
      expect(checkout.cardCheckoutEnabled).toBe(false);
    });

    it('rejects IDs that are not mock offers', async () => {
      await expect(client.getCheckoutData('off_123')).rejects.toThrow('Invalid mock offer ID');
    });
  });

  describe('createOrder', () => {
    it('should return a mock PNR and order ID', async () => {
      const result = await client.createOrder({
        offerId: 'OFF-1',
        travelers: [{ type: 'adult', firstName: 'A', lastName: 'B' }],
        contact: { email: 'a@b.com' },
      });

      expect(result.pnr).toMatch(/^MOCK/);
      expect(result.travelportOrderId).toMatch(/^MOCK-ORDER-/);
      expect(result.status).toBe('confirmed');
      expect(result.ticketingDeadline).toBeTruthy();
    });

    it('should reject when travelers is empty', async () => {
      await expect(
        client.createOrder({ offerId: 'X', travelers: [], contact: { email: 'a@b.com' } }),
      ).rejects.toThrow('traveler');
    });
  });

  describe('cancelOrder', () => {
    it('should return cancelled status', async () => {
      const result = await client.cancelOrder('ORDER-1');
      expect(result).toEqual({
        travelportOrderId: 'ORDER-1',
        status: 'cancelled',
      });
    });
  });

  describe('getFlightDetails', () => {
    it('should return mock flight details', async () => {
      const details = await client.getFlightDetails({
        flightNumber: 'EK502',
        departureDate: '2026-08-01',
      });

      expect(details.flightNumber).toBe('EK502');
      expect(details.status).toBe('ON_TIME');
      expect(details.aircraft.code).toBe('77W');
      expect(details.departure.terminal).toBe('3');
      expect(details.baggage.checked).toBe('30kg');
    });
  });
});

/**
 * Flight API Service
 * Handles Travelport-backed flight search, pricing and booking calls
 */

import api from './api';

class FlightService {
  constructor() {
    this.api = api;
  }

  async search(params) {
    try {
      return await this.api.post('/flights/search', params);
    } catch (error) {
      console.error('Error searching flights:', error);
      throw error;
    }
  }

  async priceOffer(offerId, checkout = {}) {
    try {
      return await this.api.post('/flights/price', { offerId, ...checkout });
    } catch (error) {
      console.error('Error pricing flight offer:', error);
      throw error;
    }
  }

  async getCheckoutData(offerId) {
    try {
      return await this.api.get(`/flights/offers/${encodeURIComponent(offerId)}/checkout`);
    } catch (error) {
      console.error('Error loading flight checkout options:', error);
      throw error;
    }
  }

  async createLinksSession(params = {}) {
    try {
      return await this.api.post('/flights/links/session', params);
    } catch (error) {
      console.error('Error creating Duffel Links session:', error);
      throw error;
    }
  }

  async book(payload) {
    try {
      return await this.api.post('/flights/book', payload);
    } catch (error) {
      console.error('Error booking flight:', error);
      throw error;
    }
  }

  async listBookings(params = {}) {
    try {
      return await this.api.get('/flights/bookings', params);
    } catch (error) {
      console.error('Error fetching flight bookings:', error);
      throw error;
    }
  }

  async getBooking(id) {
    try {
      return await this.api.get(`/flights/bookings/${id}`);
    } catch (error) {
      console.error('Error fetching flight booking:', error);
      throw error;
    }
  }

  async cancelBooking(id, reason) {
    try {
      const payload = typeof reason === 'object' && reason !== null ? reason : { reason };
      return await this.api.post(`/flights/bookings/${id}/cancel`, payload);
    } catch (error) {
      console.error('Error cancelling flight booking:', error);
      throw error;
    }
  }

  async createCancellationQuote(id, reason) {
    try {
      return await this.api.post(`/flights/bookings/${id}/cancellation-quote`, { reason });
    } catch (error) {
      console.error('Error requesting flight cancellation quote:', error);
      throw error;
    }
  }

  // ── Lead-scoped endpoints ───────────────────────────────────────

  async bookForLead(payload) {
    try {
      return await this.api.post('/flights/book-for-lead', payload);
    } catch (error) {
      console.error('Error booking flight for lead:', error);
      throw error;
    }
  }

  async getByLead(leadId) {
    try {
      return await this.api.get(`/flights/bookings/by-lead/${leadId}`);
    } catch (error) {
      console.error('Error fetching lead flight bookings:', error);
      throw error;
    }
  }

  async getOptionalFlights(leadId) {
    try {
      return await this.api.get(`/flights/bookings/by-lead/${leadId}/optional-flights`);
    } catch (error) {
      console.error('Error fetching optional flights:', error);
      throw error;
    }
  }

  async getItineraryFlights(leadId) {
    try {
      return await this.api.get(`/flights/bookings/by-lead/${leadId}/itinerary-flights`);
    } catch (error) {
      console.error('Error fetching itinerary flight segments:', error);
      throw error;
    }
  }

  async linkToDay(bookingId, payload) {
    try {
      return await this.api.patch(`/flights/bookings/${bookingId}/link-day`, payload);
    } catch (error) {
      console.error('Error linking flight to day:', error);
      throw error;
    }
  }
}

export const flightAPI = new FlightService();
export default flightAPI;

import api from './api';

const HotelService = {
  async search(params) { return api.post('/hotels/search', params); },
  async getDetails(hotelId) { return api.post('/hotels/details', { hotelId }); },
  async getReviews(params) { return api.post('/hotels/reviews', params); },
  async getCountries() { return api.get('/hotels/countries'); },
  async getCities(countryCode) { return api.get('/hotels/cities', { countryCode }); },
  async getEsimPackages(countryCode) { return api.get(`/hotels/addons/esimply/packages/${countryCode}`); },
  async getEsimPackages(countryCode) { return api.get(`/hotels/addons/esimply/packages/${countryCode}`); },
  async getFilterOptions() { return api.get('/hotels/filter-options'); },
  async prebook(params) { return api.post('/hotels/prebook', params); },
  async book(params) { return api.post('/hotels/book', params); },
  async bookWithContext(params) { return api.post('/hotels/book-with-context', params); },
  async listBookings(params) { return api.get('/hotels/bookings', params); },
  async getBooking(id) { return api.get(`/hotels/bookings/${id}`); },
  async cancelBooking(id, reason) { return api.post(`/hotels/bookings/${id}/cancel`, { reason }); },
  async getByLead(leadId) { return api.get(`/hotels/bookings/by-lead/${leadId}`); },
};

export default HotelService;
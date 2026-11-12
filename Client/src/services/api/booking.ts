import { z } from 'zod';
import httpClient from '../http/client';
import { parseEnvelope } from '../http/envelope';
import { WebsiteBookingRequest, WebsiteBookingResult, UserBooking, RecentBooking } from '@travel-crm/contracts';

type BookingPayload = z.infer<typeof WebsiteBookingRequest>;

export const submitBookingRequest = async (payload: BookingPayload) => {
  const body = WebsiteBookingRequest.parse(payload);
  const response = await httpClient.post('/bookings/website', body);
  return parseEnvelope(WebsiteBookingResult, response.data, 'POST /bookings/website').data;
};

export const fetchUserBookings = async () => {
  const response = await httpClient.get('/bookings/user');
  return parseEnvelope(z.array(UserBooking), response.data, 'GET /bookings/user').data;
};

export const fetchRecentBookings = async (limit = 10) => {
  const response = await httpClient.get(`/bookings/recent?limit=${limit}`);
  return parseEnvelope(z.array(RecentBooking), response.data, 'GET /bookings/recent').data;
};

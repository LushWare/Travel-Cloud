import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  WebsiteBookingRequest, WebsiteBookingResult, UserBooking, RecentBooking, RECENT_BOOKING_PRIVATE_FIELDS, ApiPackage,
} from '@travel-crm/contracts';
import { apiClient } from '../helpers/api-client.js';

// booking-service exposes no delete/cancel endpoint at all (confirmed via
// Services/booking-service/src/routes/booking.routes.js — only POST
// /website exists), so the row this test creates cannot be cleaned up via
// the API. Tagged with the run id in `name` so it's identifiable in the
// shared DB, matching this suite's existing accepted-debt pattern for
// billing's cancel-only (not delete) resources — see README.md.
describe.sequential('client contract: bookings', () => {
  const runId = process.env.E2E_RUN_ID || 'local';

  it('POST /bookings/website accepts a WebsiteBookingRequest-shaped payload and returns WebsiteBookingResult', async () => {
    const packagesRes = await apiClient.get('/packages?limit=1');
    expect(packagesRes.status).toBe(200);
    const pkg = ApiPackage.parse(packagesRes.body.data[0]);

    const payload = WebsiteBookingRequest.parse({
      packageId: pkg.id,
      name: `[E2E-${runId}] Booking Test`,
      email: `e2e-${runId}+booking@travelcrm.test`,
      phone: '+10000000000',
      travelers: 2,
      travelDate: '2027-06-01',
      endDate: '2027-06-08',
      message: 'Automated E2E contract test',
    });

    const res = await apiClient.post('/bookings/website', { body: payload });
    expect(res.status).toBe(201);
    const parsed = WebsiteBookingResult.safeParse(res.body?.data);
    if (!parsed.success) throw new Error(`WebsiteBookingResult mismatch: ${JSON.stringify(parsed.error.issues)}`);
  });

  it('GET /bookings/user (authenticated) returns an envelope whose data matches UserBooking[]', async () => {
    const res = await apiClient.get('/bookings/user', { role: 'customer' });
    expect(res.status).toBe(200);
    const parsed = z.array(UserBooking).safeParse(res.body?.data);
    if (!parsed.success) throw new Error(`UserBooking[] mismatch: ${JSON.stringify(parsed.error.issues)}`);
  });

  it('GET /bookings/recent (public) returns an envelope whose data matches RecentBooking[]', async () => {
    const res = await apiClient.get('/bookings/recent?limit=5');
    expect(res.status).toBe(200);
    const parsed = z.array(RecentBooking).safeParse(res.body?.data);
    if (!parsed.success) throw new Error(`RecentBooking[] mismatch: ${JSON.stringify(parsed.error.issues)}`);
  });

  it('GET /bookings/recent (public) exposes no traveller or payment field to an anonymous visitor', async () => {
    const res = await apiClient.get('/bookings/recent?limit=50');
    expect(res.status).toBe(200);
    const leaked = (res.body?.data ?? []).flatMap((row) =>
      RECENT_BOOKING_PRIVATE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(row, field)));
    expect(leaked).toEqual([]);
  });
});

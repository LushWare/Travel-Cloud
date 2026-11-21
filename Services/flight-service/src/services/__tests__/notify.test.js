import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailAirlineChange } from '../notify.js';

const booking = {
  id: 'b1', pnr: 'ABC123', bookedByEmail: 'rep@agency.test',
  segments: [{ origin: 'CMB', destination: 'DXB' }, { origin: 'DXB', destination: 'LHR' }],
};
const ok = () => vi.fn().mockResolvedValue({ ok: true, status: 200 });
const sent = (fetchImpl) => JSON.parse(fetchImpl.mock.calls[0][1].body);

beforeEach(() => {
  process.env.NOTIFICATION_SERVICE_URL = 'http://localhost:3008';
  process.env.INTERNAL_EVENTS_TOKEN = 'internal-secret';
});
afterEach(() => {
  delete process.env.NOTIFICATION_SERVICE_URL;
  delete process.env.INTERNAL_EVENTS_TOKEN;
});

describe('emailAirlineChange', () => {
  it('emails the rep who made the booking', async () => {
    const fetchImpl = ok();

    await emailAirlineChange(booking, 'changed', { fetchImpl });

    expect(sent(fetchImpl).to).toBe('rep@agency.test');
  });

  it('names the booking and route in the subject and text', async () => {
    const fetchImpl = ok();

    await emailAirlineChange(booking, 'changed', { fetchImpl });

    expect(sent(fetchImpl).subject).toBe('Action needed: flight booking ABC123 was changed by the airline');
    expect(sent(fetchImpl).text).toContain('(CMB → LHR)');
  });

  it('asks for a refund or new flight when the booking was cancelled', async () => {
    const fetchImpl = ok();

    await emailAirlineChange(booking, 'cancelled', { fetchImpl });

    expect(sent(fetchImpl).text).toContain("arrange the customer's refund or a new flight");
  });

  it('sends the internal token', async () => {
    const fetchImpl = ok();

    await emailAirlineChange(booking, 'changed', { fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers['x-internal-token']).toBe('internal-secret');
  });

  it('sends nothing when the booking has no rep email', async () => {
    const fetchImpl = ok();

    const result = await emailAirlineChange({ ...booking, bookedByEmail: null }, 'changed', { fetchImpl });

    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the email service fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(emailAirlineChange(booking, 'changed', { fetchImpl })).resolves.toBe(false);
  });
});

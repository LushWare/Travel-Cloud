import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../http/client', () => ({ default: { post: mockPost, get: mockGet } }));

import { submitBookingRequest, fetchUserBookings, fetchRecentBookings } from '../booking';

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

describe('submitBookingRequest', () => {
  it('resolves with the parsed result and strips the unread "type" field before sending', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: { bookingId: 'bk-1' } } });
    const result = await submitBookingRequest({
      packageId: 'pkg-1', email: 'jane@example.com', type: 'booking',
    } as never);
    expect(result).toEqual({ bookingId: 'bk-1' });
    expect(mockPost).toHaveBeenCalledWith('/bookings/website', { packageId: 'pkg-1', email: 'jane@example.com' });
  });

  it('accepts a payload with no name (matches the real form flow)', async () => {
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });
    await expect(
      submitBookingRequest({ packageId: 'pkg-1', email: 'jane@example.com' }),
    ).resolves.toBeDefined();
  });

  it('rejects a payload with an invalid email before sending', async () => {
    await expect(
      submitBookingRequest({ packageId: 'pkg-1', email: 'not-an-email' }),
    ).rejects.toThrow();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('fetchUserBookings', () => {
  it('resolves with the parsed array on a well-formed response', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ _id: 'b1', totalAmount: '1200.00' }] } });
    const result = await fetchUserBookings();
    expect(result).toEqual([{ _id: 'b1', totalAmount: 1200 }]);
  });

  it('rejects on a malformed array element', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ totalAmount: 'not-a-number' }] } });
    await expect(fetchUserBookings()).rejects.toThrow();
  });
});

describe('fetchRecentBookings', () => {
  const row = {
    id: 'bk-1', packageId: 'pkg-1', packageName: 'Bali Escape', packageDestination: 'Bali',
    packageDuration: 5, packageCoverImage: '/bali.jpg', packageSlug: 'bali-escape',
    packagePrice: '1100.00', numberOfTravelers: 2, createdAt: '2026-11-01T10:00:00.000Z',
  };

  it('drops a traveller name or email even if an older server still sends one', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ ...row, userName: 'Jane', userEmail: 'jane@x.test' }] } });

    const [booking] = await fetchRecentBookings(8);

    expect(booking).not.toHaveProperty('userName');
    expect(booking).not.toHaveProperty('userEmail');
  });

  it('converts the package price to a number', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [row] } });

    const [booking] = await fetchRecentBookings(8);

    expect(booking.packagePrice).toBe(1100);
  });
});

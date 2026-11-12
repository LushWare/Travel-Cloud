import { describe, it, expect } from 'vitest';
import { RecentBooking, RECENT_BOOKING_PRIVATE_FIELDS } from '../src/index.js';

const row = {
  id: 'bk-1', packageId: 'pkg-1', packageName: 'Bali Escape', packageDestination: 'Bali',
  packageDuration: 5, packageCoverImage: '/bali.jpg', packageSlug: 'bali-escape',
  packagePrice: 1100, numberOfTravelers: 2, createdAt: '2026-11-01T10:00:00.000Z',
};

describe('RecentBooking contract', () => {
  it('removes every private field from a parsed row', () => {
    const withPrivate = Object.fromEntries(RECENT_BOOKING_PRIVATE_FIELDS.map((field) => [field, 'secret']));

    const parsed = RecentBooking.parse({ ...row, ...withPrivate });

    expect(Object.keys(parsed).filter((key) => RECENT_BOOKING_PRIVATE_FIELDS.includes(key))).toEqual([]);
  });

  it('keeps the package fields unchanged', () => {
    expect(RecentBooking.parse(row)).toEqual(row);
  });

  it('accepts a booking whose package was deleted (package fields null)', () => {
    const orphan = {
      ...row, packageName: null, packageDestination: null, packageDuration: null,
      packageCoverImage: null, packageSlug: null, packagePrice: null,
    };

    expect(RecentBooking.parse(orphan).packageName).toBeNull();
  });

  it('rejects a row with no id', () => {
    const { id: _id, ...noId } = row;

    expect(RecentBooking.safeParse(noId).success).toBe(false);
  });
});

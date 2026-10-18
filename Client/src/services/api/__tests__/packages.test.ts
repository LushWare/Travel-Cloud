import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockGet = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
vi.mock('../../http/client', () => ({ default: { get: mockGet, post: mockPost } }));

const mockNormalizePackage = vi.hoisted(() => vi.fn((pkg: unknown) => ({ normalized: true, raw: pkg })));
const mockAggregateDestinations = vi.hoisted(() => vi.fn(() => []));
vi.mock('../packages.transform', () => ({
  normalizePackage: mockNormalizePackage,
  aggregateDestinations: mockAggregateDestinations,
}));

import {
  clearPackageReadCache, fetchPackages, fetchPackageById, getCachedPackages, getCachedPackageById,
  fetchFeaturedPackages, submitReview, fetchReviewStats,
} from '../packages';

beforeEach(() => {
  clearPackageReadCache();
  mockGet.mockReset();
  mockPost.mockReset();
  mockNormalizePackage.mockClear();
  mockAggregateDestinations.mockClear();
});

describe('fetchPackages', () => {
  it('validates the raw array, then normalizes each package', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ id: 'pkg-1', title: 'Bali' }], pagination: { page: 1 } } });
    const result = await fetchPackages();
    expect(mockNormalizePackage).toHaveBeenCalledWith(expect.objectContaining({ id: 'pkg-1', title: 'Bali' }));
    expect(result.packages).toEqual([{ normalized: true, raw: { id: 'pkg-1', title: 'Bali' } }]);
    expect(result.pagination).toEqual({ page: 1 });
  });

  it('rejects when a raw package entry fails validation (e.g. non-numeric price)', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ id: 'pkg-1', basePrice: 'free' }] } });
    await expect(fetchPackages()).rejects.toThrow();
  });

  it('reuses successful package results briefly to make return navigation immediate', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ id: 'pkg-cached', title: 'Bali' }] } });

    const firstResult = await fetchPackages();
    const secondResult = await fetchPackages();

    expect(secondResult).toBe(firstResult);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('makes a fresh catalogue available synchronously for return navigation', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ id: 'pkg-cached' }] } });
    await fetchPackages({ limit: 100 });

    expect(getCachedPackages({ limit: 100 })?.packages).toEqual([
      { normalized: true, raw: { id: 'pkg-cached' } },
    ]);
  });

  it('fetches complete package details after a catalog response', async () => {
    const catalogPackage = { id: 'pkg-full', title: 'Bali' };
    const detailPackage = {
      id: 'pkg-full',
      title: 'Bali',
      images: [{ url: 'https://example.com/one.jpg' }, { url: 'https://example.com/two.jpg' }],
    };
    mockGet
      .mockResolvedValueOnce({ data: { success: true, data: [catalogPackage] } })
      .mockResolvedValueOnce({ data: { success: true, data: detailPackage } });

    await fetchPackages();
    const detail = await fetchPackageById('pkg-full');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(detail.raw).toEqual(detailPackage);
  });
});

describe('fetchFeaturedPackages', () => {
  it('validates and normalizes the featured list', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: [{ id: 'pkg-2' }] } });
    const result = await fetchFeaturedPackages();
    expect(result).toEqual([{ normalized: true, raw: { id: 'pkg-2' } }]);
  });
});

describe('fetchPackageById', () => {
  it('resolves with the normalized package on a well-formed envelope', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: { id: 'pkg-3', title: 'Kyoto' } } });
    const result = await fetchPackageById('pkg-3');
    expect(result).toEqual({ normalized: true, raw: { id: 'pkg-3', title: 'Kyoto' } });
  });

  it('reuses successful package details after the first request', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: { id: 'pkg-cached', title: 'Kyoto' } } });

    const firstResult = await fetchPackageById('pkg-cached');
    const secondResult = await fetchPackageById('pkg-cached');

    expect(secondResult).toBe(firstResult);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('makes fresh package details available synchronously for prefetch navigation', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: { id: 'pkg-cached', title: 'Kyoto' } } });
    await fetchPackageById('pkg-cached');

    expect(getCachedPackageById('pkg-cached')).toEqual({
      normalized: true,
      raw: { id: 'pkg-cached', title: 'Kyoto' },
    });
  });

  it('rejects on a malformed envelope', async () => {
    mockGet.mockResolvedValue({ data: { success: false, message: 'Package not found' } });
    await expect(fetchPackageById('pkg-missing')).rejects.toThrow('Package not found');
  });
});

describe('submitReview', () => {
  it('sanitizes the outbound payload and resolves with the parsed review', async () => {
    mockPost.mockResolvedValue({
      data: { success: true, data: { id: 'rev-1', rating: 5, comment: 'Great trip!' } },
    });
    const result = await submitReview('pkg-1', { rating: 5, comment: 'Great trip!', name: 'Jane' });
    expect(result).toEqual({ id: 'rev-1', rating: 5, comment: 'Great trip!' });
  });

  it('rejects a rating outside 1-5 before sending', async () => {
    await expect(submitReview('pkg-1', { rating: 9, comment: 'Too good' })).rejects.toThrow();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('fetchReviewStats', () => {
  it('resolves with the parsed { avgRating, count }', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: { avgRating: 4.5, count: 12 } } });
    const result = await fetchReviewStats('pkg-1');
    expect(result).toEqual({ avgRating: 4.5, count: 12 });
  });
});

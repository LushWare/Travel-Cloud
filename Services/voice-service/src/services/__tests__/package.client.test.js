import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPackages, PACKAGE_PRICE_SNAPSHOT } from '../package.client.js';

const okJson = (data) => ({ ok: true, json: async () => ({ success: true, data }) });

beforeEach(() => {
  process.env.PACKAGE_SERVICE_URL = 'http://package.test';
});

afterEach(() => { vi.unstubAllGlobals(); });

const rawPackage = (over = {}) => ({
  id: 'pkg-1', title: 'Maldives 5N', destination: 'Maldives', durationDays: 5,
  description: 'A relaxing overwater villa escape.', basePrice: 1500, sellPrice: 1950, ...over,
});

describe('searchPackages', () => {
  it('returns an empty array for a blank query without calling the network', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await searchPackages('   ');
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('strips basePrice from every result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([rawPackage()])));
    const result = await searchPackages('maldives');
    expect(result[0]).not.toHaveProperty('basePrice');
  });

  it('strips sellPrice from every result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([rawPackage()])));
    const result = await searchPackages('maldives');
    expect(result[0]).not.toHaveProperty('sellPrice');
  });

  it('never lets a price value leak through any field, even indirectly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([rawPackage()])));
    const result = await searchPackages('maldives');
    expect(JSON.stringify(result)).not.toMatch(/1500|1950/);
  });

  it('keeps the price snapshot non-serializable for internal booking validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([rawPackage()])));
    const result = await searchPackages('maldives');
    expect(result[0][PACKAGE_PRICE_SNAPSHOT]).toBe(1950);
    expect(JSON.stringify(result)).not.toContain('1950');
  });

  it('maps the fields the agent may use', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson([rawPackage()])));
    const result = await searchPackages('maldives');
    expect(result[0]).toEqual({
      packageId: 'pkg-1', title: 'Maldives 5N', destination: 'Maldives',
      durationDays: 5, summary: 'A relaxing overwater villa escape.',
    });
  });

  it('caps results at 5 even when the search API returns more', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson(Array.from({ length: 10 }, (_, i) => rawPackage({ id: `pkg-${i}` })))));
    const result = await searchPackages('beach');
    expect(result).toHaveLength(5);
  });

  it('returns an empty array when the search request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const result = await searchPackages('maldives');
    expect(result).toEqual([]);
  });

  it('returns an empty array when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await searchPackages('maldives');
    expect(result).toEqual([]);
  });

  it('returns an empty array when package-service is unreachably slow', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const promise = searchPackages('maldives');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toEqual([]);
    vi.useRealTimers();
  });
});

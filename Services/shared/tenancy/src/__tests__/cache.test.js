import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTenantCache } from '../cache.js';
import { runWithTenant } from '../context.js';

const ACME = '00000000-0000-4000-8000-000000000002';
const GLOBE = '00000000-0000-4000-8000-000000000003';

afterEach(() => vi.useRealTimers());

describe('createTenantCache', () => {
  it('never serves one agency a value another agency cached', () => {
    const cache = createTenantCache({ ttlMs: 60_000 });

    runWithTenant(ACME, () => cache.set({ bankAccountNumber: 'ACME-123' }));

    expect(runWithTenant(GLOBE, () => cache.get())).toBeUndefined();
    expect(runWithTenant(ACME, () => cache.get())).toEqual({ bankAccountNumber: 'ACME-123' });
  });

  it('keeps each agency its own value side by side', () => {
    const cache = createTenantCache({ ttlMs: 60_000 });

    runWithTenant(ACME, () => cache.set('acme-settings'));
    runWithTenant(GLOBE, () => cache.set('globe-settings'));

    expect(runWithTenant(ACME, () => cache.get())).toBe('acme-settings');
    expect(runWithTenant(GLOBE, () => cache.get())).toBe('globe-settings');
  });

  it('returns undefined and stores nothing outside a tenant context', () => {
    const cache = createTenantCache({ ttlMs: 60_000 });

    cache.set('orphan');

    expect(cache.get()).toBeUndefined();
    expect(cache.getStale()).toBeUndefined();
    expect(runWithTenant(ACME, () => cache.get())).toBeUndefined();
  });

  it('expires a fresh get after ttlMs but keeps getStale for the same agency only', () => {
    vi.useFakeTimers();
    const cache = createTenantCache({ ttlMs: 1_000 });
    runWithTenant(ACME, () => cache.set('acme-settings'));

    vi.advanceTimersByTime(1_001);

    expect(runWithTenant(ACME, () => cache.get())).toBeUndefined();
    expect(runWithTenant(ACME, () => cache.getStale())).toBe('acme-settings');
    expect(runWithTenant(GLOBE, () => cache.getStale())).toBeUndefined();
  });

  it('clear() drops every agency', () => {
    const cache = createTenantCache({ ttlMs: 60_000 });
    runWithTenant(ACME, () => cache.set('a'));
    runWithTenant(GLOBE, () => cache.set('g'));

    cache.clear();

    expect(runWithTenant(ACME, () => cache.getStale())).toBeUndefined();
    expect(runWithTenant(GLOBE, () => cache.getStale())).toBeUndefined();
  });

  it('evicts oldest entries instead of growing past maxEntries', () => {
    const cache = createTenantCache({ ttlMs: 60_000, maxEntries: 2 });
    const t = (n) => `00000000-0000-4000-8000-00000000000${n}`;

    runWithTenant(t(1), () => cache.set('one'));
    runWithTenant(t(2), () => cache.set('two'));
    runWithTenant(t(3), () => cache.set('three'));

    expect(runWithTenant(t(1), () => cache.getStale())).toBeUndefined();
    expect(runWithTenant(t(3), () => cache.get())).toBe('three');
  });

  it('refuses a missing or non-positive ttlMs', () => {
    expect(() => createTenantCache()).toThrow(/ttlMs/);
    expect(() => createTenantCache({ ttlMs: 0 })).toThrow(/ttlMs/);
  });
});

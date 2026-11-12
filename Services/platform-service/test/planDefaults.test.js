import { describe, it, expect } from 'vitest';
import { normalizePlanEntitlements, LIMIT_ENTITLEMENTS } from '../../shared/tenancy/src/index.js';
import { DEFAULT_ASSIGNMENTS, DEFAULT_PLANS } from '../src/planDefaults.js';

describe('starting plan catalogue', () => {
  it.each(DEFAULT_PLANS.map((p) => [p.key, p]))('%s has entitlements the system accepts', (_key, plan) => {
    expect(() => normalizePlanEntitlements(plan.entitlements)).not.toThrow();
  });

  it('uses keys the database accepts and no key twice', () => {
    const keys = DEFAULT_PLANS.map((p) => p.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
  });

  it('keeps the internal plan unlimited and free of a price', () => {
    const internal = DEFAULT_PLANS.find((p) => p.key === 'internal');

    expect(internal.priceMinorUnits).toBeNull();
    expect(internal.entitlements).toMatchObject({ staff_seats: null, packages: null, features: { ai_itinerary_builder: true } });
  });

  it('gives each paid plan more than the one below it', () => {
    const [starter, growth] = ['starter', 'growth'].map((k) => DEFAULT_PLANS.find((p) => p.key === k));

    expect(growth.priceMinorUnits).toBeGreaterThan(starter.priceMinorUnits);
    expect(growth.entitlements.staff_seats).toBeGreaterThan(starter.entitlements.staff_seats);
    expect(growth.entitlements.packages).toBeGreaterThan(starter.entitlements.packages);
  });

  it('assigns only plans that exist', () => {
    const keys = new Set(DEFAULT_PLANS.map((p) => p.key));

    for (const a of DEFAULT_ASSIGNMENTS) expect(keys.has(a.plan)).toBe(true);
  });

  it('gives every assignment and special deal a reason the database accepts', () => {
    for (const a of DEFAULT_ASSIGNMENTS) {
      expect(a.reason.trim().length).toBeGreaterThanOrEqual(5);
      for (const o of a.overrides ?? []) {
        expect(o.reason.trim().length).toBeGreaterThanOrEqual(5);
        expect(Object.keys(LIMIT_ENTITLEMENTS)).toContain(o.key);
        expect(Number.isSafeInteger(o.value) && o.value >= 0).toBe(true);
      }
    }
  });

  it('keeps the public-website agency on the unlimited internal plan', () => {
    expect(DEFAULT_ASSIGNMENTS.find((a) => a.slug === 'lush-demo').plan).toBe('internal');
  });
});

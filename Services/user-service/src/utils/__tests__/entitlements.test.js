import { describe, expect, it, vi } from 'vitest';
import { getCurrentTenantEntitlements, normalizePlanEntitlements, resolveEntitlements } from '../../../../shared/tenancy/src/entitlements.js';
import { runWithTenant } from '../../../../shared/tenancy/src/context.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000002';

describe('plan entitlements', () => {
  it('keeps existing agencies unrestricted when they have no assigned plan', () => {
    const result = resolveEntitlements();

    expect(result.plan).toBeNull();
    expect(result.entitlements.staff_seats).toBeNull();
    expect(result.entitlements.packages).toBeNull();
    expect(result.entitlements.features.ai_itinerary_builder).toBe(true);
    expect(result.source.staff_seats).toBe('default');
  });

  it('uses the assigned version and applies agency overrides last', () => {
    const result = resolveEntitlements({
      planVersion: {
        id: 'version-id', planId: 'plan-id', version: 2, name: 'Growth',
        entitlements: { staff_seats: 5, packages: 20, features: { ai_itinerary_builder: true } },
      },
      overrides: [
        { entitlementKey: 'staff_seats', value: 8 },
        { entitlementKey: 'features.ai_itinerary_builder', value: false },
      ],
    });

    expect(result.plan).toMatchObject({ id: 'plan-id', versionId: 'version-id', version: 2, name: 'Growth' });
    expect(result.entitlements).toMatchObject({ staff_seats: 8, packages: 20, features: { ai_itinerary_builder: false } });
    expect(result.source).toMatchObject({ staff_seats: 'override', packages: 'plan', 'features.ai_itinerary_builder': 'override' });
  });

  it('rejects unknown entitlement keys and malformed values', () => {
    expect(() => normalizePlanEntitlements({ staff: 5 })).toThrow(/Unsupported entitlement/);
    expect(() => normalizePlanEntitlements({ packages: -1 })).toThrow(/non-negative integer/);
    expect(() => normalizePlanEntitlements({ features: { made_up: true } })).toThrow(/Unsupported feature/);
    expect(() => normalizePlanEntitlements({ features: { ai_itinerary_builder: 1 } })).toThrow(/must be a boolean/);
  });

  it('rejects invalid overrides instead of silently ignoring them', () => {
    expect(() => resolveEntitlements({ overrides: [{ entitlementKey: 'packages', value: -1 }] })).toThrow(/Invalid override/);
    expect(() => resolveEntitlements({ overrides: [{ entitlementKey: 'unlisted', value: 2 }] })).toThrow(/Unsupported entitlement override/);
  });

  it('loads only the current agency assignment and overrides', async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([{
          id: 'version-id', planId: 'plan-id', version: 1, name: 'Starter', entitlements: { staff_seats: 3 },
          catalogPlanId: 'plan-id', planKey: 'starter',
        }])
        .mockResolvedValueOnce([{ entitlementKey: 'packages', value: 9 }]),
    };

    const result = await runWithTenant(TENANT_ID, () => getCurrentTenantEntitlements(prisma));

    expect(result.entitlements).toMatchObject({ staff_seats: 3, packages: 9 });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe(TENANT_ID);
    expect(prisma.$queryRawUnsafe.mock.calls[1][1]).toBe(TENANT_ID);
  });
});
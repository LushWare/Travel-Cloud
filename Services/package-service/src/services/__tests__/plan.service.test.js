import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { $transaction: vi.fn() } }));
vi.mock('../../db/client.js', () => ({ default: mockPrisma }));

import { runWithTenant } from '../../../../shared/tenancy/src/context.js';
import { createPackageWithinPlanLimit } from '../plan.service.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000002';

function prepare({ limit, used }) {
  const created = { id: 'package-id' };
  const tx = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn()
      .mockResolvedValueOnce([{
        id: 'version-id', planId: 'plan-id', version: 1, name: 'Starter',
        entitlements: { packages: limit }, catalogPlanId: 'plan-id', planKey: 'starter',
      }])
      .mockResolvedValueOnce([]),
    package: {
      count: vi.fn().mockResolvedValue(used),
      create: vi.fn().mockResolvedValue(created),
    },
  };
  mockPrisma.$transaction.mockImplementation((operation) => operation(tx));
  return { tx, created };
}

describe('createPackageWithinPlanLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses package creation when the plan limit is reached', async () => {
    const { tx } = prepare({ limit: 3, used: 3 });

    await expect(runWithTenant(TENANT_ID, () => createPackageWithinPlanLimit({ title: 'New trip' })))
      .rejects.toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_REACHED' });

    expect(tx.package.create).not.toHaveBeenCalled();
  });

  it('creates the package below the plan limit', async () => {
    const { tx, created } = prepare({ limit: 3, used: 2 });
    const data = { title: 'New trip' };
    const options = { include: { images: true } };

    await expect(runWithTenant(TENANT_ID, () => createPackageWithinPlanLimit(data, options))).resolves.toEqual(created);

    expect(tx.package.create).toHaveBeenCalledWith({ data, ...options });
  });
});
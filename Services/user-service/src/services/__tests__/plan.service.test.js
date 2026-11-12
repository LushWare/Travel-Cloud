import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { $transaction: vi.fn() } }));
vi.mock('../../db/client.js', () => ({ default: mockPrisma }));

import { runWithTenant } from '../../../../shared/tenancy/src/context.js';
import { withStaffSeat } from '../plan.service.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000002';

function prepare({ limit, used }) {
  const tx = {
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn()
      .mockResolvedValueOnce([{
        id: 'version-id', planId: 'plan-id', version: 1, name: 'Starter',
        entitlements: { staff_seats: limit }, catalogPlanId: 'plan-id', planKey: 'starter',
      }])
      .mockResolvedValueOnce([]),
    membership: { count: vi.fn().mockResolvedValue(used) },
  };
  mockPrisma.$transaction.mockImplementation((operation) => operation(tx));
  return tx;
}

describe('withStaffSeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to create staff when every seat is occupied', async () => {
    prepare({ limit: 2, used: 2 });
    const operation = vi.fn();

    await expect(runWithTenant(TENANT_ID, () => withStaffSeat(operation)))
      .rejects.toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_REACHED' });

    expect(operation).not.toHaveBeenCalled();
  });

  it('runs the creation when a seat remains', async () => {
    const tx = prepare({ limit: 2, used: 1 });
    const operation = vi.fn().mockResolvedValue({ id: 'new-user' });

    await expect(runWithTenant(TENANT_ID, () => withStaffSeat(operation))).resolves.toEqual({ id: 'new-user' });

    expect(tx.membership.count).toHaveBeenCalledWith({
      where: { role: { in: ['superAdmin', 'admin', 'salesRep', 'vendor'] }, status: { in: ['active', 'invited'] } },
    });
    expect(operation).toHaveBeenCalledWith(tx);
  });

  it('answers 401, not a server error, when the login carries no agency', async () => {
    const operation = vi.fn();

    await expect(withStaffSeat(operation)).rejects.toMatchObject({ statusCode: 401 });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('allows any number of staff when the agency has no plan', async () => {
    const tx = { $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn().mockResolvedValue([]), membership: { count: vi.fn() } };
    mockPrisma.$transaction.mockImplementation((operation) => operation(tx));
    const operation = vi.fn().mockResolvedValue({ id: 'new-user' });

    await expect(runWithTenant(TENANT_ID, () => withStaffSeat(operation))).resolves.toEqual({ id: 'new-user' });

    expect(tx.membership.count).not.toHaveBeenCalled();
  });
});
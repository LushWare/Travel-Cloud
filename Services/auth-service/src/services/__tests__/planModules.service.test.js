import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, loggerMock } = vi.hoisted(() => ({
  prismaMock: { $queryRawUnsafe: vi.fn() },
  loggerMock: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../db/client.js', () => ({ default: prismaMock }));
vi.mock('../../config/logger.js', () => ({ default: loggerMock }));

import { modulesSwitchedOffFor } from '../planModules.service.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';
const plan = (features) => [{
  id: 'v', planId: 'p', version: 1, name: 'Starter', entitlements: { features },
  catalogPlanId: 'p', planKey: 'starter',
}];

beforeEach(() => vi.clearAllMocks());

describe('modulesSwitchedOffFor', () => {
  it('returns the modules the assigned plan switches off', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce(plan({ finance_docs: false, whatsapp: false })).mockResolvedValueOnce([]);

    expect(await modulesSwitchedOffFor(AGENCY)).toEqual(['finance_docs', 'whatsapp']);
  });

  it('applies an agency override that turns a module back on', async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce(plan({ finance_docs: false }))
      .mockResolvedValueOnce([{ entitlementKey: 'features.finance_docs', value: true }]);

    expect(await modulesSwitchedOffFor(AGENCY)).toEqual([]);
  });

  it('queries only the given agency', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    await modulesSwitchedOffFor(AGENCY);

    expect(prismaMock.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([AGENCY, AGENCY]);
  });

  it('returns no modules for an agency with no plan', async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    expect(await modulesSwitchedOffFor(AGENCY)).toEqual([]);
  });

  it('lets the sign-in continue with no limits and logs an error when the plan cannot be read', async () => {
    prismaMock.$queryRawUnsafe.mockRejectedValue(new Error('connection lost'));

    const result = await modulesSwitchedOffFor(AGENCY);

    expect(result).toEqual([]);
    expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ tenantId: AGENCY }), expect.any(String));
  });

  it('returns no modules without touching the database when there is no agency', async () => {
    expect(await modulesSwitchedOffFor(null)).toEqual([]);
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

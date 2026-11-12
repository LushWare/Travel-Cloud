import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryRawUnsafe } = vi.hoisted(() => ({ mockQueryRawUnsafe: vi.fn() }));
vi.mock('../../db/client.js', () => ({ default: { $queryRawUnsafe: mockQueryRawUnsafe } }));

import { assertPlanFeature, metered } from '../plan.service.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';
const onPlan = (features) => mockQueryRawUnsafe
  .mockResolvedValueOnce([{
    id: 'v', planId: 'p', version: 1, name: 'Starter', entitlements: { features },
    catalogPlanId: 'p', planKey: 'starter',
  }])
  .mockResolvedValueOnce([]);
const inAgency = (fn) => runWithTenant(AGENCY, fn);

beforeEach(() => mockQueryRawUnsafe.mockReset());

describe('assertPlanFeature', () => {
  it('refuses a module the plan switches off with 403 FEATURE_NOT_IN_PLAN', async () => {
    onPlan({ whatsapp: false });

    await expect(inAgency(() => assertPlanFeature('whatsapp')))
      .rejects.toMatchObject({ statusCode: 403, code: 'FEATURE_NOT_IN_PLAN' });
  });

  it('allows a module the plan includes', async () => {
    onPlan({ whatsapp: true });

    await expect(inAgency(() => assertPlanFeature('whatsapp'))).resolves.toBeUndefined();
  });

  it('allows a module an older plan never mentions', async () => {
    onPlan({ ai_itinerary_builder: false });

    await expect(inAgency(() => assertPlanFeature('finance_docs'))).resolves.toBeUndefined();
  });

  it('allows everything for an agency with no plan', async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await expect(inAgency(() => assertPlanFeature('finance_docs'))).resolves.toBeUndefined();
  });

  it('reads the plan of the current agency only', async () => {
    mockQueryRawUnsafe.mockResolvedValue([]);

    await inAgency(() => assertPlanFeature('whatsapp'));

    expect(mockQueryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([AGENCY, AGENCY]);
  });

  it('refuses to check outside an agency', async () => {
    await expect(assertPlanFeature('whatsapp')).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });

  it('rejects a feature name that does not exist instead of allowing it', async () => {
    await expect(inAgency(() => assertPlanFeature('whatsap'))).rejects.toThrow(/Unsupported feature/);
  });
});

describe('metered', () => {
  it('refuses a send past the monthly allowance with 429 USAGE_LIMIT_REACHED and a clear message', async () => {
    // The plan allows 100 emails a month and the counter is already full, so the
    // conditional increment matches no row and returns nothing.
    mockQueryRawUnsafe.mockImplementation(async (sql) => {
      if (String(sql).includes('"TenantPlan"')) {
        return [{ id: 'v', planId: 'p', version: 1, name: 'Starter', entitlements: { emails_per_month: 100 }, catalogPlanId: 'p', planKey: 'starter' }];
      }
      return [];
    });
    const send = vi.fn();

    const error = await inAgency(() => metered('emails', send)).catch((err) => err);

    expect(error).toMatchObject({ statusCode: 429, code: 'USAGE_LIMIT_REACHED', isOperational: true });
    expect(error.message).toMatch(/allowance of 100 customer emails/);
    expect(send).not.toHaveBeenCalled();
  });
});

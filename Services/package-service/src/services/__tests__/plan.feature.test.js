import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetEntitlements } = vi.hoisted(() => ({ mockGetEntitlements: vi.fn() }));
vi.mock('../../db/client.js', () => ({ default: {} }));
vi.mock('../../../../shared/tenancy/src/index.js', () => ({
  getCurrentTenantEntitlements: mockGetEntitlements,
  requireTenantId: () => '00000000-0000-4000-8000-000000000002',
  FEATURE_NOT_IN_PLAN: 'FEATURE_NOT_IN_PLAN',
  FEATURE_NOT_IN_PLAN_MESSAGE: "Your agency's plan doesn't include this. Ask your agency owner about upgrading.",
}));

import { requirePlanFeature } from '../plan.service.js';

describe('requirePlanFeature', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a feature disabled by the agency plan', async () => {
    mockGetEntitlements.mockResolvedValue({ entitlements: { features: { ai_itinerary_builder: false } } });
    const next = vi.fn();

    await requirePlanFeature('ai_itinerary_builder')({}, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: 'FEATURE_NOT_IN_PLAN' }));
  });

  it('continues when the feature is included', async () => {
    mockGetEntitlements.mockResolvedValue({ entitlements: { features: { ai_itinerary_builder: true } } });
    const next = vi.fn();

    await requirePlanFeature('ai_itinerary_builder')({}, {}, next);

    expect(next).toHaveBeenCalledWith();
  });
});
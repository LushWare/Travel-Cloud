import { describe, expect, it } from 'vitest';
import { billingAccessClaims } from '../billingAccessClaims.js';

const DAY = 24 * 60 * 60 * 1000;

describe('billingAccessClaims', () => {
  it('switches past-due agencies to read-only at seven days', () => {
    const pastDueAt = new Date(1_800_000_000_000);
    const workspace = { tenantStatus: 'past_due', pastDueAt };

    expect(billingAccessClaims(workspace, pastDueAt.getTime() + 7 * DAY - 1)).not.toHaveProperty('ro');
    expect(billingAccessClaims(workspace, pastDueAt.getTime() + 7 * DAY)).toEqual({
      tenantStatus: 'past_due',
      ro: true,
    });
  });

  it('preserves billing recovery access in suspended account claims', () => {
    expect(billingAccessClaims({ tenantStatus: 'suspended', billingSuspended: true })).toEqual({
      tenantStatus: 'suspended',
      billingSuspended: true,
    });
  });
});

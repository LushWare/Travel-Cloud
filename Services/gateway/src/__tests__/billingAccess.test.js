import { describe, expect, it } from 'vitest';
import { billingAccessFailure } from '../billingAccess.js';

describe('billingAccessFailure', () => {
  it('lets a past-due agency read data and manage billing but blocks mutations', () => {
    const owner = { tenantStatus: 'past_due', ro: true };

    expect(billingAccessFailure('GET', '/api/v1/leads', owner)).toBeNull();
    expect(billingAccessFailure('POST', '/api/v1/leads', owner)?.code).toBe('AGENCY_READ_ONLY');
    expect(billingAccessFailure('POST', '/api/v1/auth/billing/portal', owner)).toBeNull();
  });

  it('allows billing-recovery endpoints for a billing-suspended owner only', () => {
    const user = { tenantStatus: 'suspended', billingSuspended: true };

    expect(billingAccessFailure('GET', '/api/v1/auth/billing', user)).toBeNull();
    expect(billingAccessFailure('POST', '/api/v1/auth/billing/portal', user)).toBeNull();
    expect(billingAccessFailure('GET', '/api/v1/leads', user)?.code).toBe('AGENCY_SUSPENDED');
    expect(billingAccessFailure('POST', '/api/v1/leads', user)?.code).toBe('AGENCY_SUSPENDED');
  });

  it('does not let payment restore a manually suspended agency', () => {
    expect(billingAccessFailure('POST', '/api/v1/auth/billing/portal', {
      tenantStatus: 'suspended',
      billingSuspended: false,
    })?.code).toBe('AGENCY_SUSPENDED');
  });

  it('keeps behavior unchanged for tokens without billing claims', () => {
    expect(billingAccessFailure('POST', '/api/v1/leads', { tid: 'tenant-id' })).toBeNull();
  });
});

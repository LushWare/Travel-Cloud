import { describe, expect, it } from 'vitest';
import { requestLogProps } from '../middleware/requestLogger.js';

describe('requestLogProps', () => {
  it('uses only the verified tenant and includes the correlation id', () => {
    expect(requestLogProps({
      verifiedTenantId: '00000000-0000-4000-8000-000000000002',
      requestId: 'request-123',
      headers: { 'x-tenant-id': 'forged' },
    })).toEqual({
      tenantId: '00000000-0000-4000-8000-000000000002',
      requestId: 'request-123',
    });
  });

  it('does not attribute unverified requests to a tenant', () => {
    expect(requestLogProps({
      requestId: 'request-123',
      headers: { 'x-tenant-id': 'forged' },
    })).toEqual({ requestId: 'request-123' });
  });
});

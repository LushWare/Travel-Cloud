import { describe, expect, it } from 'vitest';
import { requestLogProps, sanitizeRequestUrl } from '../middleware/requestLogger.js';

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

describe('sanitizeRequestUrl', () => {
  it('redacts Stripe payment tokens, checkout session ids, and OAuth callback secrets', () => {
    expect(sanitizeRequestUrl(
      `/api/v1/integrations/stripe/payment-links/${'a'.repeat(43)}/checkout`,
    )).toBe('/api/v1/integrations/stripe/payment-links/[redacted]/checkout');
    expect(sanitizeRequestUrl('/api/v1/integrations/stripe/checkout-sessions/cs_live_secret123'))
      .toBe('/api/v1/integrations/stripe/checkout-sessions/[redacted]');
    expect(sanitizeRequestUrl('/api/v1/integrations/stripe/callback?code=secret&state=signed&scope=read_write'))
      .toBe('/api/v1/integrations/stripe/callback?code=%5Bredacted%5D&state=%5Bredacted%5D&scope=read_write');
  });
});

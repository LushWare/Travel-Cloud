import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
const { submitGoogleAdsLead } = await import('../lead.client.js');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('Google Ads lead service client', () => {
  beforeEach(() => {
    process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
    delete process.env.K_SERVICE;
  });

  it('forwards a lead with the verified agency in the internal tenant header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await submitGoogleAdsLead({ tenantId: TENANT_ID, leadId: 'google-lead-1', email: 'guest@example.com' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/leads\/internal\/google-ads-lead$/),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-tenant-id': TENANT_ID,
          'x-internal-token': 'internal-token',
        }),
        body: JSON.stringify({ leadId: 'google-lead-1', email: 'guest@example.com' }),
      }),
    );
  });

  it('does not forward a lead without a valid agency ID', async () => {
    const fetchImpl = vi.fn();

    await expect(submitGoogleAdsLead({ tenantId: 'not-an-agency', leadId: 'google-lead-1' }, fetchImpl))
      .rejects.toThrow('Valid agency context is required for Google Ads leads');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
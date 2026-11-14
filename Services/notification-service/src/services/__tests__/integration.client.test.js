import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../../shared/tenancy/src/context.js';

const {
  sendWithAgencyEmail,
  sendWithAgencyWhatsapp,
  resolveWhatsappTenant,
  verifyGoogleAdsWebhookKey,
} = await import('../integration.client.js');
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const originalEnv = { ...process.env };

describe('agency email delivery client', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      INTEGRATION_SERVICE_URL: 'http://localhost:3015',
      INTERNAL_EVENTS_TOKEN: 'internal-token',
    };
    delete process.env.K_SERVICE;
  });

  it('passes verified tenant context to the Integration Hub without returning credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { messageId: 'message-1' } }),
    });
    const result = await runWithTenant(TENANT_ID, () =>
      sendWithAgencyEmail({ to: 'customer@example.com', subject: 'Quote', html: '<p>Quote</p>' }, fetchImpl)
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3015/api/v1/integrations/internal/email/send',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-tenant-id': TENANT_ID,
          'x-internal-token': 'internal-token',
        }),
      }),
    );
    expect(result).toEqual({ messageId: 'message-1' });
  });

  it('uses the platform email path when no agency context exists', async () => {
    const fetchImpl = vi.fn();
    await expect(sendWithAgencyEmail({ to: 'customer@example.com' }, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the platform sender only when no agency SMTP account is connected', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: 'INTEGRATION_NOT_CONNECTED' }),
    });

    await expect(runWithTenant(TENANT_ID, () =>
      sendWithAgencyEmail({ to: 'customer@example.com' }, fetchImpl)
    )).resolves.toBeNull();
  });
});

describe('Google Ads webhook verification client', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      INTEGRATION_SERVICE_URL: 'http://localhost:3015',
      INTERNAL_EVENTS_TOKEN: 'internal-token',
    };
    delete process.env.K_SERVICE;
  });

  it('sends the agency and key only to the internal Integration Hub', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { tenantId: TENANT_ID } }),
    });

    await expect(verifyGoogleAdsWebhookKey({ tenantId: TENANT_ID, googleKey: 'agency-secret' }, fetchImpl))
      .resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://localhost:3015/api/v1/integrations/internal/google-ads/${TENANT_ID}/verify`,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-tenant-id': TENANT_ID,
          'x-internal-token': 'internal-token',
        }),
        body: JSON.stringify({ google_key: 'agency-secret' }),
      }),
    );
  });

  it('rejects a credential the Integration Hub does not recognize', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(verifyGoogleAdsWebhookKey({ tenantId: TENANT_ID, googleKey: 'wrong' }, fetchImpl))
      .resolves.toBe(false);
  });
});

describe('agency WhatsApp delivery client', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      INTEGRATION_SERVICE_URL: 'http://localhost:3015',
      INTERNAL_EVENTS_TOKEN: 'internal-token',
    };
    delete process.env.K_SERVICE;
  });

  it('passes verified tenant context to the Integration Hub', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { messageId: 'message-1' } }),
    });
    const message = { to: '+15551234567', type: 'text', text: { body: 'Hello' } };
    const result = await runWithTenant(TENANT_ID, () => sendWithAgencyWhatsapp(message, fetchImpl));

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3015/api/v1/integrations/internal/whatsapp/send',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-tenant-id': TENANT_ID,
          'x-internal-token': 'internal-token',
        }),
        body: JSON.stringify(message),
      }),
    );
    expect(result).toEqual({ messageId: 'message-1' });
  });

  it('does not make an Integration Hub request without tenant context', async () => {
    const fetchImpl = vi.fn();
    await expect(sendWithAgencyWhatsapp({ to: '+15551234567' }, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('WhatsApp webhook tenant resolver client', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      INTEGRATION_SERVICE_URL: 'http://localhost:3015',
      INTERNAL_EVENTS_TOKEN: 'internal-token',
    };
    delete process.env.K_SERVICE;
  });

  it('resolves a provider phone ID only through the authenticated internal endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { tenantId: TENANT_ID } }),
    });

    await expect(resolveWhatsappTenant('123456789', fetchImpl)).resolves.toBe(TENANT_ID);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3015/api/v1/integrations/internal/whatsapp/resolve',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-internal-token': 'internal-token' }),
        body: JSON.stringify({ phoneNumberId: '123456789' }),
      }),
    );
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('x-tenant-id');
  });

  it('treats an unknown provider phone ID as unrouted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(resolveWhatsappTenant('999999999', fetchImpl)).resolves.toBeNull();
  });
});

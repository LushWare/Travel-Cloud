import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const {
  mockQuery,
  mockTransaction,
  mockResolveWhatsappPhone,
  mockEncryptSecret,
  mockDecryptSecret,
  mockAudit,
  mockIntegrationIdFor,
  mockExchangeCode,
  mockGetWhatsappPhoneNumber,
  mockSubscribeWhatsappApp,
  mockRegisterWhatsappPhone,
  mockUnsubscribeWhatsappApp,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockResolveWhatsappPhone: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockAudit: vi.fn(),
  mockIntegrationIdFor: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockGetWhatsappPhoneNumber: vi.fn(),
  mockSubscribeWhatsappApp: vi.fn(),
  mockRegisterWhatsappPhone: vi.fn(),
  mockUnsubscribeWhatsappApp: vi.fn(),
}));

vi.mock('../db.js', () => ({
  tenantDb: {
    query: mockQuery,
    transaction: mockTransaction,
    resolveWhatsappPhone: mockResolveWhatsappPhone,
  },
}));
vi.mock('../crypto.js', () => ({ encryptSecret: mockEncryptSecret, decryptSecret: mockDecryptSecret }));
vi.mock('../audit.js', () => ({ recordIntegrationAudit: mockAudit }));
vi.mock('../integrationIdentity.js', () => ({ integrationIdFor: mockIntegrationIdFor }));
vi.mock('../whatsapp.js', () => ({
  exchangeWhatsappSignupCode: mockExchangeCode,
  getWhatsappPhoneNumber: mockGetWhatsappPhoneNumber,
  subscribeWhatsappApp: mockSubscribeWhatsappApp,
  registerWhatsappPhone: mockRegisterWhatsappPhone,
  unsubscribeWhatsappApp: mockUnsubscribeWhatsappApp,
}));

const { connectWhatsapp, resolveWhatsappPhone, sendAgencyWhatsapp } = await import('../whatsapp.controller.js');
const AGENCY_A = '11111111-1111-4111-8111-111111111111';
const AGENCY_B = '22222222-2222-4222-8222-222222222222';

function buildReqRes({ body, headers = {} } = {}) {
  const req = { body, headers, log: { warn: vi.fn() } };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

describe('agency WhatsApp delivery', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTransaction.mockReset();
    mockResolveWhatsappPhone.mockReset().mockResolvedValue(null);
    mockEncryptSecret.mockReset().mockResolvedValue({
      ciphertext: Buffer.from('encrypted-token'),
      wrappedDek: Buffer.from('wrapped-key'),
      iv: Buffer.alloc(12),
      tag: Buffer.alloc(16),
      kekVersion: 'test-key',
      fingerprint: 'fingerprint',
    });
    mockDecryptSecret.mockReset();
    mockAudit.mockReset();
    mockIntegrationIdFor.mockReset().mockReturnValue('33333333-3333-4333-8333-333333333333');
    mockExchangeCode.mockReset().mockResolvedValue('agency-business-token');
    mockGetWhatsappPhoneNumber.mockReset().mockResolvedValue({
      id: '123456789',
      display_phone_number: '+1 555 123 4567',
      verified_name: 'Agency Travel',
    });
    mockSubscribeWhatsappApp.mockReset().mockResolvedValue({ success: true });
    mockRegisterWhatsappPhone.mockReset().mockResolvedValue({ success: true });
    mockUnsubscribeWhatsappApp.mockReset();
    vi.unstubAllGlobals();
    process.env.META_GRAPH_API_VERSION = 'v23.0';
    process.env.FACEBOOK_APP_ID = 'app-id';
    process.env.FACEBOOK_APP_SECRET = 'app-secret';
    process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID = 'signup-config';
  });

  it('sends with only the credential selected by the request tenant', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: AGENCY_A,
      provider: 'whatsapp',
      status: 'connected',
      config: { phoneNumberId: '123456789' },
      secretCiphertext: Buffer.from('encrypted'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ accessToken: 'agency-a-token' });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    });
    vi.stubGlobal('fetch', fetch);
    const { req, res } = buildReqRes({
      body: { type: 'text', to: '+1 (555) 123-4567', body: 'Hello' },
    });

    await runWithTenant(AGENCY_A, () => sendAgencyWhatsapp(req, res));

    expect(mockQuery.mock.calls[0][1]).toEqual([AGENCY_A, 'whatsapp', 'business']);
    expect(mockDecryptSecret).toHaveBeenCalledWith(expect.objectContaining({ tenantId: AGENCY_A }));
    expect(fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v27.0/123456789/messages',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer agency-a-token' }),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '15551234567',
          type: 'text',
          text: { body: 'Hello', preview_url: false },
        }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { messageId: 'wamid.123' } });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('agency-a-token');
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('encrypted');
    expect(AGENCY_B).not.toBe(AGENCY_A);
  });

  it('does not call Meta when the requesting agency has no WhatsApp connection', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { req, res } = buildReqRes({
      body: { type: 'text', to: '+15551234567', body: 'Hello' },
    });

    await runWithTenant(AGENCY_B, () => sendAgencyWhatsapp(req, res));

    expect(mockQuery.mock.calls[0][1]).toEqual([AGENCY_B, 'whatsapp', 'business']);
    expect(mockDecryptSecret).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INTEGRATION_NOT_CONNECTED' }));
  });

  it('rejects invalid payloads before looking up or using credentials', async () => {
    const { req, res } = buildReqRes({ body: { type: 'text', to: '', body: '' } });

    await runWithTenant(AGENCY_A, () => sendAgencyWhatsapp(req, res));

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockDecryptSecret).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('exchanges the signup code and stores the connected number under the current agency', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const transactionQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ tenantId: AGENCY_A }] });
    mockTransaction.mockImplementation((callback) => callback({ query: transactionQuery }));
    const { req, res } = buildReqRes({
      body: { code: 'short-lived-code', wabaId: '987654321', phoneNumberId: '123456789', pin: '123456' },
      headers: { 'x-user-id': 'admin-1' },
    });

    await runWithTenant(AGENCY_A, () => connectWhatsapp(req, res));

    expect(mockExchangeCode).toHaveBeenCalledWith('short-lived-code');
    expect(mockGetWhatsappPhoneNumber).toHaveBeenCalledWith('987654321', '123456789', 'agency-business-token');
    expect(mockSubscribeWhatsappApp).toHaveBeenCalledWith('987654321', 'agency-business-token');
    expect(mockRegisterWhatsappPhone).toHaveBeenCalledWith('123456789', 'agency-business-token', '123456');
    expect(mockEncryptSecret).toHaveBeenCalledWith(
      { accessToken: 'agency-business-token' },
      expect.objectContaining({ tenantId: AGENCY_A, provider: 'whatsapp' }),
    );
    expect(transactionQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO crm_integrations."WhatsappPhoneRoute"'),
      ['123456789', AGENCY_A, '33333333-3333-4333-8333-333333333333'],
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ connected: true, displayPhoneNumber: '+1 555 123 4567' }),
    }));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('agency-business-token');
  });

  it('rejects a phone number already owned by a different agency before exchanging the code', async () => {
    mockResolveWhatsappPhone.mockResolvedValue({ tenantId: AGENCY_A, integrationId: 'existing-integration' });
    const { req, res } = buildReqRes({
      body: { code: 'short-lived-code', wabaId: '987654321', phoneNumberId: '123456789', pin: '123456' },
    });

    await runWithTenant(AGENCY_B, () => connectWhatsapp(req, res));

    expect(mockExchangeCode).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WHATSAPP_PHONE_ALREADY_CONNECTED' }));
  });

  it('returns only the tenant for a verified internal phone route', async () => {
    mockResolveWhatsappPhone.mockResolvedValue({ tenantId: AGENCY_A, integrationId: 'private-integration-id' });
    const { req, res } = buildReqRes({ body: { phoneNumberId: '123456789' } });

    await resolveWhatsappPhone(req, res);

    expect(mockResolveWhatsappPhone).toHaveBeenCalledWith('123456789');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { tenantId: AGENCY_A } });
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('private-integration-id');
  });

  it('returns 404 when a provider phone ID is not mapped to an active agency', async () => {
    mockResolveWhatsappPhone.mockResolvedValue(null);
    const { req, res } = buildReqRes({ body: { phoneNumberId: '999999999' } });

    await resolveWhatsappPhone(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: 'WHATSAPP_ROUTE_NOT_FOUND' });
  });
});
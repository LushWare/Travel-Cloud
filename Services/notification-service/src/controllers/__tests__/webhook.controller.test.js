import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSubmitGoogleAdsLead, mockLogWhatsappCommunication, mockVerifyGoogleAdsWebhookKey, mockResolveWhatsappTenant,
} = vi.hoisted(() => ({
  mockSubmitGoogleAdsLead: vi.fn(),
  mockLogWhatsappCommunication: vi.fn(),
  mockVerifyGoogleAdsWebhookKey: vi.fn(),
  mockResolveWhatsappTenant: vi.fn(),
}));

vi.mock('../../services/lead.client.js', () => ({
  submitGoogleAdsLead: mockSubmitGoogleAdsLead,
  logWhatsappCommunication: mockLogWhatsappCommunication,
}));

vi.mock('../../services/integration.client.js', () => ({
  verifyGoogleAdsWebhookKey: mockVerifyGoogleAdsWebhookKey,
  resolveWhatsappTenant: mockResolveWhatsappTenant,
}));

const { handleGoogleAdsLeadWebhook, verifyWhatsappWebhook, handleWhatsappWebhook } = await import('../webhook.controller.js');

function buildReqRes(body) {
  const req = { body, get: () => null, log: { error: vi.fn() } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { req, res };
}

beforeEach(() => {
  mockSubmitGoogleAdsLead.mockReset();
  mockLogWhatsappCommunication.mockReset();
  mockVerifyGoogleAdsWebhookKey.mockReset();
  mockResolveWhatsappTenant.mockReset().mockResolvedValue('11111111-1111-4111-8111-111111111111');
  mockVerifyGoogleAdsWebhookKey.mockResolvedValue(true);
  process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
  process.env.NODE_ENV = 'test';
});

describe('handleGoogleAdsLeadWebhook', () => {
  it('maps a Google lead-form submission into lead-service', async () => {
    mockSubmitGoogleAdsLead.mockResolvedValue({ data: { leadId: 'lead-1', duplicate: false } });
    const { req, res } = buildReqRes({
      google_key: 'google-key',
      lead_id: 'google-lead-1',
      campaign_id: 'campaign-2',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Jane Doe' },
        { column_id: 'EMAIL', string_value: 'jane@example.com' },
        { column_id: 'PHONE_NUMBER', string_value: '+15551234567' },
        { column_name: 'Destination', string_value: 'Sri Lanka' },
        { column_name: 'Number of travelers', string_value: '2 travelers' },
      ],
    });
    req.params = { tenantId: '11111111-1111-4111-8111-111111111111' };

    await handleGoogleAdsLeadWebhook(req, res, vi.fn());

    expect(mockSubmitGoogleAdsLead).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111',
      leadId: 'google-lead-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+15551234567',
      destination: 'Sri Lanka',
      numberOfTravelers: 2,
    }));
    expect(mockVerifyGoogleAdsWebhookKey).toHaveBeenCalledWith({
      tenantId: '11111111-1111-4111-8111-111111111111',
      googleKey: 'google-key',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects submissions with a wrong webhook key', async () => {
    mockVerifyGoogleAdsWebhookKey.mockResolvedValue(false);
    const { req, res } = buildReqRes({ google_key: 'wrong-key', lead_id: 'google-lead-1' });
    req.params = { tenantId: '11111111-1111-4111-8111-111111111111' };
    const next = vi.fn();

    await handleGoogleAdsLeadWebhook(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(mockSubmitGoogleAdsLead).not.toHaveBeenCalled();
  });

  it('forwards provider test submissions for CRM creation', async () => {
    mockSubmitGoogleAdsLead.mockResolvedValue({ data: { leadId: 'lead-test', duplicate: false } });
    const { req, res } = buildReqRes({
      google_key: 'google-key',
      lead_id: 'google-test-1',
      is_test: true,
      user_column_data: [{ column_id: 'EMAIL', string_value: 'test@example.com' }],
    });
    req.params = { tenantId: '11111111-1111-4111-8111-111111111111' };

    await handleGoogleAdsLeadWebhook(req, res, vi.fn());

    expect(mockSubmitGoogleAdsLead).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111',
      leadId: 'google-test-1',
      email: 'test@example.com',
      isTest: true,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

function buildVerifyReqRes(query) {
  const req = { query, log: { info: vi.fn() } };
  const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
  return { req, res };
}

function buildWhatsappWebhookReqRes(body) {
  const req = { body, get: () => null, log: { error: vi.fn() } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { req, res };
}

describe('verifyWhatsappWebhook — Meta subscription handshake', () => {
  it('echoes hub.challenge when mode and token match', async () => {
    const { req, res } = buildVerifyReqRes({
      'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'echo-me',
    });
    await verifyWhatsappWebhook(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('echo-me');
  });

  it('rejects a mismatched verify token', async () => {
    const { req, res } = buildVerifyReqRes({
      'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'echo-me',
    });
    const next = vi.fn();
    await verifyWhatsappWebhook(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(res.send).not.toHaveBeenCalled();
  });
});

describe('handleWhatsappWebhook — inbound messages and status callbacks', () => {
  it('logs an inbound customer message against the sender phone number', async () => {
    mockLogWhatsappCommunication.mockResolvedValue({ matched: true });

    const { req, res } = buildWhatsappWebhookReqRes({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123456789' },
        messages: [{ from: '15551234567', type: 'text', text: { body: 'When does the trip start?' }, timestamp: '1700000000' }],
      } }] }],
    });
    await handleWhatsappWebhook(req, res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockLogWhatsappCommunication).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111',
      phone: '15551234567',
      notes: expect.stringContaining('When does the trip start?'),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('logs a delivery-status callback against the recipient phone number', async () => {
    mockLogWhatsappCommunication.mockResolvedValue({ matched: true });

    const { req, res } = buildWhatsappWebhookReqRes({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123456789' },
        statuses: [{ recipient_id: '15557654321', status: 'delivered', timestamp: '1700000001' }],
      } }] }],
    });
    await handleWhatsappWebhook(req, res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockLogWhatsappCommunication).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: '11111111-1111-4111-8111-111111111111',
      phone: '15557654321',
      notes: expect.stringContaining('delivered'),
    }));
  });

  it('responds 200 immediately without waiting for the lead-service call to resolve', async () => {
    let resolveLog;
    mockLogWhatsappCommunication.mockReturnValue(new Promise((resolve) => { resolveLog = resolve; }));

    const { req, res } = buildWhatsappWebhookReqRes({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '123456789' },
        messages: [{ from: '15551234567', type: 'text', text: { body: 'hi' } }],
      } }] }],
    });
    await handleWhatsappWebhook(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    resolveLog({ matched: true });
  });

  it('does not log a webhook for an unknown phone number route', async () => {
    mockResolveWhatsappTenant.mockResolvedValue(null);
    const { req, res } = buildWhatsappWebhookReqRes({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '999999999' },
        messages: [{ from: '15551234567', type: 'text', text: { body: 'hi' } }],
      } }] }],
    });

    await handleWhatsappWebhook(req, res, vi.fn());
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockResolveWhatsappTenant).toHaveBeenCalledWith('999999999');
    expect(mockLogWhatsappCommunication).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

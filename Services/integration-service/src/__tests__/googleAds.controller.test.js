import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const { mockQuery, mockTransaction, mockEncryptSecret, mockDecryptSecret, mockAudit } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('../db.js', () => ({
  tenantDb: { query: mockQuery, transaction: mockTransaction },
}));

vi.mock('../crypto.js', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}));

vi.mock('../audit.js', () => ({ recordIntegrationAudit: mockAudit }));

const {
  getGoogleAdsIntegration,
  saveGoogleAdsIntegration,
  verifyGoogleAdsWebhookKey,
} = await import('../email.controller.js');

const AGENCY_A = '11111111-1111-4111-8111-111111111111';
const AGENCY_B = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';

function buildReqRes({ tenantId = AGENCY_A, body = {}, params = {}, headers = {} } = {}) {
  const req = { body, params, headers: { 'x-user-id': 'admin-1', ...headers } };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res, tenantId };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockEncryptSecret.mockReset();
  mockDecryptSecret.mockReset();
  mockAudit.mockReset();
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  mockEncryptSecret.mockResolvedValue({
    ciphertext: Buffer.from('ciphertext'), wrappedDek: Buffer.from('wrapped'),
    iv: Buffer.alloc(12), tag: Buffer.alloc(16), kekVersion: 'test-key', fingerprint: 'fingerprint',
  });
});

describe('Google Ads integration settings', () => {
  it('returns agency webhook details without exposing the secret', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'connected', lastTestedAt: null, lastError: null }] });
    const { req, res } = buildReqRes();

    await runWithTenant(AGENCY_A, () => getGoogleAdsIntegration(req, res));

    const data = res.json.mock.calls[0][0].data;
    expect(data.webhookUrl).toBe(`https://api.example.test/api/v1/webhooks/google-ads/${AGENCY_A}`);
    expect(data.connected).toBe(true);
    expect(data.webhookKey).toBeUndefined();
  });

  it('returns a new webhook key only when the agency connects or rotates it', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn().mockResolvedValue({ rows: [{ id: INTEGRATION_ID, status: 'connected' }] }),
    }));
    const { req, res } = buildReqRes();

    await runWithTenant(AGENCY_A, () => saveGoogleAdsIntegration(req, res));

    const data = res.json.mock.calls[0][0].data;
    expect(data.webhookKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockEncryptSecret).toHaveBeenCalledWith(
      { webhookKey: data.webhookKey },
      expect.objectContaining({ tenantId: AGENCY_A, provider: 'google_ads' }),
    );
  });
});

describe('Google Ads webhook key verification', () => {
  it('verifies a key only in the tenant named by the agency endpoint', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: AGENCY_A,
      provider: 'google_ads',
      status: 'connected',
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ webhookKey: 'agency-a-secret' });
    const { req, res } = buildReqRes({
      tenantId: AGENCY_B,
      params: { tenantId: AGENCY_B },
      body: { google_key: 'agency-a-secret', lead_id: 'lead-1' },
    });

    await verifyGoogleAdsWebhookKey(req, res);

    expect(mockQuery.mock.calls[0][1]).toEqual([AGENCY_B, 'google_ads', 'lead_forms']);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, code: 'INVALID_WEBHOOK_CREDENTIAL' });
  });

  it('returns the agency ID only after its own key matches', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: AGENCY_A,
      provider: 'google_ads',
      status: 'connected',
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ webhookKey: 'agency-a-secret' });
    const { req, res } = buildReqRes({
      params: { tenantId: AGENCY_A },
      body: { google_key: 'agency-a-secret' },
    });

    await verifyGoogleAdsWebhookKey(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { tenantId: AGENCY_A } });
  });
});
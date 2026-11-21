import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  txQuery: vi.fn(),
  verify: vi.fn(),
  createWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../db.js', () => ({
  tenantDb: {
    query: mocks.query,
    transaction: (fn) => fn({ query: mocks.txQuery }),
  },
}));
vi.mock('../crypto.js', () => ({ decryptSecret: mocks.decrypt, encryptSecret: mocks.encrypt }));
vi.mock('../audit.js', () => ({ recordIntegrationAudit: mocks.audit }));
vi.mock('../duffel.js', async (original) => ({
  ...(await original()),
  verifyDuffelToken: mocks.verify,
  createDuffelWebhook: mocks.createWebhook,
  deleteDuffelWebhook: mocks.deleteWebhook,
}));

const {
  getDuffelCredentials, getDuffelIntegration, saveDuffelIntegration, disconnectDuffel, duffelWebhookUrl,
} = await import('../duffel.controller.js');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'duffel_test_abcdefghijklmnop1234';
const CONNECTED_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: TENANT_ID,
  provider: 'duffel',
  status: 'connected',
  config: { mode: 'test', webhookId: 'sev_123', webhookNote: null },
  secretCiphertext: Buffer.from('encrypted-token'),
  lastFour: '1234',
};

const response = () => {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const run = (fn) => runWithTenant(TENANT_ID, fn);
const savedConfig = () => JSON.parse(mocks.txQuery.mock.calls[0][1][4]);
const savedSecret = () => mocks.encrypt.mock.calls[0][0];

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.encrypt.mockResolvedValue({ ciphertext: Buffer.from('c'), wrappedDek: Buffer.from('w'), iv: Buffer.alloc(12), tag: Buffer.alloc(16), kekVersion: 'local', fingerprint: 'f' });
  mocks.txQuery.mockResolvedValue({ rows: [{ ...CONNECTED_ROW }] });
  process.env.PUBLIC_API_URL = 'https://api.example.travel';
});
afterEach(() => { delete process.env.PUBLIC_API_URL; });

describe('Duffel connection status', () => {
  it('never returns the access token', async () => {
    mocks.query.mockResolvedValue({ rows: [CONNECTED_ROW] });
    const res = response();

    await run(() => getDuffelIntegration({ headers: {} }, res));

    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ connected: true, mode: 'test', lastFour: '1234', bookingUpdates: 'on' });
    expect(JSON.stringify(data)).not.toContain('encrypted-token');
  });

  it('reads only the current agency', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await run(() => getDuffelIntegration({ headers: {} }, response()));

    expect(mocks.query.mock.calls[0][1]).toEqual([TENANT_ID, 'duffel', 'flights']);
  });
});

describe('connecting a Duffel account', () => {
  it('refuses text that is not a Duffel token without calling Duffel', async () => {
    const res = response();

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: 'sk_live_123' } }, res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('saves nothing when Duffel rejects the token', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.verify.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));
    const res = response();

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('DUFFEL_TOKEN_REJECTED');
    expect(mocks.txQuery).not.toHaveBeenCalled();
  });

  it('stores the token and the webhook secret encrypted, with booking updates on', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.createWebhook.mockResolvedValue({ id: 'sev_new', secret: 'whsec_1' });

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, response()));

    expect(savedSecret()).toEqual({ accessToken: TOKEN, webhookSecret: 'whsec_1' });
    expect(savedConfig()).toEqual({ mode: 'test', webhookId: 'sev_new', webhookNote: null });
  });

  it("points the agency's webhook at an address carrying the agency", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.createWebhook.mockResolvedValue({ id: 'sev_new', secret: 'whsec_1' });

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, response()));

    expect(mocks.createWebhook).toHaveBeenCalledWith(TOKEN, `https://api.example.travel/api/v1/webhooks/duffel-flights/${TENANT_ID}`);
  });

  it('still connects when Duffel refuses the webhook, and says why updates are off', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.createWebhook.mockRejectedValue(Object.assign(new Error('422'), { status: 422 }));

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, response()));

    expect(savedConfig().webhookId).toBeNull();
    expect(savedConfig().webhookNote).toContain('only one per mode');
    expect(savedSecret()).toEqual({ accessToken: TOKEN });
  });

  it('does not ask Duffel for a webhook on a local address', async () => {
    process.env.PUBLIC_API_URL = 'http://localhost:3000';
    mocks.query.mockResolvedValue({ rows: [] });

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, response()));

    expect(mocks.createWebhook).not.toHaveBeenCalled();
    expect(savedConfig().webhookNote).toContain('live site address');
  });

  it("removes the previous account's webhook when the token changes", async () => {
    mocks.query.mockResolvedValue({ rows: [CONNECTED_ROW] });
    mocks.decrypt.mockResolvedValue({ accessToken: 'duffel_test_oldtokenvalue99' });
    mocks.createWebhook.mockResolvedValue({ id: 'sev_new', secret: 'whsec_1' });

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: TOKEN } }, response()));

    expect(mocks.deleteWebhook).toHaveBeenCalledWith('duffel_test_oldtokenvalue99', 'sev_123');
  });

  it('records a live token as live mode', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await run(() => saveDuffelIntegration({ headers: {}, body: { accessToken: 'duffel_live_abcdefghijklmnop' } }, response()));

    expect(savedConfig().mode).toBe('live');
  });
});

describe('disconnecting Duffel', () => {
  it('deletes the stored token and removes the webhook', async () => {
    mocks.query.mockResolvedValue({ rows: [CONNECTED_ROW] });
    mocks.decrypt.mockResolvedValue({ accessToken: TOKEN });

    await run(() => disconnectDuffel({ headers: {}, body: {} }, response()));

    expect(mocks.deleteWebhook).toHaveBeenCalledWith(TOKEN, 'sev_123');
    expect(mocks.txQuery.mock.calls[0][0]).toContain('"secretCiphertext" = NULL');
  });
});

describe('credentials for flight-service', () => {
  it('returns the decrypted token for a connected agency', async () => {
    mocks.query.mockResolvedValue({ rows: [CONNECTED_ROW] });
    mocks.decrypt.mockResolvedValue({ accessToken: TOKEN, webhookSecret: 'whsec_1' });
    const res = response();

    await run(() => getDuffelCredentials({ headers: {}, body: {} }, res));

    expect(res.json.mock.calls[0][0].data).toEqual({ accessToken: TOKEN, webhookSecret: 'whsec_1', mode: 'test' });
  });

  it('answers 404 when the agency has not connected Duffel', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const res = response();

    await run(() => getDuffelCredentials({ headers: {}, body: {} }, res));

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('answers 404 after the agency disconnected', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...CONNECTED_ROW, status: 'revoked', secretCiphertext: null }] });
    const res = response();

    await run(() => getDuffelCredentials({ headers: {}, body: {} }, res));

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('duffelWebhookUrl', () => {
  it('is empty when the public address is not set', () => {
    delete process.env.PUBLIC_API_URL;

    expect(duffelWebhookUrl(TENANT_ID)).toBeNull();
  });
});

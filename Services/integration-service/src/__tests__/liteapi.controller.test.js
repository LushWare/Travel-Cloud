import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), txQuery: vi.fn(), verify: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), audit: vi.fn(),
}));
vi.mock('../db.js', () => ({
  tenantDb: { query: mocks.query, transaction: (fn) => fn({ query: mocks.txQuery }) },
}));
vi.mock('../crypto.js', () => ({ decryptSecret: mocks.decrypt, encryptSecret: mocks.encrypt }));
vi.mock('../audit.js', () => ({ recordIntegrationAudit: mocks.audit }));
vi.mock('../liteapi.js', async (original) => ({ ...(await original()), verifyLiteApiKey: mocks.verify }));

const {
  getLiteApiCredentials, getLiteApiIntegration, saveLiteApiIntegration, disconnectLiteApi, testLiteApiIntegration,
} = await import('../liteapi.controller.js');

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'sand_c0ffee12-3456-7890-abcd-ef0123456789';
const ROW = {
  id: '22222222-2222-4222-8222-222222222222', tenantId: TENANT_ID, provider: 'liteapi', status: 'connected',
  config: { mode: 'test' }, secretCiphertext: Buffer.from('x'), lastFour: '6789',
};

function call(handler, body = {}) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  return runWithTenant(TENANT_ID, () => handler({ body, headers: { 'x-user-id': 'admin-1' } }, res)).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.txQuery.mockResolvedValue({ rows: [{ id: ROW.id, status: 'connected', config: { mode: 'test' }, lastFour: '6789' }] });
  mocks.encrypt.mockResolvedValue({ ciphertext: 'c', wrappedDek: 'd', iv: 'i', tag: 't', kekVersion: 'k', fingerprint: 'f' });
  mocks.verify.mockResolvedValue();
});

describe('connecting an agency LiteAPI account', () => {
  it('checks the key with LiteAPI before saving it', async () => {
    const res = await call(saveLiteApiIntegration, { apiKey: KEY });

    expect(mocks.verify).toHaveBeenCalledWith(KEY);
    expect(res.body.data).toMatchObject({ connected: true, mode: 'test', lastFour: '6789' });
  });

  it('stores the key encrypted for this agency only', async () => {
    await call(saveLiteApiIntegration, { apiKey: KEY });

    expect(mocks.encrypt).toHaveBeenCalledWith({ apiKey: KEY }, expect.objectContaining({ tenantId: TENANT_ID, provider: 'liteapi' }));
    expect(mocks.txQuery.mock.calls[0][1]).not.toContain(KEY);
  });

  it('marks a prod_ key as live', async () => {
    await call(saveLiteApiIntegration, { apiKey: 'prod_c0ffee12-3456-7890-abcd-ef0123456789' });

    expect(mocks.txQuery.mock.calls[0][1][4]).toBe(JSON.stringify({ mode: 'live' }));
  });

  it('refuses a key LiteAPI rejects, and saves nothing', async () => {
    mocks.verify.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }));

    const res = await call(saveLiteApiIntegration, { apiKey: KEY });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('LITEAPI_KEY_REJECTED');
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ apiKey: 'not-a-key' }], [{ apiKey: KEY, extra: 1 }]])('refuses the body %j', async (body) => {
    const res = await call(saveLiteApiIntegration, body);

    expect(res.statusCode).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('never returns the key in its status', async () => {
    mocks.query.mockResolvedValue({ rows: [ROW] });

    const res = await call(getLiteApiIntegration);

    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body.data.lastFour).toBe('6789');
  });
});

describe('testing and disconnecting', () => {
  it('marks the connection broken when LiteAPI stops accepting the key', async () => {
    mocks.query.mockResolvedValue({ rows: [ROW] });
    mocks.decrypt.mockResolvedValue({ apiKey: KEY });
    mocks.verify.mockRejectedValue(new Error('401'));

    const res = await call(testLiteApiIntegration);

    expect(res.statusCode).toBe(502);
    expect(mocks.txQuery.mock.calls[0][1].slice(0, 2)).toEqual([expect.stringContaining('LiteAPI did not accept'), 'error']);
  });

  it('wipes the stored key on disconnect', async () => {
    mocks.query.mockResolvedValue({ rows: [ROW] });

    const res = await call(disconnectLiteApi);

    expect(res.body.data.connected).toBe(false);
    expect(mocks.txQuery.mock.calls[0][0]).toContain('"secretCiphertext" = NULL');
  });
});

describe('internal credentials for package-service', () => {
  it('returns the agency key', async () => {
    mocks.query.mockResolvedValue({ rows: [ROW] });
    mocks.decrypt.mockResolvedValue({ apiKey: KEY });

    const res = await call(getLiteApiCredentials);

    expect(res.body.data).toEqual({ apiKey: KEY, mode: 'test' });
  });

  it('answers 404 when the agency has not connected LiteAPI', async () => {
    const res = await call(getLiteApiCredentials);

    expect(res.statusCode).toBe(404);
  });

  it('answers 404 for a disconnected account', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...ROW, status: 'revoked', secretCiphertext: null }] });

    expect((await call(getLiteApiCredentials)).statusCode).toBe(404);
  });
});

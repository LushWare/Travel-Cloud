import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const {
  mockQuery,
  mockTransaction,
  mockResolveFacebookPage,
  mockEncryptSecret,
  mockDecryptSecret,
  mockAudit,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockResolveFacebookPage: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockAudit: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../db.js', () => ({
  tenantDb: {
    query: mockQuery,
    transaction: mockTransaction,
    resolveFacebookPage: mockResolveFacebookPage,
  },
}));
vi.mock('../crypto.js', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}));
vi.mock('../audit.js', () => ({ recordIntegrationAudit: mockAudit }));
vi.mock('../config/logger.js', () => ({
  default: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError },
}));

const {
  getFacebookIntegration,
  startFacebookOAuth,
  completeFacebookOAuth,
  selectFacebookPages,
  disconnectFacebook,
  processFacebookLeadEvent,
  handleFacebookWebhook,
} = await import('../facebook.controller.js');
const {
  createFacebookOAuthState,
  verifyFacebookOAuthState,
} = await import('../facebook.js');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '123456789';

function buildReqRes({ body = {}, params = {}, query = {}, headers = {} } = {}) {
  const req = {
    body,
    params,
    query,
    headers: { 'x-user-id': 'admin-1', 'x-user-email': 'admin@example.com', 'x-user-role': 'admin', ...headers },
    requestId: 'request-1',
    get: vi.fn(),
    log: { error: vi.fn() },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

function signedBody(body, secret = process.env.FACEBOOK_APP_SECRET) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    rawBody,
    signature: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockResolveFacebookPage.mockReset();
  mockEncryptSecret.mockReset().mockResolvedValue({
    ciphertext: Buffer.from('ciphertext'),
    wrappedDek: Buffer.from('wrapped'),
    iv: Buffer.alloc(12),
    tag: Buffer.alloc(16),
    kekVersion: 'test-key',
    fingerprint: 'fingerprint',
  });
  mockDecryptSecret.mockReset();
  mockAudit.mockReset();
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerError.mockReset();
  process.env.FACEBOOK_APP_ID = 'meta-app-id';
  process.env.FACEBOOK_APP_SECRET = 'test-meta-app-secret';
  process.env.FACEBOOK_VERIFY_TOKEN = 'test-verify-token';
  process.env.FACEBOOK_GRAPH_API_VERSION = 'v27.0';
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  process.env.MANAGEMENT_URL = 'https://manage.example.test';
  process.env.LEAD_SERVICE_URL = 'http://localhost:3004';
  process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
  delete process.env.K_SERVICE;
});

describe('Facebook OAuth state', () => {
  it('authenticates the agency in signed OAuth state and rejects tampering', () => {
    const state = createFacebookOAuthState(TENANT_A);
    const [payload, signature] = state.split('.');
    const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;

    expect(verifyFacebookOAuthState(state)?.tenantId).toBe(TENANT_A);
    expect(verifyFacebookOAuthState(`${payload}.${tamperedSignature}`)).toBeNull();
  });

  it('starts OAuth with the agency and Meta page permissions', async () => {
    mockTransaction.mockImplementation(async (callback) => callback({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { req, res } = buildReqRes();

    await runWithTenant(TENANT_A, () => startFacebookOAuth(req, res));

    const data = res.json.mock.calls[0][0].data;
    const authorization = new URL(data.authorizationUrl);
    expect(authorization.origin).toBe('https://www.facebook.com');
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/v1/integrations/facebook/callback');
    expect(authorization.searchParams.get('scope')).toContain('leads_retrieval');
    expect(authorization.searchParams.get('state')).toBeTruthy();
  });

  it('does not complete OAuth with a state value that was not stored', async () => {
    const state = createFacebookOAuthState(TENANT_A);
    mockTransaction.mockImplementation(async (callback) => callback({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { req, res } = buildReqRes({ query: { state, code: 'oauth-code' } });

    await completeFacebookOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_OAUTH_STATE' }));
  });

  it('stores encrypted page credentials only after consuming the agency OAuth state', async () => {
    const state = createFacebookOAuthState(TENANT_A);
    mockQuery.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT "initiatedById"')) return { rows: [{ initiatedById: 'admin-1' }] };
        if (sql.includes('RETURNING id')) return { rows: [{ id: INTEGRATION_ID }] };
        return { rows: [] };
      }),
    }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'short-lived' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-lived' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: PAGE_ID, name: 'Agency Page', access_token: 'page-secret' }],
      }), { status: 200 })));
    const { req, res } = buildReqRes({ query: { state, code: 'oauth-code' } });

    await completeFacebookOAuth(req, res);

    expect(mockEncryptSecret).toHaveBeenCalledWith(
      { pages: [{ id: PAGE_ID, name: 'Agency Page', accessToken: 'page-secret' }] },
      expect.objectContaining({ tenantId: TENANT_A, provider: 'facebook' }),
    );
    expect(res.redirect).toHaveBeenCalledWith('https://manage.example.test/settings?tab=integrations&facebook=connected');
  });

  it('keeps already connected Pages active while adding Pages from a reauthorization', async () => {
    const state = createFacebookOAuthState(TENANT_A);
    const oldPageId = '987654321';
    const existing = {
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'connected',
      config: { pages: [{ id: oldPageId, name: 'Existing Page', selected: true }] },
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    };
    mockQuery.mockResolvedValue({ rows: [existing] });
    mockDecryptSecret.mockResolvedValue({
      pages: [{ id: oldPageId, name: 'Existing Page', accessToken: 'existing-page-secret' }],
    });
    const transactionQueries = [];
    mockTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn(async (sql, params) => {
        transactionQueries.push({ sql, params });
        if (sql.includes('SELECT "initiatedById"')) return { rows: [{ initiatedById: 'admin-1' }] };
        if (sql.includes('RETURNING id')) return { rows: [{ id: INTEGRATION_ID }] };
        return { rows: [] };
      }),
    }));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'short-lived' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-lived' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: PAGE_ID, name: 'New Page', access_token: 'new-page-secret' }],
      }), { status: 200 })));
    const { req, res } = buildReqRes({ query: { state, code: 'oauth-code' } });

    await completeFacebookOAuth(req, res);

    expect(mockEncryptSecret).toHaveBeenCalledWith(
      { pages: [
        { id: PAGE_ID, name: 'New Page', accessToken: 'new-page-secret' },
        { id: oldPageId, name: 'Existing Page', accessToken: 'existing-page-secret' },
      ] },
      expect.objectContaining({ tenantId: TENANT_A, provider: 'facebook' }),
    );
    const upsert = transactionQueries.find(({ sql }) => sql.includes('INSERT INTO crm_integrations."TenantIntegration"'));
    const savedConfig = JSON.parse(upsert.params[4]);
    expect(savedConfig.pages).toEqual([
      { id: PAGE_ID, name: 'New Page', selected: false },
      { id: oldPageId, name: 'Existing Page', selected: true },
    ]);
    expect(transactionQueries.some(({ sql }) => sql.includes('DELETE FROM crm_integrations."FacebookPageRoute"'))).toBe(false);
  });
});

describe('Facebook Lead Ads page setup', () => {
  it('returns only selected page metadata and never page tokens', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'connected',
      config: { pages: [{ id: PAGE_ID, name: 'Agency Page', selected: true }] },
    }] });
    const { req, res } = buildReqRes();

    await runWithTenant(TENANT_A, () => getFacebookIntegration(req, res));

    const result = res.json.mock.calls[0][0].data;
    expect(result.pages).toEqual([{ id: PAGE_ID, name: 'Agency Page', selected: true }]);
    expect(JSON.stringify(result)).not.toContain('accessToken');
  });

  it('refuses to take over a page already connected to another agency', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'pending',
      config: { pages: [{ id: PAGE_ID, name: 'Agency Page', selected: false }] },
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ pages: [{ id: PAGE_ID, name: 'Agency Page', accessToken: 'secret-page-token' }] });
    mockResolveFacebookPage.mockResolvedValue({ tenantId: TENANT_B, integrationId: 'other-integration' });
    const { req, res } = buildReqRes({ body: { pageIds: [PAGE_ID] } });

    await runWithTenant(TENANT_A, () => selectFacebookPages(req, res));

    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('rolls back earlier Meta subscriptions when a later Page subscription fails', async () => {
    const secondPageId = '123456790';
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'pending',
      config: { pages: [
        { id: PAGE_ID, name: 'Agency Page', selected: false },
        { id: secondPageId, name: 'Second Page', selected: false },
      ] },
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ pages: [
      { id: PAGE_ID, name: 'Agency Page', accessToken: 'first-page-secret' },
      { id: secondPageId, name: 'Second Page', accessToken: 'second-page-secret' },
    ] });
    mockResolveFacebookPage.mockResolvedValue(null);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 10 } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = buildReqRes({ body: { pageIds: [PAGE_ID, secondPageId] } });

    await runWithTenant(TENANT_A, () => selectFacebookPages(req, res));

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
    expect(res.status).toHaveBeenCalledWith(502);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('disconnects and removes tenant page routes before revoking credentials', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'connected',
      config: { pages: [{ id: PAGE_ID, name: 'Agency Page', selected: true }] },
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ pages: [{ id: PAGE_ID, name: 'Agency Page', accessToken: 'secret-page-token' }] });
    const calls = [];
    mockTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn(async (sql) => { calls.push(sql); return { rows: [] }; }),
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const { req, res } = buildReqRes();

    await runWithTenant(TENANT_A, () => disconnectFacebook(req, res));

    expect(calls[0]).toContain('DELETE FROM crm_integrations."FacebookPageRoute"');
    expect(calls[1]).toContain("SET status = 'revoked'");
    expect(res.json.mock.calls[0][0].data.connected).toBe(false);
  });

  it('still disables Page routing when encryption credentials are unavailable during disconnect', async () => {
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'connected',
      config: { pages: [{ id: PAGE_ID, name: 'Agency Page', selected: true }] },
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockRejectedValue(new Error('KMS unavailable'));
    const calls = [];
    mockTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn(async (sql) => { calls.push(sql); return { rows: [] }; }),
    }));
    const { req, res } = buildReqRes();

    await runWithTenant(TENANT_A, () => disconnectFacebook(req, res));

    expect(calls[0]).toContain('DELETE FROM crm_integrations."FacebookPageRoute"');
    expect(calls[1]).toContain("SET status = 'revoked'");
    expect(res.json.mock.calls[0][0].data.connected).toBe(false);
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.objectContaining({ error: 'KMS unavailable' }), expect.any(String));
  });
});

describe('Facebook Lead Ads webhook', () => {
  it('creates a lead using the token belonging to the webhook page tenant', async () => {
    mockResolveFacebookPage.mockResolvedValue({ tenantId: TENANT_A, integrationId: INTEGRATION_ID });
    mockQuery.mockResolvedValue({ rows: [{
      id: INTEGRATION_ID,
      tenantId: TENANT_A,
      provider: 'facebook',
      status: 'connected',
      config: {},
      secretCiphertext: Buffer.from('ciphertext'),
      wrappedDek: Buffer.from('wrapped'),
      secretIv: Buffer.alloc(12),
      secretTag: Buffer.alloc(16),
      kekVersion: 'test-key',
    }] });
    mockDecryptSecret.mockResolvedValue({ pages: [{ id: PAGE_ID, accessToken: 'agency-page-token' }] });
    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'graph.facebook.com') {
        expect(url.searchParams.get('access_token')).toBe('agency-page-token');
        return new Response(JSON.stringify({ field_data: [
          { name: 'full_name', values: ['Jane Doe'] },
          { name: 'email', values: ['jane@example.com'] },
        ] }), { status: 200 });
      }
      expect(init.headers['x-tenant-id']).toBe(TENANT_A);
      expect(JSON.parse(init.body)).toEqual(expect.objectContaining({ leadgenId: '987654321', email: 'jane@example.com' }));
      return new Response(JSON.stringify({ success: true, data: { leadId: 'lead-1' } }), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await processFacebookLeadEvent({ leadgen_id: '987654321', page_id: PAGE_ID }, 'request-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid Meta signatures and accepts valid signatures', async () => {
    const body = { object: 'page', entry: [] };
    const { rawBody, signature } = signedBody(body);
    const invalid = buildReqRes({ body });
    invalid.req.rawBody = rawBody;
    invalid.req.get.mockReturnValue('sha256=deadbeef');
    await handleFacebookWebhook(invalid.req, invalid.res);
    expect(invalid.res.status).toHaveBeenCalledWith(401);

    const valid = buildReqRes({ body });
    valid.req.rawBody = rawBody;
    valid.req.get.mockReturnValue(signature);
    await handleFacebookWebhook(valid.req, valid.res);
    expect(valid.res.status).toHaveBeenCalledWith(200);
    expect(valid.res.json).toHaveBeenCalledWith({ received: true });
  });
});

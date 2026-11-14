import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const {
  mockQuery,
  mockTransaction,
  mockEncryptSecret,
  mockDecryptSecret,
  mockAudit,
  mockCreateState,
  mockVerifyState,
  mockAuthorizationUrl,
  mockCallbackUrl,
  mockConfigured,
  mockPaymentsConfigured,
  mockExchangeCode,
  mockGetAccount,
  mockDeauthorize,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockEncryptSecret: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockAudit: vi.fn(),
  mockCreateState: vi.fn(),
  mockVerifyState: vi.fn(),
  mockAuthorizationUrl: vi.fn(),
  mockCallbackUrl: vi.fn(),
  mockConfigured: vi.fn(),
  mockPaymentsConfigured: vi.fn(),
  mockExchangeCode: vi.fn(),
  mockGetAccount: vi.fn(),
  mockDeauthorize: vi.fn(),
}));

vi.mock('../db.js', () => ({
  tenantDb: { query: mockQuery, transaction: mockTransaction },
}));
vi.mock('../crypto.js', () => ({
  encryptSecret: mockEncryptSecret,
  decryptSecret: mockDecryptSecret,
}));
vi.mock('../audit.js', () => ({ recordIntegrationAudit: mockAudit }));
vi.mock('../integrationIdentity.js', () => ({
  integrationIdFor: vi.fn(() => '33333333-3333-4333-8333-333333333333'),
}));
vi.mock('../stripe.js', () => ({
  createStripeOAuthState: mockCreateState,
  verifyStripeOAuthState: mockVerifyState,
  stripeAuthorizationUrl: mockAuthorizationUrl,
  stripeOAuthCallbackUrl: mockCallbackUrl,
  stripeConnectConfigured: mockConfigured,
  stripePaymentsConfigured: mockPaymentsConfigured,
  exchangeStripeCode: mockExchangeCode,
  getStripeAccount: mockGetAccount,
  deauthorizeStripeAccount: mockDeauthorize,
}));

const {
  completeStripeOAuth,
  disconnectStripe,
  getStripeIntegration,
  startStripeOAuth,
  testStripeIntegration,
} = await import('../stripe.controller.js');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const account = {
  id: 'acct_123',
  country: 'US',
  business_profile: { name: 'Agency A' },
  charges_enabled: true,
  payouts_enabled: true,
  livemode: false,
};
const encrypted = {
  ciphertext: Buffer.from('ciphertext'),
  wrappedDek: Buffer.from('wrapped'),
  iv: Buffer.alloc(12),
  tag: Buffer.alloc(16),
  kekVersion: 'test-key',
  fingerprint: 'fingerprint',
};

function buildReqRes({ body = {}, params = {}, query = {}, headers = {} } = {}) {
  const req = {
    body,
    params,
    query,
    requestId: 'request-1',
    headers: {
      'x-user-id': 'admin-1',
      'x-user-email': 'admin@example.test',
      'x-user-role': 'admin',
      ...headers,
    },
    log: { warn: vi.fn() },
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

function setupTransaction({ stateFound = false, integrationId = INTEGRATION_ID } = {}) {
  const dbQuery = vi.fn(async (sql) => {
    if (sql.includes('SELECT "initiatedById"')) {
      return { rows: stateFound ? [{ initiatedById: 'admin-1' }] : [] };
    }
    if (sql.includes('RETURNING id')) return { rows: [{ id: integrationId }] };
    return { rows: [] };
  });
  mockTransaction.mockImplementation((callback) => callback({ query: dbQuery }));
  return dbQuery;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockEncryptSecret.mockReset().mockResolvedValue(encrypted);
  mockDecryptSecret.mockReset();
  mockAudit.mockReset();
  mockCreateState.mockReset().mockReturnValue('signed-state');
  mockVerifyState.mockReset().mockReturnValue({ tenantId: TENANT_A });
  mockAuthorizationUrl.mockReset().mockReturnValue('https://connect.stripe.com/oauth/authorize');
  mockCallbackUrl.mockReset().mockReturnValue('https://api.example.test/api/v1/integrations/stripe/callback');
  mockConfigured.mockReset().mockReturnValue(true);
  mockPaymentsConfigured.mockReset().mockReturnValue(true);
  mockExchangeCode.mockReset().mockResolvedValue({ accessToken: 'agency-secret', accountId: 'acct_123' });
  mockGetAccount.mockReset().mockResolvedValue(account);
  mockDeauthorize.mockReset().mockResolvedValue({});
  process.env.MANAGEMENT_URL = 'https://manage.example.test';
});

describe('Stripe agency integration', () => {
  it('returns connection status without exposing the encrypted credential', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        status: 'connected',
        config: { accountId: 'acct_123', businessName: 'Agency A', chargesEnabled: true, payoutsEnabled: true },
        secretCiphertext: Buffer.from('secret'),
        wrappedDek: Buffer.from('wrapped'),
        lastTestedAt: null,
        lastError: null,
      }],
    });
    const { req, res } = buildReqRes();

    await runWithTenant(TENANT_A, () => getStripeIntegration(req, res));

    expect(res.json.mock.calls[0][0].data).toEqual(expect.objectContaining({
      connected: true,
      configured: true,
      account: expect.objectContaining({ accountId: 'acct_123', businessName: 'Agency A' }),
    }));
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secretCiphertext');
  });

  it('stores one-time state and returns a Stripe authorization URL', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const dbQuery = setupTransaction();
    const { req, res } = buildReqRes({ body: {} });

    await runWithTenant(TENANT_A, () => startStripeOAuth(req, res));

    expect(mockCreateState).toHaveBeenCalledWith(TENANT_A, expect.any(Number));
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO crm_integrations."OAuthState"'), expect.arrayContaining([
      expect.any(String), TENANT_A, 'stripe', 'admin-1', expect.any(Date),
    ]));
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
        callbackUrl: 'https://api.example.test/api/v1/integrations/stripe/callback',
      },
    });
  });

  it('rejects connection attempts with unexpected request data', async () => {
    const { req, res } = buildReqRes({ body: { accountId: 'acct_123' } });

    await runWithTenant(TENANT_A, () => startStripeOAuth(req, res));

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('VALIDATION_FAILED');
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('rejects callbacks with a state not stored for its agency', async () => {
    setupTransaction();
    const { req, res } = buildReqRes({ query: { state: 'signed-state', code: 'oauth-code' } });

    await completeStripeOAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_OAUTH_STATE');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('encrypts the connected account token before saving it for the initiating agency', async () => {
    mockVerifyState.mockReturnValue({ tenantId: TENANT_A });
    const dbQuery = setupTransaction({ stateFound: true });
    const { req, res } = buildReqRes({ query: { state: 'signed-state', code: 'oauth-code' } });

    await completeStripeOAuth(req, res);

    expect(mockEncryptSecret).toHaveBeenCalledWith(
      { accessToken: 'agency-secret' },
      expect.objectContaining({ tenantId: TENANT_A, provider: 'stripe' }),
    );
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT ("tenantId", provider, label)'),
      expect.arrayContaining([INTEGRATION_ID, TENANT_A, 'stripe', 'payments', expect.any(String), encrypted.ciphertext]),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://manage.example.test/settings?tab=integrations&stripe=connected',
    );
  });

  it('does not store a token when Stripe returns a different account ID', async () => {
    setupTransaction({ stateFound: true });
    mockGetAccount.mockResolvedValue({ ...account, id: 'acct_other' });
    const { req, res } = buildReqRes({ query: { state: 'signed-state', code: 'oauth-code' } });

    await completeStripeOAuth(req, res);

    expect(mockEncryptSecret).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://manage.example.test/settings?tab=integrations&stripe=failed',
    );
  });

  it('verifies the encrypted account token and refreshes the public account details', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: INTEGRATION_ID,
        tenantId: TENANT_A,
        status: 'connected',
        config: { accountId: 'acct_123' },
        secretCiphertext: encrypted.ciphertext,
      }],
    });
    mockDecryptSecret.mockResolvedValue({ accessToken: 'agency-secret' });
    const dbQuery = setupTransaction();
    const { req, res } = buildReqRes({ body: {} });

    await runWithTenant(TENANT_A, () => testStripeIntegration(req, res));

    expect(mockGetAccount).toHaveBeenCalledWith('agency-secret');
    expect(dbQuery).toHaveBeenCalledWith(expect.stringContaining('SET config = $1::jsonb'), [
      JSON.stringify({
        accountId: 'acct_123',
        businessName: 'Agency A',
        country: 'US',
        chargesEnabled: true,
        payoutsEnabled: true,
        livemode: false,
      }),
      INTEGRATION_ID,
      TENANT_A,
    ]);
    expect(res.json.mock.calls[0][0].data.account.businessName).toBe('Agency A');
  });

  it('does not return Stripe provider details when connection verification fails', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: INTEGRATION_ID,
        tenantId: TENANT_A,
        status: 'connected',
        config: { accountId: 'acct_123' },
        secretCiphertext: encrypted.ciphertext,
      }],
    });
    mockDecryptSecret.mockResolvedValue({ accessToken: 'agency-secret' });
    mockGetAccount.mockRejectedValue(Object.assign(new Error('private provider response'), {
      status: 401,
      providerCode: 'invalid_grant',
    }));
    setupTransaction();
    const { req, res } = buildReqRes({ body: {} });

    await runWithTenant(TENANT_A, () => testStripeIntegration(req, res));

    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('private provider response');
    expect(req.log.warn).toHaveBeenCalledWith(
      { tenantId: TENANT_A, providerStatus: 401, providerCode: 'invalid_grant' },
      'Stripe connection test failed',
    );
  });

  it('revokes the Stripe authorization and clears the agency credential on disconnect', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: INTEGRATION_ID,
        tenantId: TENANT_A,
        status: 'connected',
        config: { accountId: 'acct_123' },
        secretCiphertext: encrypted.ciphertext,
      }],
    });
    const dbQuery = setupTransaction();
    const { req, res } = buildReqRes({ body: {} });

    await runWithTenant(TENANT_A, () => disconnectStripe(req, res));

    expect(mockDeauthorize).toHaveBeenCalledWith('acct_123');
    expect(dbQuery).toHaveBeenCalledWith(
      expect.stringContaining('status = \'revoked\''),
      [INTEGRATION_ID, TENANT_A],
    );
    expect(res.json.mock.calls[0][0].data.connected).toBe(false);
  });

  it('keeps the local connection when Stripe revocation fails', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: INTEGRATION_ID,
        tenantId: TENANT_A,
        status: 'connected',
        config: { accountId: 'acct_123' },
        secretCiphertext: encrypted.ciphertext,
      }],
    });
    mockDeauthorize.mockRejectedValue(Object.assign(new Error('provider failed'), { status: 503 }));
    const { req, res } = buildReqRes({ body: {} });

    await runWithTenant(TENANT_A, () => disconnectStripe(req, res));

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json.mock.calls[0][0].code).toBe('STRIPE_DISCONNECT_FAILED');
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

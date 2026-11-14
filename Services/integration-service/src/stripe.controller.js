import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireTenantId, runWithTenant } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { integrationIdFor } from './integrationIdentity.js';
import {
  createStripeOAuthState,
  deauthorizeStripeAccount,
  exchangeStripeCode,
  getStripeAccount,
  stripeAuthorizationUrl,
  stripeConnectConfigured,
  stripePaymentsConfigured,
  stripeOAuthCallbackUrl,
  verifyStripeOAuthState,
} from './stripe.js';

const PROVIDER = 'stripe';
const LABEL = 'payments';
const emptySchema = z.object({}).strict();
const callbackQuerySchema = z.object({
  state: z.string().min(1).max(2048),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
}).passthrough();

function stateHash(state) {
  return createHash('sha256').update(state).digest('hex');
}

export async function findStripeIntegration(tenantId) {
  const result = await tenantDb.query(
    `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion", "secretFingerprint",
            "lastTestedAt", "lastError"
       FROM crm_integrations."TenantIntegration"
      WHERE "tenantId" = $1 AND provider = $2 AND label = $3
      LIMIT 1`,
    [tenantId, PROVIDER, LABEL],
  );
  return result.rows[0] || null;
}

function publicStatus(row) {
  const config = row?.config;
  const account = config?.accountId ? {
    accountId: config.accountId,
    businessName: config.businessName || null,
    country: config.country || null,
    chargesEnabled: config.chargesEnabled === true,
    payoutsEnabled: config.payoutsEnabled === true,
    livemode: typeof config.livemode === 'boolean' ? config.livemode : null,
  } : null;
  return {
    connected: row?.status === 'connected',
    status: row?.status || 'disconnected',
    provider: PROVIDER,
    configured: stripeConnectConfigured(),
    paymentsReady: stripePaymentsConfigured() && config?.chargesEnabled === true,
    account,
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
  };
}

function managementRedirect(result) {
  const base = process.env.MANAGEMENT_URL;
  if (!base) throw new Error('Management URL is not configured');
  const url = new URL('/settings', base);
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set('stripe', result);
  return url.toString();
}

async function consumeOAuthState(claims, state, requestId) {
  return runWithTenant(claims.tenantId, async () => tenantDb.transaction(async (db) => {
    const stored = await db.query(
      `SELECT "initiatedById"
         FROM crm_integrations."OAuthState"
        WHERE "stateHash" = $1 AND "tenantId" = $2 AND provider = $3 AND "expiresAt" > now()
        FOR UPDATE`,
      [stateHash(state), claims.tenantId, PROVIDER],
    );
    if (!stored.rows[0]) return null;
    await db.query(
      'DELETE FROM crm_integrations."OAuthState" WHERE "stateHash" = $1 AND "tenantId" = $2',
      [stateHash(state), claims.tenantId],
    );
    return stored.rows[0];
  }), requestId);
}

function stripeAccountConfig(account) {
  return {
    accountId: account.id,
    businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || null,
    country: account.country || null,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    livemode: account.livemode ?? null,
  };
}

export async function getStripeIntegration(_req, res) {
  const row = await findStripeIntegration(requireTenantId());
  return res.json({ success: true, data: publicStatus(row) });
}

export async function startStripeOAuth(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Stripe connection data.' });
  }
  if (!stripeConnectConfigured()) {
    return res.status(503).json({ success: false, code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe connection is not configured.' });
  }
  const tenantId = requireTenantId();
  const current = await findStripeIntegration(tenantId);
  if (current?.status === 'connected') {
    return res.status(409).json({ success: false, code: 'STRIPE_ALREADY_CONNECTED', message: 'Disconnect the current Stripe account before connecting another.' });
  }

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const state = createStripeOAuthState(tenantId, expiresAt);
  await tenantDb.transaction(async (db) => {
    await db.query(
      `DELETE FROM crm_integrations."OAuthState"
        WHERE "tenantId" = $1 AND provider = $2 AND "expiresAt" <= now()`,
      [tenantId, PROVIDER],
    );
    await db.query(
      `INSERT INTO crm_integrations."OAuthState"
         ("stateHash", "tenantId", provider, "initiatedById", "expiresAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [stateHash(state), tenantId, PROVIDER, req.headers['x-user-id'], new Date(expiresAt)],
    );
  });
  return res.json({
    success: true,
    data: { authorizationUrl: stripeAuthorizationUrl(state), callbackUrl: stripeOAuthCallbackUrl() },
  });
}

export async function completeStripeOAuth(req, res) {
  const parsed = callbackQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_CALLBACK', message: 'Stripe connection could not be completed.' });
  }
  if (!stripeConnectConfigured()) {
    return res.status(503).json({ success: false, code: 'STRIPE_NOT_CONFIGURED', message: 'Stripe connection is not configured.' });
  }
  const claims = verifyStripeOAuthState(parsed.data.state);
  if (!claims) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_STATE', message: 'Stripe connection expired. Start again from Management.' });
  }
  const storedState = await consumeOAuthState(claims, parsed.data.state, req.requestId);
  if (!storedState) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_STATE', message: 'Stripe connection expired. Start again from Management.' });
  }
  if (parsed.data.error || !parsed.data.code) return res.redirect(managementRedirect('cancelled'));

  const tenantId = claims.tenantId;
  let connected;
  let account;
  try {
    connected = await exchangeStripeCode(parsed.data.code);
    account = await getStripeAccount(connected.accessToken);
    if (account.id !== connected.accountId) throw new Error('Stripe account identity did not match');
  } catch (error) {
    req.log?.warn?.({
      tenantId,
      providerStatus: error?.status,
      providerCode: error?.providerCode,
    }, 'Stripe authorization failed');
    return res.redirect(managementRedirect('failed'));
  }

  const integrationId = integrationIdFor(tenantId, PROVIDER, LABEL);
  const encrypted = await encryptSecret(
    { accessToken: connected.accessToken },
    { tenantId, integrationId, provider: PROVIDER },
  );
  const callbackReq = {
    ...req,
    headers: {
      ...req.headers,
      'x-user-id': storedState.initiatedById,
      'x-user-role': 'admin',
      'x-user-email': null,
    },
  };
  await runWithTenant(tenantId, async () => tenantDb.transaction(async (db) => {
    const saved = await db.query(
      `INSERT INTO crm_integrations."TenantIntegration"
         (id, "tenantId", provider, label, status, config, "secretCiphertext", "wrappedDek",
          "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour",
          "lastTestedAt", "lastError", "connectedById", "updatedAt")
       VALUES ($1, $2, $3, $4, 'connected', $5::jsonb, $6, $7, $8, $9, $10, $11, $12,
               now(), NULL, $13, now())
       ON CONFLICT ("tenantId", provider, label) DO UPDATE SET
         status = 'connected', config = EXCLUDED.config,
         "secretCiphertext" = EXCLUDED."secretCiphertext", "wrappedDek" = EXCLUDED."wrappedDek",
         "secretIv" = EXCLUDED."secretIv", "secretTag" = EXCLUDED."secretTag",
         "kekVersion" = EXCLUDED."kekVersion", "secretFingerprint" = EXCLUDED."secretFingerprint",
         "lastFour" = EXCLUDED."lastFour", "lastTestedAt" = now(), "lastError" = NULL,
         "connectedById" = EXCLUDED."connectedById", "updatedAt" = now()
       RETURNING id`,
      [
        integrationId, tenantId, PROVIDER, LABEL, JSON.stringify(stripeAccountConfig(account)),
        encrypted.ciphertext, encrypted.wrappedDek, encrypted.iv, encrypted.tag,
        encrypted.kekVersion, encrypted.fingerprint, connected.accountId.slice(-4),
        storedState.initiatedById,
      ],
    );
    await recordIntegrationAudit(
      callbackReq,
      'integration.connected',
      'Agency Stripe account connected',
      saved.rows[0].id,
      db,
    );
  }), req.requestId);
  return res.redirect(managementRedirect('connected'));
}

export async function testStripeIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Stripe test data.' });
  }
  const tenantId = requireTenantId();
  const row = await findStripeIntegration(tenantId);
  if (!row || row.status !== 'connected') {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Stripe is not connected.' });
  }

  try {
    const secret = await decryptSecret(row);
    const account = await getStripeAccount(secret.accessToken);
    if (account.id !== row.config?.accountId) throw new Error('Stripe account identity did not match');
    const config = stripeAccountConfig(account);
    await tenantDb.transaction(async (db) => {
      await db.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET config = $1::jsonb, "lastTestedAt" = now(), "lastError" = NULL, "updatedAt" = now()
          WHERE id = $2 AND "tenantId" = $3`,
        [JSON.stringify(config), row.id, tenantId],
      );
      await recordIntegrationAudit(req, 'integration.tested', 'Agency Stripe connection tested successfully', row.id, db);
    });
    return res.json({ success: true, data: publicStatus({ ...row, config, lastTestedAt: new Date(), lastError: null }) });
  } catch (error) {
    req.log?.warn?.({ tenantId, providerStatus: error?.status, providerCode: error?.providerCode }, 'Stripe connection test failed');
    const message = 'Stripe connection could not be verified. Reconnect the account or try again.';
    await tenantDb.transaction(async (db) => {
      await db.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET "lastTestedAt" = now(), "lastError" = $1, "updatedAt" = now()
          WHERE id = $2 AND "tenantId" = $3`,
        [message, row.id, tenantId],
      );
      await recordIntegrationAudit(req, 'integration.tested', 'Agency Stripe connection test failed', row.id, db);
    });
    return res.status(502).json({ success: false, code: 'STRIPE_TEST_FAILED', message });
  }
}

export async function disconnectStripe(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Stripe disconnect data.' });
  }
  const tenantId = requireTenantId();
  const row = await findStripeIntegration(tenantId);
  if (!row) return res.json({ success: true, data: publicStatus(null) });
  if (row.secretCiphertext && row.config?.accountId) {
    try {
      await deauthorizeStripeAccount(row.config.accountId);
    } catch (error) {
      req.log?.warn?.({ tenantId, providerStatus: error?.status, providerCode: error?.providerCode }, 'Stripe account deauthorization failed');
      return res.status(502).json({
        success: false,
        code: 'STRIPE_DISCONNECT_FAILED',
        message: 'Stripe could not revoke this connection. Try again.',
      });
    }
  }

  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', config = '{}'::jsonb,
              "secretCiphertext" = NULL, "wrappedDek" = NULL, "secretIv" = NULL,
              "secretTag" = NULL, "kekVersion" = NULL, "secretFingerprint" = NULL,
              "lastFour" = NULL, "lastTestedAt" = NULL, "lastError" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency Stripe account disconnected', row.id, db);
  });
  return res.json({ success: true, data: publicStatus(null) });
}

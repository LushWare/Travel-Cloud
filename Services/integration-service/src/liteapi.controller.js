import { z } from 'zod';
import { requireTenantId } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { integrationIdFor } from './integrationIdentity.js';
import logger from './config/logger.js';
import { liteApiKeySchema, liteApiModeOf, verifyLiteApiKey } from './liteapi.js';

// Settings > Integrations > Hotels. The agency pastes an API key from its own LiteAPI dashboard;
// package-service then searches and books hotels with it (internal credentials route below).

const PROVIDER = 'liteapi';
const LABEL = 'hotels';
const KEY_REJECTED = 'LiteAPI did not accept this API key. Copy it again from your LiteAPI dashboard (API Keys).';
const emptySchema = z.object({}).strict();

async function findLiteApiIntegration() {
  const tenantId = requireTenantId();
  const result = await tenantDb.query(
    `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion", "lastFour", "lastTestedAt", "lastError"
       FROM crm_integrations."TenantIntegration"
      WHERE "tenantId" = $1 AND provider = $2 AND label = $3
      LIMIT 1`,
    [tenantId, PROVIDER, LABEL],
  );
  return result.rows[0] || null;
}

function publicStatus(row) {
  return {
    connected: row?.status === 'connected',
    status: row?.status || 'disconnected',
    provider: PROVIDER,
    mode: row?.config?.mode || null,
    lastFour: row?.lastFour || null,
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
  };
}

export async function getLiteApiIntegration(req, res) {
  return res.json({ success: true, data: publicStatus(await findLiteApiIntegration()) });
}

export async function saveLiteApiIntegration(req, res) {
  const parsed = liteApiKeySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Paste a LiteAPI key. It starts with sand_ or prod_.' });
  }
  const { apiKey } = parsed.data;
  const tenantId = requireTenantId();
  const current = await findLiteApiIntegration();

  try {
    await verifyLiteApiKey(apiKey);
  } catch (error) {
    logger.warn({ tenantId, err: { message: error.message, status: error.status } }, 'LiteAPI key check failed');
    await recordIntegrationAudit(req, 'integration.tested', 'Agency LiteAPI connection test failed', current?.id || null);
    return res.status(400).json({ success: false, code: 'LITEAPI_KEY_REJECTED', message: KEY_REJECTED });
  }

  const integrationId = integrationIdFor(tenantId, PROVIDER, LABEL);
  const encrypted = await encryptSecret({ apiKey }, { tenantId, integrationId, provider: PROVIDER });
  const config = { mode: liteApiModeOf(apiKey) };
  const saved = await tenantDb.transaction(async (db) => {
    const result = await db.query(
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
       RETURNING id, status, config, "lastFour", "lastTestedAt", "lastError"`,
      [
        integrationId, tenantId, PROVIDER, LABEL, JSON.stringify(config), encrypted.ciphertext,
        encrypted.wrappedDek, encrypted.iv, encrypted.tag, encrypted.kekVersion, encrypted.fingerprint,
        apiKey.slice(-4), req.headers['x-user-id'],
      ],
    );
    const action = current?.status && current.status !== 'revoked' ? 'integration.changed' : 'integration.connected';
    await recordIntegrationAudit(
      req,
      action,
      action === 'integration.changed' ? 'Agency LiteAPI hotels account changed' : 'Agency LiteAPI hotels account connected',
      result.rows[0].id,
      db,
    );
    return result.rows[0];
  });
  return res.json({ success: true, data: publicStatus(saved) });
}

export async function testLiteApiIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected test request data.' });
  }
  const row = await findLiteApiIntegration();
  if (!row || row.status === 'revoked') {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'LiteAPI is not connected.' });
  }
  let failed = false;
  try {
    const secret = await decryptSecret(row);
    await verifyLiteApiKey(secret.apiKey);
  } catch (error) {
    failed = true;
    logger.warn({ tenantId: row.tenantId, err: { message: error.message, status: error.status } }, 'LiteAPI connection test failed');
  }
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET "lastTestedAt" = now(), "lastError" = $1, status = $2, "updatedAt" = now()
        WHERE id = $3 AND "tenantId" = $4`,
      [failed ? KEY_REJECTED : null, failed ? 'error' : 'connected', row.id, row.tenantId],
    );
    await recordIntegrationAudit(
      req,
      'integration.tested',
      failed ? 'Agency LiteAPI connection test failed' : 'Agency LiteAPI connection tested successfully',
      row.id,
      db,
    );
  });
  if (failed) return res.status(502).json({ success: false, code: 'LITEAPI_KEY_REJECTED', message: KEY_REJECTED });
  return res.json({ success: true, message: 'LiteAPI connection verified.' });
}

export async function disconnectLiteApi(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected disconnect request data.' });
  }
  const row = await findLiteApiIntegration();
  if (!row) return res.json({ success: true, data: publicStatus(null) });
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', config = '{}'::jsonb, "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, row.tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency LiteAPI hotels account disconnected', row.id, db);
  });
  return res.json({ success: true, data: publicStatus(null) });
}

/**
 * package-service only (internal token): the agency's LiteAPI key, so hotel search and booking
 * run on the agency's own account. 404 when the agency has not connected one.
 */
export async function getLiteApiCredentials(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected request data.' });
  }
  const row = await findLiteApiIntegration();
  if (!row || row.status === 'revoked' || !row.secretCiphertext) {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'LiteAPI is not connected.' });
  }
  const secret = await decryptSecret(row);
  return res.json({ success: true, data: { apiKey: secret.apiKey, mode: row.config?.mode || liteApiModeOf(secret.apiKey) } });
}

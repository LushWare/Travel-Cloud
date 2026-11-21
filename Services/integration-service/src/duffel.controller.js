import { z } from 'zod';
import { requireTenantId } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { integrationIdFor } from './integrationIdentity.js';
import logger from './config/logger.js';
import {
  createDuffelWebhook,
  deleteDuffelWebhook,
  duffelModeOf,
  duffelTokenSchema,
  verifyDuffelToken,
} from './duffel.js';

// Settings > Integrations > Flights. The agency pastes an access token from its own Duffel
// dashboard; flight-service then searches and books with it (internal credentials route below).

const PROVIDER = 'duffel';
const LABEL = 'flights';
const TOKEN_REJECTED = 'Duffel did not accept this access token. Copy it again from your Duffel dashboard (Developers > Access tokens).';
const emptySchema = z.object({}).strict();

async function findDuffelIntegration() {
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
  const connected = row?.status === 'connected';
  return {
    connected,
    status: row?.status || 'disconnected',
    provider: PROVIDER,
    mode: row?.config?.mode || null,
    lastFour: row?.lastFour || null,
    // Whether Duffel sends booking changes (ticket issued, schedule change, cancellation) to us.
    bookingUpdates: row?.config?.webhookId ? 'on' : 'off',
    bookingUpdatesNote: row?.config?.webhookNote || null,
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
  };
}

/** Where Duffel posts this agency's booking updates. The agency is in the path; the signature proves it. */
export function duffelWebhookUrl(tenantId) {
  const base = (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/v1/webhooks/duffel-flights/${tenantId}`;
}

const isPublicHttps = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && hostname !== 'localhost' && !/^[\d.]+$/.test(hostname);
  } catch {
    return false;
  }
};

/** Best effort: a webhook that can't be made leaves the connection working, with updates off. */
async function setUpWebhook(accessToken, tenantId) {
  const url = duffelWebhookUrl(tenantId);
  if (!url || !isPublicHttps(url)) {
    return { webhook: null, note: 'Automatic booking updates need the live site address. Bookings still work; refresh a booking to see changes.' };
  }
  try {
    return { webhook: await createDuffelWebhook(accessToken, url), note: null };
  } catch (error) {
    logger.warn({ tenantId, err: { message: error.message, status: error.status } }, 'Duffel webhook could not be created');
    return {
      webhook: null,
      note: 'Duffel would not add our booking-update address (an account can have only one per mode). Remove the existing webhook in your Duffel dashboard, then reconnect.',
    };
  }
}

async function removeWebhook(row) {
  if (!row?.config?.webhookId || !row.secretCiphertext) return;
  try {
    const secret = await decryptSecret(row);
    await deleteDuffelWebhook(secret.accessToken, row.config.webhookId);
  } catch (error) {
    logger.warn({ tenantId: row.tenantId, err: { message: error.message, status: error.status } }, 'Old Duffel webhook could not be removed');
  }
}

export async function getDuffelIntegration(req, res) {
  return res.json({ success: true, data: publicStatus(await findDuffelIntegration()) });
}

export async function saveDuffelIntegration(req, res) {
  const parsed = duffelTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Paste a Duffel access token. It starts with duffel_test_ or duffel_live_.' });
  }
  const { accessToken } = parsed.data;
  const tenantId = requireTenantId();
  const current = await findDuffelIntegration();

  try {
    await verifyDuffelToken(accessToken);
  } catch (error) {
    logger.warn({ tenantId, err: { message: error.message, status: error.status } }, 'Duffel token check failed');
    await recordIntegrationAudit(req, 'integration.tested', 'Agency Duffel connection test failed', current?.id || null);
    return res.status(400).json({ success: false, code: 'DUFFEL_TOKEN_REJECTED', message: TOKEN_REJECTED });
  }

  // A new token replaces the old account's webhook, so the old account stops sending us updates.
  await removeWebhook(current);
  const { webhook, note } = await setUpWebhook(accessToken, tenantId);

  const integrationId = integrationIdFor(tenantId, PROVIDER, LABEL);
  const encrypted = await encryptSecret(
    { accessToken, ...(webhook && { webhookSecret: webhook.secret }) },
    { tenantId, integrationId, provider: PROVIDER },
  );
  const config = { mode: duffelModeOf(accessToken), webhookId: webhook?.id || null, webhookNote: note };
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
        accessToken.slice(-4), req.headers['x-user-id'],
      ],
    );
    const action = current?.status && current.status !== 'revoked' ? 'integration.changed' : 'integration.connected';
    await recordIntegrationAudit(
      req,
      action,
      action === 'integration.changed' ? 'Agency Duffel flights account changed' : 'Agency Duffel flights account connected',
      result.rows[0].id,
      db,
    );
    return result.rows[0];
  });
  return res.json({ success: true, data: publicStatus(saved) });
}

export async function testDuffelIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected test request data.' });
  }
  const row = await findDuffelIntegration();
  if (!row || row.status === 'revoked') {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Duffel is not connected.' });
  }
  let failed = false;
  try {
    const secret = await decryptSecret(row);
    await verifyDuffelToken(secret.accessToken);
  } catch (error) {
    failed = true;
    logger.warn({ tenantId: row.tenantId, err: { message: error.message, status: error.status } }, 'Duffel connection test failed');
  }
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET "lastTestedAt" = now(), "lastError" = $1, status = $2, "updatedAt" = now()
        WHERE id = $3 AND "tenantId" = $4`,
      [failed ? TOKEN_REJECTED : null, failed ? 'error' : 'connected', row.id, row.tenantId],
    );
    await recordIntegrationAudit(
      req,
      'integration.tested',
      failed ? 'Agency Duffel connection test failed' : 'Agency Duffel connection tested successfully',
      row.id,
      db,
    );
  });
  if (failed) return res.status(502).json({ success: false, code: 'DUFFEL_TOKEN_REJECTED', message: TOKEN_REJECTED });
  return res.json({ success: true, message: 'Duffel connection verified.' });
}

export async function disconnectDuffel(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected disconnect request data.' });
  }
  const row = await findDuffelIntegration();
  if (!row) return res.json({ success: true, data: publicStatus(null) });
  await removeWebhook(row);
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', config = '{}'::jsonb, "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, row.tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency Duffel flights account disconnected', row.id, db);
  });
  return res.json({ success: true, data: publicStatus(null) });
}

/**
 * flight-service only (internal token): the agency's Duffel token and webhook secret, so flight
 * search and booking run on the agency's own account. 404 when the agency has not connected one.
 */
export async function getDuffelCredentials(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected request data.' });
  }
  const row = await findDuffelIntegration();
  if (!row || row.status === 'revoked' || !row.secretCiphertext) {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Duffel is not connected.' });
  }
  const secret = await decryptSecret(row);
  return res.json({
    success: true,
    data: {
      accessToken: secret.accessToken,
      webhookSecret: secret.webhookSecret || null,
      mode: row.config?.mode || duffelModeOf(secret.accessToken),
    },
  });
}

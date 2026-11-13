import { z } from 'zod';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { requireTenantId, runWithTenant } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { sendSmtp, smtpSchema, verifySmtp } from './smtp.js';
import { sendEmailSchema } from './email.validator.js';
import { integrationIdFor } from './integrationIdentity.js';

const PROVIDER = 'smtp';
const LABEL = 'primary';
const GOOGLE_ADS_PROVIDER = 'google_ads';
const GOOGLE_ADS_LABEL = 'lead_forms';
const safeError = 'SMTP connection failed. Check the server and login details.';
const emptySchema = z.object({}).strict();
const googleAdsWebhookSchema = z.object({ google_key: z.string().min(1).max(256) }).passthrough();

function publicStatus(row) {
  if (!row) return { connected: false, provider: PROVIDER };
  return {
    connected: row.status === 'connected',
    status: row.status,
    provider: PROVIDER,
    config: row.config,
    fingerprint: row.secretFingerprint,
    lastFour: row.lastFour,
    lastTestedAt: row.lastTestedAt,
    lastError: row.lastError,
  };
}

async function findIntegration(req, provider = PROVIDER, label = LABEL) {
  const tenantId = requireTenantId();
  const result = await tenantDb.query(
    `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour",
            "lastTestedAt", "lastError"
       FROM crm_integrations."TenantIntegration"
      WHERE "tenantId" = $1 AND provider = $2 AND label = $3
      LIMIT 1`,
    [tenantId, provider, label],
  );
  return result.rows[0] || null;
}

export async function getEmailIntegration(req, res) {
  const row = await findIntegration(req);
  return res.json({ success: true, data: publicStatus(row) });
}

export async function saveEmailIntegration(req, res) {
  const parsed = smtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Check the SMTP settings.' });
  }
  const config = parsed.data;
  const tenantId = requireTenantId();
  const current = await findIntegration(req);
  try {
    await verifySmtp(config);
  } catch {
    await recordIntegrationAudit(req, 'integration.tested', 'Agency SMTP connection test failed', current?.id || null);
    return res.status(400).json({ success: false, code: 'SMTP_TEST_FAILED', message: safeError });
  }
  await recordIntegrationAudit(req, 'integration.tested', 'Agency SMTP connection tested successfully', current?.id || null);

  const integrationId = integrationIdFor(tenantId);
  const encrypted = await encryptSecret(
    { username: config.username, password: config.password },
    { tenantId, integrationId, provider: PROVIDER },
  );
  const publicConfig = { host: config.host, port: config.port, secure: config.secure, from: config.from, replyTo: config.replyTo || null };
  const lastFour = config.username.slice(-4);
  const result = await tenantDb.transaction(async (db) => {
    const saved = await db.query(
      `INSERT INTO crm_integrations."TenantIntegration"
         (id, "tenantId", provider, label, status, config, "secretCiphertext", "wrappedDek",
          "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour",
          "lastTestedAt", "lastError", "connectedById", "updatedAt")
             VALUES ($1, $2, $3, $4, 'connected', $5::jsonb, $6, $7, $8, $9, $10, $11, $12,
               NULL, NULL, $13, now())
       ON CONFLICT ("tenantId", provider, label) DO UPDATE SET
         status = 'connected', config = EXCLUDED.config,
         "secretCiphertext" = EXCLUDED."secretCiphertext", "wrappedDek" = EXCLUDED."wrappedDek",
         "secretIv" = EXCLUDED."secretIv", "secretTag" = EXCLUDED."secretTag",
         "kekVersion" = EXCLUDED."kekVersion", "secretFingerprint" = EXCLUDED."secretFingerprint",
         "lastFour" = EXCLUDED."lastFour", "lastTestedAt" = NULL, "lastError" = NULL,
         "connectedById" = EXCLUDED."connectedById", "updatedAt" = now()
       RETURNING id, "tenantId", provider, status, config, "secretFingerprint", "lastFour", "lastTestedAt", "lastError"`,
      [
        integrationId, tenantId, PROVIDER, LABEL, JSON.stringify(publicConfig), encrypted.ciphertext,
        encrypted.wrappedDek, encrypted.iv, encrypted.tag, encrypted.kekVersion, encrypted.fingerprint,
        lastFour, req.headers['x-user-id'],
      ],
    );
    const action = current?.status && current.status !== 'revoked' ? 'integration.changed' : 'integration.connected';
    const summary = action === 'integration.changed'
      ? 'Agency SMTP email settings changed'
      : 'Agency SMTP email connected';
    await recordIntegrationAudit(req, action, summary, saved.rows[0].id, db);
    return saved;
  });
  return res.json({ success: true, data: publicStatus(result.rows[0]) });
}

export async function testEmailIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected test request data.' });
  }
  const row = await findIntegration(req);
  if (!row || row.status !== 'connected') {
    await recordIntegrationAudit(req, 'integration.tested', 'Agency SMTP connection test failed', row?.id || null);
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Email is not connected.' });
  }
  let connectionError = false;
  try {
    const secret = await decryptSecret(row);
    await verifySmtp({ ...row.config, ...secret });
  } catch {
    connectionError = true;
  }
  if (connectionError) {
    await tenantDb.transaction(async (db) => {
      await db.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET "lastTestedAt" = now(), "lastError" = $1, status = 'error', "updatedAt" = now()
          WHERE id = $2 AND "tenantId" = $3`,
        [safeError, row.id, row.tenantId],
      );
      await recordIntegrationAudit(req, 'integration.tested', 'Agency SMTP connection test failed', row.id, db);
    });
    return res.status(502).json({ success: false, code: 'SMTP_TEST_FAILED', message: safeError });
  }
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET "lastTestedAt" = now(), "lastError" = NULL, status = 'connected', "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, row.tenantId],
    );
    await recordIntegrationAudit(req, 'integration.tested', 'Agency SMTP connection tested successfully', row.id, db);
  });
  return res.json({ success: true, message: 'SMTP connection verified.' });
}

export async function disconnectEmail(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected disconnect request data.' });
  }
  const row = await findIntegration(req);
  if (!row) return res.json({ success: true, data: { connected: false, provider: PROVIDER } });
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, row.tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency SMTP email disconnected', row.id, db);
  });
  return res.json({ success: true, data: { connected: false, provider: PROVIDER } });
}

export async function sendAgencyEmail(req, res) {
  const parsed = sendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Check the email message.' });
  }
  const row = await findIntegration(req);
  if (!row || row.status === 'revoked') {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Agency email is not connected.' });
  }
  if (row.status !== 'connected') {
    return res.status(503).json({ success: false, code: 'EMAIL_INTEGRATION_UNAVAILABLE', message: 'Agency email is temporarily unavailable.' });
  }
  const secret = await decryptSecret(row);
  const result = await sendSmtp({ ...row.config, ...secret }, parsed.data);
  return res.json({ success: true, data: result });
}

function googleAdsWebhookUrl(tenantId) {
  const baseUrl = (process.env.PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')).replace(/\/$/, '');
  if (!baseUrl) throw new Error('Public API URL is not configured');
  return `${baseUrl}/api/v1/webhooks/google-ads/${tenantId}`;
}

function googleAdsPublicStatus(row, tenantId) {
  return {
    connected: row?.status === 'connected',
    status: row?.status || 'disconnected',
    provider: GOOGLE_ADS_PROVIDER,
    webhookUrl: googleAdsWebhookUrl(tenantId),
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
  };
}

export async function getGoogleAdsIntegration(req, res) {
  const tenantId = requireTenantId();
  const row = await findIntegration(req, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL);
  return res.json({ success: true, data: googleAdsPublicStatus(row, tenantId) });
}

export async function saveGoogleAdsIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Google Ads settings.' });
  }
  const tenantId = requireTenantId();
  const current = await findIntegration(req, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL);
  const integrationId = integrationIdFor(tenantId, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL);
  const webhookKey = randomBytes(32).toString('base64url');
  const encrypted = await encryptSecret(
    { webhookKey },
    { tenantId, integrationId, provider: GOOGLE_ADS_PROVIDER },
  );
  const publicConfig = { webhookUrl: googleAdsWebhookUrl(tenantId) };
  const result = await tenantDb.transaction(async (db) => {
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
       RETURNING id, status, "lastTestedAt", "lastError"`,
      [
        integrationId, tenantId, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL,
        JSON.stringify(publicConfig), encrypted.ciphertext, encrypted.wrappedDek,
        encrypted.iv, encrypted.tag, encrypted.kekVersion, encrypted.fingerprint,
        webhookKey.slice(-4), req.headers['x-user-id'],
      ],
    );
    const action = current?.status === 'connected' ? 'integration.changed' : 'integration.connected';
    const summary = action === 'integration.changed'
      ? 'Agency Google Ads webhook key rotated'
      : 'Agency Google Ads lead integration connected';
    await recordIntegrationAudit(req, action, summary, saved.rows[0].id, db);
    return saved.rows[0];
  });
  return res.json({
    success: true,
    data: { ...googleAdsPublicStatus(result, tenantId), webhookKey },
  });
}

export async function disconnectGoogleAdsIntegration(req, res) {
  if (!emptySchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected disconnect request data.' });
  }
  const row = await findIntegration(req, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL);
  const tenantId = requireTenantId();
  if (!row) return res.json({ success: true, data: googleAdsPublicStatus(null, tenantId) });
  await tenantDb.transaction(async (db) => {
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency Google Ads lead integration disconnected', row.id, db);
  });
  return res.json({ success: true, data: googleAdsPublicStatus(null, tenantId) });
}

export async function verifyGoogleAdsWebhookKey(req, res) {
  const parsed = googleAdsWebhookSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Invalid Google Ads webhook request.' });
  }
  const tenantId = req.params.tenantId;
  try {
    return await runWithTenant(tenantId, async () => {
      const row = await findIntegration(req, GOOGLE_ADS_PROVIDER, GOOGLE_ADS_LABEL);
      if (!row || row.tenantId !== tenantId || row.status !== 'connected') {
        return res.status(401).json({ success: false, code: 'INVALID_WEBHOOK_CREDENTIAL' });
      }
      const secret = await decryptSecret(row);
      const received = Buffer.from(parsed.data.google_key);
      const expected = Buffer.from(secret.webhookKey || '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return res.status(401).json({ success: false, code: 'INVALID_WEBHOOK_CREDENTIAL' });
      }
      await tenantDb.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET "lastTestedAt" = now(), "lastError" = NULL, "updatedAt" = now()
          WHERE id = $1 AND "tenantId" = $2`,
        [row.id, tenantId],
      );
      return res.json({ success: true, data: { tenantId } });
    });
  } catch (error) {
    if (error?.name === 'TypeError') {
      return res.status(400).json({ success: false, code: 'INVALID_WEBHOOK_CREDENTIAL' });
    }
    throw error;
  }
}

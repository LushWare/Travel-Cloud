import { z } from 'zod';
import { requireTenantId } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { integrationIdFor } from './integrationIdentity.js';
import {
  exchangeWhatsappSignupCode,
  getWhatsappPhoneNumber,
  registerWhatsappPhone,
  subscribeWhatsappApp,
  unsubscribeWhatsappApp,
} from './whatsapp.js';
import { sendWhatsappSchema } from './whatsapp.validator.js';

const PROVIDER = 'whatsapp';
const LABEL = 'business';
const connectSchema = z.object({
  code: z.string().trim().min(1).max(4096),
  wabaId: z.string().regex(/^\d{1,30}$/),
  phoneNumberId: z.string().regex(/^\d{1,30}$/),
  pin: z.string().regex(/^\d{6}$/),
}).strict();

async function findWhatsappIntegration(tenantId) {
  const result = await tenantDb.query(
    `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion", "lastTestedAt", "lastError"
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
    displayPhoneNumber: row?.config?.displayPhoneNumber || null,
    verifiedName: row?.config?.verifiedName || null,
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
    appId: process.env.FACEBOOK_APP_ID || null,
    configurationId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || null,
    graphApiVersion: process.env.FACEBOOK_GRAPH_API_VERSION || 'v27.0',
  };
}

export async function getWhatsappIntegration(req, res) {
  const row = await findWhatsappIntegration(requireTenantId());
  return res.json({ success: true, data: publicStatus(row) });
}

export async function connectWhatsapp(req, res) {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Complete the WhatsApp connection details.' });
  }
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET || !process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID) {
    return res.status(503).json({ success: false, code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp connection is not configured.' });
  }

  const tenantId = requireTenantId();
  const { code, wabaId, phoneNumberId, pin } = parsed.data;
  const existingRoute = await tenantDb.resolveWhatsappPhone(phoneNumberId);
  if (existingRoute && existingRoute.tenantId !== tenantId) {
    return res.status(409).json({ success: false, code: 'WHATSAPP_PHONE_ALREADY_CONNECTED', message: 'This WhatsApp number is already connected to another agency.' });
  }

  const current = await findWhatsappIntegration(tenantId);
  if (current?.status === 'connected' && current.config?.phoneNumberId !== phoneNumberId) {
    return res.status(409).json({ success: false, code: 'DISCONNECT_WHATSAPP_FIRST', message: 'Disconnect the current WhatsApp number before connecting another.' });
  }

  let accessToken;
  let phone;
  try {
    accessToken = await exchangeWhatsappSignupCode(code);
    phone = await getWhatsappPhoneNumber(wabaId, phoneNumberId, accessToken);
  } catch (error) {
    req.log?.warn?.({ tenantId, providerStatus: error?.status, providerCode: error?.providerCode }, 'WhatsApp signup authorization failed');
    return res.status(502).json({ success: false, code: 'WHATSAPP_AUTHORIZATION_FAILED', message: 'Meta could not authorize this WhatsApp account.' });
  }

  const integrationId = integrationIdFor(tenantId, PROVIDER, LABEL);
  const encrypted = await encryptSecret(
    { accessToken },
    { tenantId, integrationId, provider: PROVIDER },
  );
  const config = {
    wabaId,
    phoneNumberId,
    displayPhoneNumber: phone.display_phone_number || null,
    verifiedName: phone.verified_name || null,
  };
  await tenantDb.transaction(async (db) => {
    await db.query(
      `INSERT INTO crm_integrations."TenantIntegration"
         (id, "tenantId", provider, label, status, config, "secretCiphertext", "wrappedDek",
          "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour", "connectedById", "updatedAt")
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, now())
       ON CONFLICT ("tenantId", provider, label) DO UPDATE SET
         status = 'pending', config = EXCLUDED.config,
         "secretCiphertext" = EXCLUDED."secretCiphertext", "wrappedDek" = EXCLUDED."wrappedDek",
         "secretIv" = EXCLUDED."secretIv", "secretTag" = EXCLUDED."secretTag",
         "kekVersion" = EXCLUDED."kekVersion", "secretFingerprint" = EXCLUDED."secretFingerprint",
         "lastFour" = EXCLUDED."lastFour", "lastError" = NULL,
         "connectedById" = EXCLUDED."connectedById", "updatedAt" = now()` ,
      [
        integrationId, tenantId, PROVIDER, LABEL, JSON.stringify(config), encrypted.ciphertext,
        encrypted.wrappedDek, encrypted.iv, encrypted.tag, encrypted.kekVersion,
        encrypted.fingerprint, phone.display_phone_number?.slice(-4) || null, req.headers['x-user-id'],
      ],
    );
  });

  try {
    await subscribeWhatsappApp(wabaId, accessToken);
    await registerWhatsappPhone(phoneNumberId, accessToken, pin);
    await tenantDb.transaction(async (db) => {
      await db.query(
        `INSERT INTO crm_integrations."WhatsappPhoneRoute" ("phoneNumberId", "tenantId", "integrationId")
         VALUES ($1, $2, $3)
         ON CONFLICT ("phoneNumberId") DO UPDATE SET "tenantId" = EXCLUDED."tenantId", "integrationId" = EXCLUDED."integrationId"
         WHERE crm_integrations."WhatsappPhoneRoute"."tenantId" = EXCLUDED."tenantId"`,
        [phoneNumberId, tenantId, integrationId],
      );
      const routeResult = await db.query(
        'SELECT "tenantId" FROM crm_integrations."WhatsappPhoneRoute" WHERE "phoneNumberId" = $1',
        [phoneNumberId],
      );
      if (routeResult.rows[0]?.tenantId !== tenantId) {
        const conflict = new Error('WhatsApp number is already connected to another agency');
        conflict.code = 'WHATSAPP_PHONE_ALREADY_CONNECTED';
        throw conflict;
      }
      await db.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET status = 'connected', "lastTestedAt" = now(), "lastError" = NULL, "updatedAt" = now()
          WHERE id = $1 AND "tenantId" = $2`,
        [integrationId, tenantId],
      );
      await recordIntegrationAudit(req, current?.status === 'connected' ? 'integration.changed' : 'integration.connected', 'Agency WhatsApp Business account connected', integrationId, db);
    });
  } catch (error) {
    req.log?.warn?.({ tenantId, providerStatus: error?.status, providerCode: error?.providerCode }, 'WhatsApp account registration failed');
    await tenantDb.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'error', "lastError" = $1, "updatedAt" = now()
        WHERE id = $2 AND "tenantId" = $3`,
      ['WhatsApp account registration failed. Try connecting again.', integrationId, tenantId],
    );
    if (error?.code === 'WHATSAPP_PHONE_ALREADY_CONNECTED' || error?.code === '23505') {
      return res.status(409).json({ success: false, code: 'WHATSAPP_PHONE_ALREADY_CONNECTED', message: 'This WhatsApp number is already connected to another agency.' });
    }
    return res.status(502).json({ success: false, code: 'WHATSAPP_REGISTRATION_FAILED', message: 'Meta could not finish setting up this WhatsApp number.' });
  }

  return res.json({ success: true, data: publicStatus({ status: 'connected', config, lastTestedAt: new Date() }) });
}

export async function disconnectWhatsapp(req, res) {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected WhatsApp disconnect data.' });
  }
  const tenantId = requireTenantId();
  const row = await findWhatsappIntegration(tenantId);
  if (!row) return res.json({ success: true, data: publicStatus(null) });
  if (row.secretCiphertext && row.config?.wabaId) {
    try {
      const secret = await decryptSecret(row);
      await unsubscribeWhatsappApp(row.config.wabaId, secret.accessToken);
    } catch (error) {
      req.log?.warn?.({ tenantId, providerStatus: error?.status, providerCode: error?.providerCode }, 'WhatsApp webhook unsubscribe failed');
    }
  }
  await tenantDb.transaction(async (db) => {
    await db.query(
      'DELETE FROM crm_integrations."WhatsappPhoneRoute" WHERE "tenantId" = $1 AND "integrationId" = $2',
      [tenantId, row.id],
    );
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency WhatsApp Business account disconnected', row.id, db);
  });
  return res.json({ success: true, data: publicStatus(null) });
}

export async function resolveWhatsappPhone(req, res) {
  const parsed = z.object({ phoneNumberId: z.string().regex(/^\d{1,30}$/) }).strict().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED' });
  }
  const route = await tenantDb.resolveWhatsappPhone(parsed.data.phoneNumberId);
  if (!route) {
    return res.status(404).json({ success: false, code: 'WHATSAPP_ROUTE_NOT_FOUND' });
  }
  return res.json({ success: true, data: { tenantId: route.tenantId } });
}

function buildMessage(parsed) {
  const to = parsed.to.replace(/\D/g, '');
  if (parsed.type === 'text') {
    return { to, type: 'text', text: { body: parsed.body, preview_url: false } };
  }

  const components = [];
  if (parsed.headerDocument?.link) {
    components.push({
      type: 'header',
      parameters: [{
        type: 'document',
        document: { link: parsed.headerDocument.link, filename: parsed.headerDocument.filename },
      }],
    });
  }
  if (parsed.bodyParams?.length) {
    components.push({
      type: 'body',
      parameters: parsed.bodyParams.map((text) => ({ type: 'text', text })),
    });
  }
  return {
    to,
    type: 'template',
    template: {
      name: parsed.templateName,
      language: { code: parsed.languageCode },
      components,
    },
  };
}

export async function sendAgencyWhatsapp(req, res) {
  const parsed = sendWhatsappSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED' });
  }

  const tenantId = requireTenantId();
  const result = await tenantDb.query(
    `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion"
       FROM crm_integrations."TenantIntegration"
      WHERE "tenantId" = $1 AND provider = $2 AND label = $3
      LIMIT 1`,
    [tenantId, PROVIDER, LABEL],
  );
  const integration = result.rows[0];
  if (!integration || integration.status !== 'connected') {
    return res.status(404).json({
      success: false,
      code: 'INTEGRATION_NOT_CONNECTED',
      message: 'WhatsApp is not connected for this agency.',
    });
  }

  const phoneNumberId = integration.config?.phoneNumberId;
  if (!phoneNumberId) {
    return res.status(503).json({ success: false, code: 'WHATSAPP_INTEGRATION_UNAVAILABLE' });
  }

  const secret = await decryptSecret(integration);
  const apiVersion = process.env.FACEBOOK_GRAPH_API_VERSION || 'v27.0';
  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret.accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...buildMessage(parsed.data) }),
    signal: AbortSignal.timeout(10_000),
  });
  const providerResult = await response.json().catch(() => ({}));
  if (!response.ok) {
    req.log?.warn?.({ providerStatus: response.status }, 'Agency WhatsApp delivery failed');
    return res.status(502).json({ success: false, code: 'WHATSAPP_SEND_FAILED' });
  }

  return res.json({
    success: true,
    data: { messageId: providerResult.messages?.[0]?.id || null },
  });
}
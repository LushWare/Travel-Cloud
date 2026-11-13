import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requireTenantId, runWithTenant } from '../../shared/tenancy/src/context.js';
import { tenantDb } from './db.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { recordIntegrationAudit } from './audit.js';
import { integrationIdFor } from './integrationIdentity.js';
import {
  createFacebookOAuthState,
  exchangeFacebookCode,
  facebookAuthorizationUrl,
  facebookOAuthCallbackUrl,
  facebookWebhookUrl,
  getFacebookLead,
  listFacebookPages,
  mapFacebookLeadToLead,
  subscribeFacebookPage,
  unsubscribeFacebookPage,
  verifyFacebookOAuthState,
} from './facebook.js';
import logger from './config/logger.js';

const PROVIDER = 'facebook';
const LABEL = 'lead_ads';
const stateSchema = z.string().min(1).max(2048);
const pageIdSchema = z.string().regex(/^\d{1,30}$/);
const metaIdSchema = z.union([
  pageIdSchema,
  z.number().int().nonnegative().safe().transform(String),
]);
const facebookWebhookSchema = z.object({
  object: z.literal('page'),
  entry: z.array(z.object({
    id: metaIdSchema,
    changes: z.array(z.object({
      field: z.string().max(100),
      value: z.object({}).passthrough(),
    }).passthrough()).max(100),
  }).passthrough()).max(100),
}).passthrough();
const pageSelectionSchema = z.object({
  pageIds: z.array(pageIdSchema).min(1).max(100).refine((ids) => new Set(ids).size === ids.length),
}).strict();
const callbackQuerySchema = z.object({
  state: stateSchema,
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
}).passthrough();

function stateHash(state) {
  return createHash('sha256').update(state).digest('hex');
}

function integrationSelect() {
  return `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
                 "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour",
                 "lastTestedAt", "lastError"
            FROM crm_integrations."TenantIntegration"
           WHERE "tenantId" = $1 AND provider = $2 AND label = $3
           LIMIT 1`;
}

async function findFacebookIntegration(tenantId) {
  const result = await tenantDb.query(integrationSelect(), [tenantId, PROVIDER, LABEL]);
  return result.rows[0] || null;
}

function facebookPublicStatus(row, tenantId) {
  return {
    connected: row?.status === 'connected',
    status: row?.status || 'disconnected',
    provider: PROVIDER,
    webhookUrl: facebookWebhookUrl(),
    pages: (row?.config?.pages || []).map(({ id, name, selected }) => ({ id, name, selected: Boolean(selected) })),
    lastTestedAt: row?.lastTestedAt || null,
    lastError: row?.lastError || null,
    tenantId,
  };
}

function managementRedirect(result) {
  const base = process.env.MANAGEMENT_URL;
  if (!base) throw new Error('Management URL is not configured');
  const url = new URL('/settings', base);
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set('facebook', result);
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

export async function getFacebookIntegration(req, res) {
  const tenantId = requireTenantId();
  const row = await findFacebookIntegration(tenantId);
  return res.json({ success: true, data: facebookPublicStatus(row, tenantId) });
}

export async function startFacebookOAuth(req, res) {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Facebook connection data.' });
  }
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    return res.status(503).json({ success: false, code: 'FACEBOOK_NOT_CONFIGURED', message: 'Facebook connection is not configured.' });
  }
  const tenantId = requireTenantId();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const state = createFacebookOAuthState(tenantId, expiresAt);
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
    data: { authorizationUrl: facebookAuthorizationUrl(state), callbackUrl: facebookOAuthCallbackUrl() },
  });
}

export async function completeFacebookOAuth(req, res) {
  const parsed = callbackQuerySchema.safeParse(req.query || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_CALLBACK', message: 'Facebook connection could not be completed.' });
  }
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    return res.status(503).json({ success: false, code: 'FACEBOOK_NOT_CONFIGURED', message: 'Facebook connection is not configured.' });
  }
  const claims = verifyFacebookOAuthState(parsed.data.state);
  if (!claims) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_STATE', message: 'Facebook connection expired. Start again from Management.' });
  }
  const storedState = await consumeOAuthState(claims, parsed.data.state, req.requestId);
  if (!storedState) {
    return res.status(400).json({ success: false, code: 'INVALID_OAUTH_STATE', message: 'Facebook connection expired. Start again from Management.' });
  }
  if (parsed.data.error || !parsed.data.code) {
    return res.redirect(managementRedirect('cancelled'));
  }

  let pages;
  try {
    const userAccessToken = await exchangeFacebookCode(parsed.data.code);
    pages = await listFacebookPages(userAccessToken);
  } catch (error) {
    logger.warn({
      requestId: req.requestId,
      providerStatus: error?.status,
      providerCode: error?.providerCode,
    }, 'Facebook authorization could not retrieve pages');
    return res.redirect(managementRedirect('failed'));
  }
  if (pages.length === 0) return res.redirect(managementRedirect('no-pages'));

  const tenantId = claims.tenantId;
  const integrationId = integrationIdFor(tenantId, PROVIDER, LABEL);
  const { encrypted, publicConfig } = await runWithTenant(tenantId, async () => {
    const existing = await findFacebookIntegration(tenantId);
    const previousSelected = existing?.status === 'connected'
      ? (existing.config?.pages || []).filter((page) => page.selected)
      : [];
    const previousIds = new Set(previousSelected.map((page) => page.id));
    const freshIds = new Set(pages.map((page) => page.id));
    const previousSecret = previousSelected.length ? await decryptSecret(existing) : { pages: [] };
    const previousPagesById = new Map((previousSecret.pages || []).map((page) => [page.id, page]));
    const retainedPages = previousSelected
      .filter((page) => !freshIds.has(page.id))
      .map((page) => previousPagesById.get(page.id))
      .filter(Boolean);
    const allPages = [...pages, ...retainedPages];
    const encrypted = await encryptSecret(
      { pages: allPages },
      { tenantId, integrationId, provider: PROVIDER },
    );
    const publicConfig = {
      pages: allPages.map(({ id, name }) => ({
        id,
        name,
        selected: previousIds.has(id),
      })),
    };
    return { encrypted, publicConfig };
  }, req.requestId);
  const callbackReq = {
    ...req,
    headers: {
      ...req.headers,
      'x-user-id': storedState.initiatedById,
      'x-user-role': 'admin',
      'x-user-email': null,
    },
  };

  await runWithTenant(tenantId, async () => {
    await tenantDb.transaction(async (db) => {
      const saved = await db.query(
        `INSERT INTO crm_integrations."TenantIntegration" AS existing_integration
           (id, "tenantId", provider, label, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion", "secretFingerprint", "lastFour",
            "lastTestedAt", "lastError", "connectedById", "updatedAt")
         VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, $7, $8, $9, $10, $11, NULL,
                 NULL, NULL, $12, now())
         ON CONFLICT ("tenantId", provider, label) DO UPDATE SET
           status = CASE WHEN existing_integration.status = 'connected' THEN 'connected' ELSE 'pending' END,
           config = EXCLUDED.config,
           "secretCiphertext" = EXCLUDED."secretCiphertext", "wrappedDek" = EXCLUDED."wrappedDek",
           "secretIv" = EXCLUDED."secretIv", "secretTag" = EXCLUDED."secretTag",
           "kekVersion" = EXCLUDED."kekVersion", "secretFingerprint" = EXCLUDED."secretFingerprint",
           "lastFour" = NULL,
           "lastTestedAt" = CASE
             WHEN existing_integration.status = 'connected' THEN existing_integration."lastTestedAt"
             ELSE NULL
           END,
           "lastError" = NULL,
           "connectedById" = EXCLUDED."connectedById", "updatedAt" = now()
         RETURNING id`,
        [
          integrationId, tenantId, PROVIDER, LABEL, JSON.stringify(publicConfig),
          encrypted.ciphertext, encrypted.wrappedDek, encrypted.iv, encrypted.tag,
          encrypted.kekVersion, encrypted.fingerprint, storedState.initiatedById,
        ],
      );
      await recordIntegrationAudit(
        callbackReq,
        'integration.connected',
        'Agency Facebook Lead Ads account authorized; existing page routes are retained until selection changes',
        saved.rows[0].id,
        db,
      );
    });
  }, req.requestId);
  return res.redirect(managementRedirect('connected'));
}

export async function selectFacebookPages(req, res) {
  const parsed = pageSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Select one or more Facebook pages.' });
  }
  const tenantId = requireTenantId();
  const row = await findFacebookIntegration(tenantId);
  if (!row || row.status === 'revoked') {
    return res.status(404).json({ success: false, code: 'INTEGRATION_NOT_CONNECTED', message: 'Authorize a Facebook account first.' });
  }
  const secret = await decryptSecret(row);
  const allowedPages = new Map((secret.pages || []).map((page) => [page.id, page]));
  const pages = parsed.data.pageIds.map((id) => allowedPages.get(id));
  if (pages.some((page) => !page)) {
    return res.status(400).json({ success: false, code: 'INVALID_FACEBOOK_PAGE', message: 'A selected page is not available in the connected account.' });
  }

  for (const page of pages) {
    const existing = await tenantDb.resolveFacebookPage(page.id);
    if (existing && (existing.tenantId !== tenantId || existing.integrationId !== row.id)) {
      return res.status(409).json({ success: false, code: 'FACEBOOK_PAGE_ALREADY_CONNECTED', message: 'A selected Facebook page is already connected to another agency.' });
    }
  }

  const previouslySelectedIds = new Set(
    (row.config?.pages || []).filter((page) => page.selected).map((page) => page.id),
  );
  const subscribedPages = [];
  try {
    for (const page of pages) {
      if (previouslySelectedIds.has(page.id)) continue;
      subscribedPages.push(page);
      await subscribeFacebookPage(page.id, page.accessToken);
    }
  } catch (error) {
    for (const page of subscribedPages) {
      try {
        await unsubscribeFacebookPage(page.id, page.accessToken);
      } catch (rollbackError) {
        logger.warn({
          requestId: req.requestId,
          tenantId,
          providerStatus: rollbackError?.status,
          providerCode: rollbackError?.providerCode,
        }, 'Facebook page subscription rollback failed');
      }
    }
    logger.warn({
      requestId: req.requestId,
      tenantId,
      providerStatus: error?.status,
      providerCode: error?.providerCode,
    }, 'Facebook page subscription failed');
    return res.status(502).json({ success: false, code: 'FACEBOOK_SUBSCRIPTION_FAILED', message: 'Could not subscribe the selected Facebook pages. Check Meta permissions and try again.' });
  }

  const publicConfig = {
    pages: (row.config?.pages || []).map((page) => ({
      id: page.id,
      name: page.name,
      selected: parsed.data.pageIds.includes(page.id),
    })),
  };
  try {
    await tenantDb.transaction(async (db) => {
      await db.query(
        'DELETE FROM crm_integrations."FacebookPageRoute" WHERE "tenantId" = $1 AND "integrationId" = $2',
        [tenantId, row.id],
      );
      for (const page of pages) {
        await db.query(
          `INSERT INTO crm_integrations."FacebookPageRoute" ("pageId", "tenantId", "integrationId")
           VALUES ($1, $2, $3)`,
          [page.id, tenantId, row.id],
        );
      }
      await db.query(
        `UPDATE crm_integrations."TenantIntegration"
            SET status = 'connected', config = $1::jsonb, "lastTestedAt" = now(),
                "lastError" = NULL, "updatedAt" = now()
          WHERE id = $2 AND "tenantId" = $3`,
        [JSON.stringify(publicConfig), row.id, tenantId],
      );
      await recordIntegrationAudit(req, 'integration.changed', 'Agency Facebook Lead Ads pages selected', row.id, db);
    });
  } catch (error) {
    for (const page of subscribedPages) {
      try {
        await unsubscribeFacebookPage(page.id, page.accessToken);
      } catch (rollbackError) {
        logger.warn({
          requestId: req.requestId,
          tenantId,
          providerStatus: rollbackError?.status,
          providerCode: rollbackError?.providerCode,
        }, 'Facebook page subscription rollback failed');
      }
    }
    if (error?.code === '23505') {
      return res.status(409).json({ success: false, code: 'FACEBOOK_PAGE_ALREADY_CONNECTED', message: 'A selected Facebook page is already connected to another agency.' });
    }
    throw error;
  }
  const selectedPageIds = new Set(parsed.data.pageIds);
  const previouslySelected = (row.config?.pages || []).filter((page) => page.selected && !selectedPageIds.has(page.id));
  const credentialsById = new Map((secret.pages || []).map((page) => [page.id, page]));
  for (const page of previouslySelected) {
    const credentials = credentialsById.get(page.id);
    if (!credentials) continue;
    try {
      await unsubscribeFacebookPage(page.id, credentials.accessToken);
    } catch (error) {
      logger.warn({
        requestId: req.requestId,
        tenantId,
        providerStatus: error?.status,
        providerCode: error?.providerCode,
      }, 'Facebook page unsubscribe failed after selection changed');
    }
  }
  return res.json({ success: true, data: facebookPublicStatus({ ...row, status: 'connected', config: publicConfig, lastTestedAt: new Date() }, tenantId) });
}

export async function disconnectFacebook(req, res) {
  if (!z.object({}).strict().safeParse(req.body ?? {}).success) {
    return res.status(400).json({ success: false, code: 'VALIDATION_FAILED', message: 'Unexpected Facebook disconnect data.' });
  }
  const tenantId = requireTenantId();
  const row = await findFacebookIntegration(tenantId);
  if (!row) return res.json({ success: true, data: facebookPublicStatus(null, tenantId) });

  const pagesToUnsubscribe = [];
  if (row.secretCiphertext) {
    try {
      const secret = await decryptSecret(row);
      const selectedPages = (row.config?.pages || []).filter((page) => page.selected);
      const pagesById = new Map((secret.pages || []).map((page) => [page.id, page]));
      for (const page of selectedPages) {
        const credentials = pagesById.get(page.id);
        if (credentials) pagesToUnsubscribe.push(credentials);
      }
    } catch (error) {
      logger.warn({
        requestId: req.requestId,
        tenantId,
        error: error?.message,
      }, 'Facebook credentials could not be decrypted during disconnect');
    }
  }

  await tenantDb.transaction(async (db) => {
    await db.query(
      'DELETE FROM crm_integrations."FacebookPageRoute" WHERE "tenantId" = $1 AND "integrationId" = $2',
      [tenantId, row.id],
    );
    await db.query(
      `UPDATE crm_integrations."TenantIntegration"
          SET status = 'revoked', "secretCiphertext" = NULL, "wrappedDek" = NULL,
              "secretIv" = NULL, "secretTag" = NULL, "kekVersion" = NULL,
              "secretFingerprint" = NULL, "lastFour" = NULL, "lastTestedAt" = NULL,
              "lastError" = NULL, "updatedAt" = now()
        WHERE id = $1 AND "tenantId" = $2`,
      [row.id, tenantId],
    );
    await recordIntegrationAudit(req, 'integration.disconnected', 'Agency Facebook Lead Ads integration disconnected', row.id, db);
  });
  for (const page of pagesToUnsubscribe) {
    try {
      await unsubscribeFacebookPage(page.id, page.accessToken);
    } catch (error) {
      logger.warn({
        requestId: req.requestId,
        tenantId,
        providerStatus: error?.status,
        providerCode: error?.providerCode,
      }, 'Facebook page unsubscribe failed after disconnect');
    }
  }
  return res.json({ success: true, data: facebookPublicStatus(null, tenantId) });
}

export async function processFacebookLeadEvent(value, requestId) {
  const leadgenResult = metaIdSchema.safeParse(value?.leadgen_id);
  const pageResult = metaIdSchema.safeParse(value?.page_id);
  if (!leadgenResult.success || !pageResult.success) return;
  const leadgenId = leadgenResult.data;
  const pageId = pageResult.data;

  const mapping = await tenantDb.resolveFacebookPage(pageId);
  if (!mapping) return;
  const { tenantId, integrationId } = mapping;
  await runWithTenant(tenantId, async () => {
    const found = await tenantDb.query(
      `SELECT id, "tenantId", provider, status, config, "secretCiphertext", "wrappedDek",
              "secretIv", "secretTag", "kekVersion"
         FROM crm_integrations."TenantIntegration"
        WHERE id = $1 AND "tenantId" = $2 AND provider = $3 AND label = $4 AND status = 'connected'
        LIMIT 1`,
      [integrationId, tenantId, PROVIDER, LABEL],
    );
    const row = found.rows[0];
    if (!row) return;
    const secret = await decryptSecret(row);
    const page = (secret.pages || []).find((item) => item.id === pageId);
    if (!page?.accessToken) return;
    const facebookLead = await getFacebookLead(leadgenId, page.accessToken);
    const lead = mapFacebookLeadToLead(facebookLead, value.platform);
    if (!lead.email && !lead.phone) {
      logger.warn({ tenantId, leadgenId, requestId }, 'Facebook lead omitted email and phone');
      return;
    }
    await submitLead({ tenantId, leadgenId, lead, requestId });
  }, requestId);
}

async function submitLead({ tenantId, leadgenId, lead, requestId }) {
  const leadServiceUrl = process.env.LEAD_SERVICE_URL || 'http://localhost:3004';
  const token = process.env.INTERNAL_EVENTS_TOKEN;
  if (!token) throw new Error('Internal service token is not configured');
  const headers = {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-internal-token': token,
    'x-request-id': requestId || '',
  };
  if (process.env.K_SERVICE) {
    const metadataUrl = new URL('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity');
    metadataUrl.searchParams.set('audience', leadServiceUrl);
    metadataUrl.searchParams.set('format', 'full');
    const auth = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
    });
    if (!auth.ok) throw new Error(`Could not authenticate to lead-service (status ${auth.status})`);
    headers.authorization = `Bearer ${await auth.text()}`;
  }
  const response = await fetch(`${leadServiceUrl.replace(/\/+$/, '')}/api/v1/leads/internal/facebook-lead`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      leadgenId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      message: lead.message,
      source: lead.source,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Lead-service rejected Facebook lead (status ${response.status})`);
  const result = await response.json();
  logger.info({ tenantId, leadId: result?.data?.leadId, duplicate: result?.data?.duplicate, requestId }, 'Facebook lead processed');
}

export async function verifyFacebookWebhook(req, res) {
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (!verifyToken || mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') {
    return res.status(403).send('Verification failed');
  }
  const expected = Buffer.from(verifyToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.status(403).send('Verification failed');
  }
  return res.status(200).send(challenge);
}

export async function handleFacebookWebhook(req, res) {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const signature = req.get('X-Hub-Signature-256') || '';
  if (!appSecret || !req.rawBody) {
    return res.status(503).json({ success: false, code: 'FACEBOOK_WEBHOOK_UNAVAILABLE' });
  }
  const [algorithm, receivedHex] = signature.split('=');
  if (algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(receivedHex || '')) {
    return res.status(401).json({ success: false, code: 'INVALID_WEBHOOK_SIGNATURE' });
  }
  const signed = createHmac('sha256', appSecret).update(req.rawBody).digest();
  const received = Buffer.from(receivedHex, 'hex');
  if (signed.length !== received.length || !timingSafeEqual(signed, received)) {
    return res.status(401).json({ success: false, code: 'INVALID_WEBHOOK_SIGNATURE' });
  }
  const parsed = facebookWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'INVALID_FACEBOOK_WEBHOOK' });
  }
  const entries = parsed.data.entry;
  res.status(200).json({ received: true });
  for (const entry of entries) {
    for (const change of entry.changes) {
      if (change?.field !== 'leadgen') continue;
      processFacebookLeadEvent({ ...change.value, page_id: change.value.page_id || entry.id }, req.requestId)
        .catch((error) => req.log?.error?.({ err: error, requestId: req.requestId }, 'Facebook lead processing failed'));
    }
  }
}

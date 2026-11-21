import { decryptSecret } from './crypto.js';
import { verifySmtp } from './smtp.js';
import { getStripeAccount } from './stripe.js';
import { getWhatsappPhoneNumber } from './whatsapp.js';
import { checkFacebookPageToken } from './facebook.js';
import { verifyDuffelToken } from './duffel.js';
import { verifyLiteApiKey } from './liteapi.js';
import { cloudRunAuthHeader } from './cloudRunAuth.js';

// Daily check of every agency's connected accounts. A connection that stops working is marked
// 'error' (Management's Integrations tab then shows it) and the agency owner is emailed once;
// one that starts working again goes back to 'connected'. Google Ads has nothing to check: it
// only receives leads with a key we issued.

const NAMES = { email: 'Email', whatsapp: 'WhatsApp', facebook: 'Facebook lead ads', stripe: 'Stripe payments', duffel: 'Duffel flights', liteapi: 'LiteAPI hotels' };
// What the agency sees in Management. Provider error details stay in the server log only.
const FAILURE_MESSAGE = {
  email: 'Your email server stopped accepting our sign-in. Check the password or reconnect.',
  whatsapp: 'WhatsApp stopped accepting messages from this connection. Reconnect WhatsApp.',
  facebook: 'Facebook stopped giving us your page\'s leads. Reconnect Facebook.',
  stripe: 'Stripe stopped accepting this connection. Reconnect Stripe.',
  duffel: 'Duffel stopped accepting your access token, so flights cannot be searched or booked. Paste a new token.',
  liteapi: 'LiteAPI stopped accepting your API key, so hotels cannot be searched or booked. Paste a new key.',
};

export const CHECKERS = {
  async email(row, secret) {
    await verifySmtp({ ...row.config, ...secret });
  },
  async whatsapp(row, secret) {
    await getWhatsappPhoneNumber(row.config?.wabaId, row.config?.phoneNumberId, secret.accessToken);
  },
  async facebook(row, secret) {
    const selected = new Set((row.config?.pages || []).filter((page) => page.selected).map((page) => page.id));
    for (const page of secret.pages || []) {
      if (selected.has(page.id)) await checkFacebookPageToken(page.id, page.accessToken);
    }
  },
  async stripe(row, secret) {
    const account = await getStripeAccount(secret.accessToken);
    if (account.id !== row.config?.accountId) throw new Error('Stripe account identity did not match');
  },
  async duffel(_row, secret) {
    await verifyDuffelToken(secret.accessToken);
  },
  async liteapi(_row, secret) {
    await verifyLiteApiKey(secret.apiKey);
  },
};

/**
 * Runs every check once. `pool` is an admin connection (it reads across agencies, so every
 * statement names the agency itself). Returns counts for the log. One agency's failure never
 * stops the others.
 */
export async function runHealthChecks({ pool, logger, notifyOwners = emailOwners, now = new Date() }) {
  const { rows } = await pool.query(
    `SELECT id, "tenantId", provider, label, status, config, "secretCiphertext", "wrappedDek",
            "secretIv", "secretTag", "kekVersion"
       FROM crm_integrations."TenantIntegration"
      WHERE status IN ('connected', 'error') AND provider = ANY($1)
      ORDER BY "tenantId", provider`,
    [Object.keys(CHECKERS)],
  );
  const totals = { checked: 0, healthy: 0, broke: 0, stillBroken: 0, recovered: 0, crashed: 0 };

  for (const row of rows) {
    totals.checked += 1;
    let failure = null;
    try {
      await CHECKERS[row.provider](row, await decryptSecret(row));
    } catch (error) {
      failure = error;
    }

    try {
      if (!failure) {
        await setStatus(pool, row, 'connected', null, now);
        if (row.status === 'error') {
          totals.recovered += 1;
          await audit(pool, row, 'integration.health_recovered', `${NAMES[row.provider]} connection is working again`);
        } else totals.healthy += 1;
        continue;
      }

      logger.warn({ tenantId: row.tenantId, provider: row.provider, err: { message: failure.message, status: failure.status } }, 'Integration health check failed');
      await setStatus(pool, row, 'error', FAILURE_MESSAGE[row.provider], now);
      if (row.status === 'error') { totals.stillBroken += 1; continue; }

      // Only the change from working to broken is announced, so an owner gets one email, not one a day.
      totals.broke += 1;
      await audit(pool, row, 'integration.health_failed', `${NAMES[row.provider]} connection stopped working`);
      await notifyOwners({ pool, logger, tenantId: row.tenantId, provider: row.provider });
    } catch (error) {
      totals.crashed += 1;
      logger.error({ tenantId: row.tenantId, provider: row.provider, err: { message: error.message } }, 'Integration health check could not be recorded');
    }
  }
  return totals;
}

async function setStatus(pool, row, status, lastError, now) {
  await pool.query(
    `UPDATE crm_integrations."TenantIntegration"
        SET status = $1, "lastError" = $2, "lastTestedAt" = $3, "updatedAt" = now()
      WHERE id = $4 AND "tenantId" = $5 AND status IN ('connected', 'error')`,
    [status, lastError, now, row.id, row.tenantId],
  );
}

async function audit(pool, row, action, summary) {
  await pool.query(
    `INSERT INTO crm_platform."AuditLog" ("tenantId", "actorRole", action, "targetType", "targetId", summary)
     VALUES ($1, 'system', $2, 'integration', $3, $4)`,
    [row.tenantId, action, row.id, summary],
  );
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

/** Emails each active owner of the agency through notification-service. A failed email is logged. */
export async function emailOwners({ pool, logger, tenantId, provider, fetchImpl = fetch }) {
  const { rows: owners } = await pool.query(
    `SELECT u.name, u.email FROM crm_users."Membership" m JOIN crm_users."User" u ON u.id = m."userId"
      WHERE m."tenantId" = $1 AND m."isOwner" = true AND m.status = 'active'`,
    [tenantId],
  );
  const baseUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008';
  const settingsUrl = `${(process.env.MANAGEMENT_URL || 'http://localhost:5174').replace(/\/$/, '')}/settings`;
  const name = NAMES[provider];

  for (const owner of owners) {
    const text = `Hi ${owner.name || 'there'},\n\nYour agency's ${name} connection stopped working. ${FAILURE_MESSAGE[provider]}\n\nOpen Settings > Integrations: ${settingsUrl}\n\nUntil it is fixed, messages that use this connection may not be sent.`;
    try {
      const url = `${baseUrl}/api/v1/notifications/internal/email`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
          ...(await cloudRunAuthHeader(url)),
        },
        body: JSON.stringify({ to: owner.email, subject: `Action needed: your ${name} connection stopped working`, text, html: escapeHtml(text).replace(/\n/g, '<br>') }),
      });
      if (!response.ok) throw new Error(`notification-service returned ${response.status}`);
    } catch (error) {
      logger.error({ tenantId, provider, err: { message: error.message } }, 'Integration health email could not be sent');
    }
  }
}

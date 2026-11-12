import { requireTenantId } from './context.js';

const METRIC_LABELS = Object.freeze({
  emails: 'customer emails',
  whatsapp: 'WhatsApp messages',
});

export async function sendUsageWarningEmail(prisma, { metric, limit, used }, { fetchImpl = fetch } = {}) {
  const label = METRIC_LABELS[metric];
  if (!label) throw new TypeError(`Unknown usage metric: ${metric}`);
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(used)) {
    throw new TypeError('Usage warning counts must be safe integers');
  }

  const tenantId = requireTenantId();
  const owners = await prisma.$queryRaw`
    SELECT u."email"
    FROM crm_users."Membership" AS m
    JOIN crm_users."User" AS u ON u."id" = m."userId"
    WHERE m."tenantId" = ${tenantId}::uuid
      AND m."isOwner" = TRUE
      AND m."status" = 'active'
      AND u."isActive" = TRUE
    ORDER BY m."createdAt" ASC
    LIMIT 1`;
  const to = owners[0]?.email;
  if (!to) throw new Error('No active agency owner email is available for the usage warning');

  const internalToken = process.env.INTERNAL_EVENTS_TOKEN;
  if (!internalToken) throw new Error('Internal email notification is not configured');

  const notificationServiceUrl = (process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008').replace(/\/+$/, '');
  const response = await fetchImpl(`${notificationServiceUrl}/api/v1/notifications/internal/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalToken,
    },
    body: JSON.stringify({
      to,
      subject: `Your agency is nearing its monthly ${label} limit`,
      text: `Your agency has used ${used} of ${limit} ${label} this month (80% or more).`,
      html: `<p>Your agency has used <strong>${used} of ${limit}</strong> ${label} this month (80% or more).</p>`,
      meta: { sourceService: 'plan-usage', kind: 'usage_limit_warning' },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Usage warning email delivery failed with status ${response.status}`);
}

import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import prisma from '../src/db/client.js';
import logger from '../src/config/logger.js';
import { sendSubscriptionReminder } from '../src/utils/email.js';

const MANAGEMENT_URL = process.env.MANAGEMENT_URL;
const REMINDER_DAYS = [0, 3, 7, 10, 14];

async function expireUnsubscribedTrials() {
  return prisma.$executeRaw`
    UPDATE crm_platform."Tenant"
       SET status = 'past_due',
           "pastDueAt" = COALESCE("pastDueAt", "trialEndsAt"),
           "pastDueReminderLevel" = 0,
           "updatedAt" = NOW()
     WHERE status = 'trial'
       AND "trialEndsAt" IS NOT NULL
       AND "trialEndsAt" <= NOW()
       AND "stripeSubscriptionId" IS NULL
  `;
}

async function suspendLongOverdueAgencies() {
  return prisma.$executeRaw`
    UPDATE crm_platform."Tenant"
       SET status = 'suspended',
           "billingSuspended" = true,
           "updatedAt" = NOW()
     WHERE status = 'past_due'
       AND "pastDueAt" <= NOW() - INTERVAL '14 days'
  `;
}

async function claimDueReminders() {
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw`
      SELECT t.id, t.name AS "agencyName", t."pastDueAt", t."pastDueReminderLevel",
             u.name AS "ownerName", u.email AS "ownerEmail"
        FROM crm_platform."Tenant" t
        JOIN crm_users."Membership" m ON m."tenantId" = t.id
        JOIN crm_users."User" u ON u.id = m."userId"
       WHERE (t.status = 'past_due' OR (t.status = 'suspended' AND t."billingSuspended"))
         AND m."isOwner" = true
         AND m.status = 'active'
         AND t."pastDueReminderLevel" < ${REMINDER_DAYS.length}
         AND t."pastDueAt" <= NOW() - (
           CASE t."pastDueReminderLevel"
             WHEN 0 THEN INTERVAL '0 days'
             WHEN 1 THEN INTERVAL '3 days'
             WHEN 2 THEN INTERVAL '7 days'
             WHEN 3 THEN INTERVAL '10 days'
             ELSE INTERVAL '14 days'
           END
         )
       ORDER BY t."pastDueAt"
       LIMIT 50
         FOR UPDATE OF t SKIP LOCKED
    `;
    for (const row of due) {
      await tx.$executeRaw`
        UPDATE crm_platform."Tenant"
           SET "pastDueReminderLevel" = "pastDueReminderLevel" + 1,
               "updatedAt" = NOW()
         WHERE id = ${row.id}::uuid
      `;
    }
    return due;
  });
}

export async function processSubscriptionLifecycle() {
  if (!MANAGEMENT_URL) throw new Error('MANAGEMENT_URL must be configured');
  const expiredTrials = await expireUnsubscribedTrials();
  const suspendedAgencies = await suspendLongOverdueAgencies();
  const reminders = await claimDueReminders();
  let sentCount = 0;
  for (const agency of reminders) {
    const suspended = Date.now() - new Date(agency.pastDueAt).getTime() >= 14 * 24 * 60 * 60 * 1000;
    try {
      await sendSubscriptionReminder({
        name: agency.ownerName,
        email: agency.ownerEmail,
      }, {
        billingUrl: `${MANAGEMENT_URL}/settings`,
        suspended,
      });
      sentCount += 1;
    } catch (error) {
      logger.error({ err: error, tenantId: agency.id }, 'Subscription reminder email failed');
      await prisma.$executeRaw`
        UPDATE crm_platform."Tenant"
           SET "pastDueReminderLevel" = GREATEST("pastDueReminderLevel" - 1, 0)
         WHERE id = ${agency.id}::uuid
           AND (status = 'past_due' OR (status = 'suspended' AND "billingSuspended"))
      `;
    }
  }
  return {
    expiredTrials: Number(expiredTrials),
    suspendedAgencies: Number(suspendedAgencies),
    remindersSent: sentCount,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  processSubscriptionLifecycle()
    .then((result) => logger.info(result, 'Subscription lifecycle run completed'))
    .catch((error) => {
      logger.error({ err: error }, 'Subscription lifecycle run failed');
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

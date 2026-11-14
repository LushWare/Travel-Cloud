import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db/client.js';
import AppError from '../utils/appError.js';

const TRIAL_DAYS = 14;
const CODE_MINUTES = 10;

const createSlug = (name) => {
  const base = name.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'agency';
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
};

const newVerificationCode = () => String(crypto.randomInt(100000, 1000000));

async function findSignupPlans(db = prisma) {
  return db.$queryRaw`
    SELECT p.key, pv.id AS "planVersionId", pv.name, pv.description,
           pv."priceMinorUnits", pv.currency, pv."billingInterval", pv.entitlements
      FROM crm_platform."Plan" p
      JOIN crm_platform."PlanVersion" pv ON pv."planId" = p.id AND pv."isCurrent" = true
     WHERE p."archivedAt" IS NULL
       AND p.key <> 'internal'
       AND pv."priceMinorUnits" IS NOT NULL
       AND pv."billingInterval" IS NOT NULL
     ORDER BY pv."priceMinorUnits", p.key
  `;
}

export async function listSignupPlans() {
  const plans = await findSignupPlans();
  return plans.map((plan) => ({
    key: plan.key,
    planVersionId: plan.planVersionId,
    name: plan.name,
    description: plan.description,
    priceMinorUnits: plan.priceMinorUnits,
    currency: plan.currency.trim(),
    billingInterval: plan.billingInterval,
    entitlements: plan.entitlements,
  }));
}

export async function createAgencySignup({
  agencyName, ownerName, email, password, planKey, ipAddress = null, requestId = null,
}) {
  const passwordHash = await bcrypt.hash(password, 12);
  const code = newVerificationCode();
  const codeHash = await bcrypt.hash(code, 12);
  const codeExpiresAt = new Date(Date.now() + CODE_MINUTES * 60 * 1000);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  const settingsId = crypto.randomUUID();
  const tenantPlanId = crypto.randomUUID();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const plans = await findSignupPlans(tx);
      const selectedPlan = plans.find((plan) => plan.key === planKey);
      const growthPlan = plans.find((plan) => plan.key === 'growth');
      if (!selectedPlan || !growthPlan) {
        throw new AppError('Plan signup is temporarily unavailable.', 503);
      }

      const existing = await tx.$queryRaw`
        SELECT id FROM crm_users."User" WHERE email = ${email} LIMIT 1
      `;
      if (existing.length) {
        throw new AppError('An account with this email already exists. Sign in instead.', 409);
      }

      await tx.$executeRaw`
        INSERT INTO crm_platform."Tenant"
          (id, slug, name, status, "trialEndsAt", "postTrialPlanVersionId", "createdAt", "updatedAt")
        VALUES
          (${tenantId}::uuid, ${createSlug(agencyName)}, ${agencyName}, 'trial',
           ${trialEndsAt}, ${selectedPlan.planVersionId}::uuid, NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO crm_users."User"
          (id, name, email, password, role, permissions, "isSuperAdmin", "isActive",
           "isEmailVerified", "isTempPassword", "mustChangePassword", "canBeDeleted",
           "emailVerificationToken", "emailVerificationExpire", "lastActivity", "createdAt", "updatedAt")
        VALUES
          (${userId}, ${ownerName}, ${email}, ${passwordHash}, 'admin',
           ARRAY[]::text[], false, true, false, false, false, true,
           ${codeHash}, ${codeExpiresAt}, NOW(), NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO crm_users."Membership"
          (id, "tenantId", "userId", role, permissions, "isOwner", status, "createdAt", "updatedAt")
        VALUES
          (${membershipId}, ${tenantId}::uuid, ${userId}, 'superAdmin',
           ARRAY[]::text[], true, 'invited', NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO crm_platform."TenantPlan"
          (id, "tenantId", "planVersionId", "priceMinorUnits", currency, "assignedAt", "updatedAt")
        VALUES
          (${tenantPlanId}::uuid, ${tenantId}::uuid, ${growthPlan.planVersionId}::uuid,
           ${growthPlan.priceMinorUnits}, ${growthPlan.currency}, NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO crm_users."OrganizationSettings"
          (id, "tenantId", "companyName", "paymentMethods", "createdAt", "updatedAt")
        VALUES
          (${settingsId}, ${tenantId}::uuid, ${agencyName}, ARRAY[]::text[], NOW(), NOW())
      `;

      await tx.$executeRaw`
        INSERT INTO crm_platform."AuditLog"
          ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId",
           summary, details, "ipAddress", "requestId")
        VALUES
          (${tenantId}::uuid, ${userId}, ${email}, 'agency_owner', 'agency.signup_created',
           'agency', ${tenantId}, 'Agency created through self-signup',
           ${JSON.stringify({ planKey, trialEndsAt: trialEndsAt.toISOString() })}::jsonb,
           ${ipAddress}, ${requestId})
      `;

      return { userId, ownerName, email, tenantId };
    });

    return { ...created, code };
  } catch (error) {
    if (error?.code === '23505') {
      throw new AppError('An account with this email already exists. Sign in instead.', 409);
    }
    throw error;
  }
}

export async function verifyAgencySignup({ email, code }) {
  const rows = await prisma.$queryRaw`
    SELECT u.id, u."emailVerificationToken", u."emailVerificationExpire", u."isEmailVerified"
      FROM crm_users."User" u
      JOIN crm_users."Membership" m ON m."userId" = u.id
     WHERE u.email = ${email}
       AND m."isOwner" = true
       AND m.status = 'invited'
     LIMIT 1
  `;
  const user = rows[0];
  if (
    !user ||
    user.isEmailVerified ||
    !user.emailVerificationToken ||
    !user.emailVerificationExpire ||
    new Date(user.emailVerificationExpire).getTime() <= Date.now() ||
    !(await bcrypt.compare(code, user.emailVerificationToken))
  ) {
    throw new AppError('The verification code is invalid or expired.', 400);
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE crm_users."User"
         SET "isEmailVerified" = true,
             "emailVerificationToken" = NULL,
             "emailVerificationExpire" = NULL,
             "updatedAt" = NOW()
       WHERE id = ${user.id}
         AND "isEmailVerified" = false
         AND "emailVerificationToken" = ${user.emailVerificationToken}
         AND "emailVerificationExpire" > NOW()
    `;
    if (updated !== 1) throw new AppError('The verification code is invalid or expired.', 400);

    const membershipUpdated = await tx.$executeRaw`
      UPDATE crm_users."Membership"
         SET status = 'active', "joinedAt" = NOW(), "updatedAt" = NOW()
       WHERE "userId" = ${user.id} AND "isOwner" = true AND status = 'invited'
    `;
    if (membershipUpdated !== 1) throw new AppError('The verification code is invalid or expired.', 400);
  });

  return user.id;
}

export async function resendAgencySignupCode(email) {
  const rows = await prisma.$queryRaw`
    SELECT u.id, u.name, u.email
      FROM crm_users."User" u
      JOIN crm_users."Membership" m ON m."userId" = u.id
     WHERE u.email = ${email}
       AND u."isEmailVerified" = false
       AND m."isOwner" = true
       AND m.status = 'invited'
     LIMIT 1
  `;
  if (!rows[0]) return null;

  const code = newVerificationCode();
  const codeHash = await bcrypt.hash(code, 12);
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60 * 1000);
  const updated = await prisma.$executeRaw`
    UPDATE crm_users."User"
       SET "emailVerificationToken" = ${codeHash},
           "emailVerificationExpire" = ${expiresAt},
           "updatedAt" = NOW()
     WHERE id = ${rows[0].id} AND "isEmailVerified" = false
  `;
  if (updated !== 1) return null;
  return { user: rows[0], code };
}

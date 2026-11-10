import prisma from './client.js';

// Agencies a person can work in right now: an active membership in an agency that is not suspended or deleted.
const USABLE_TENANT_STATUSES = ['trial', 'active', 'past_due'];

const toWorkspace = (row) => ({
  tenantId: row.tenantId,
  tenantSlug: row.tenantSlug,
  tenantName: row.tenantName,
  membershipId: row.membershipId,
  role: row.role,
  permissions: row.permissions || [],
  isOwner: row.isOwner,
});

export async function listUsableMemberships(userId) {
  const rows = await prisma.$queryRaw`
    SELECT m.id AS "membershipId", m."tenantId"::text AS "tenantId", m.role::text AS role,
           m.permissions, m."isOwner", t.slug AS "tenantSlug", t.name AS "tenantName"
    FROM crm_users."Membership" m
    JOIN crm_platform."Tenant" t ON t.id = m."tenantId"
    WHERE m."userId" = ${userId}
      AND m.status = 'active'
      AND t.status::text = ANY(${USABLE_TENANT_STATUSES})
    ORDER BY t.name ASC
  `;
  return rows.map(toWorkspace);
}

/** Any membership (invited, active or suspended) of a person in one agency. */
export async function findMembership(userId, tenantId) {
  if (!userId || !tenantId) return null;
  const rows = await prisma.$queryRaw`
    SELECT id, "tenantId"::text AS "tenantId", role::text AS role, permissions, "isOwner", status::text AS status
    FROM crm_users."Membership"
    WHERE "userId" = ${userId} AND "tenantId" = ${tenantId}::uuid
    LIMIT 1
  `;
  return rows[0] || null;
}

/** Choosing a password from an invite proves the email, so pending invitations become active. */
export async function activateInvitedMemberships(userId) {
  await prisma.$executeRaw`
    UPDATE crm_users."Membership"
    SET status = 'active', "joinedAt" = NOW(), "updatedAt" = NOW()
    WHERE "userId" = ${userId} AND status = 'invited'
  `;
}

export async function findUsableMembership(userId, tenantId) {
  if (!tenantId) return null;
  const memberships = await listUsableMemberships(userId);
  return memberships.find((m) => m.tenantId === tenantId) || null;
}

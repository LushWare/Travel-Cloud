import prisma from './client.js';

/**
 * Uses a help-access link once. Only an unused, unexpired link for a session that is still open
 * returns anything, and using it marks it used in the same statement, so a link works exactly once.
 */
export async function redeemHandoff(codeHash) {
  const rows = await prisma.$queryRaw`
    UPDATE crm_platform."HelpAccessGrant" g
    SET "handoffUsedAt" = NOW()
    FROM crm_platform."PlatformUser" u, crm_platform."Tenant" t
    WHERE g."handoffCodeHash" = ${codeHash}
      AND g."handoffUsedAt" IS NULL AND g."handoffExpiresAt" > NOW()
      AND g."endedAt" IS NULL AND g."expiresAt" > NOW()
      AND u.id = g."platformUserId" AND u."isActive" = true
      AND t.id = g."tenantId" AND t.status::text NOT IN ('pending_deletion', 'deleted')
    RETURNING g.id, g."tenantId"::text AS "tenantId", g."expiresAt", u.id::text AS "platformUserId",
              u.email, u.name, t.slug AS "tenantSlug", t.name AS "tenantName"`;
  return rows[0] ?? null;
}

/** The help session behind a token, while it is still open. */
export async function findOpenGrant(grantId) {
  const rows = await prisma.$queryRaw`
    SELECT g.id, g."expiresAt", t.slug AS "tenantSlug", t.name AS "tenantName"
    FROM crm_platform."HelpAccessGrant" g JOIN crm_platform."Tenant" t ON t.id = g."tenantId"
    WHERE g.id = ${grantId}::uuid AND g."endedAt" IS NULL AND g."expiresAt" > NOW()`;
  return rows[0] ?? null;
}

/** Ends a help session early (the "End help session" button) and records it for the agency. */
export async function endGrant(grantId) {
  const rows = await prisma.$queryRaw`
    UPDATE crm_platform."HelpAccessGrant" g SET "endedAt" = NOW()
    FROM crm_platform."PlatformUser" u
    WHERE g.id = ${grantId}::uuid AND g."endedAt" IS NULL AND u.id = g."platformUserId"
    RETURNING g."tenantId"::text AS "tenantId", u.id::text AS "platformUserId", u.email`;
  const ended = rows[0];
  if (!ended) return false;
  await prisma.$executeRaw`
    INSERT INTO crm_platform."AuditLog" ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary)
    VALUES (${ended.tenantId}::uuid, ${ended.platformUserId}, ${ended.email}, 'platform:help', 'platform.help_access_ended',
            'help_access', ${String(grantId)}, ${`Lushware staff ${ended.email} ended view-only help access`})`;
  return true;
}

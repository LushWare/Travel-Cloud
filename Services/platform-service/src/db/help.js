import pool from './pool.js';

/**
 * Opens a view-only help session and records it in the agency's own audit log, all together.
 * Any earlier session the same person still has open for this agency is closed first, so one
 * person never holds two at once.
 */
export async function startHelpAccess({ platformUser, tenantId, reason, minutes, handoffCodeHash, handoffSeconds, audit }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE crm_platform."HelpAccessGrant" SET "endedAt" = NOW()
       WHERE "platformUserId" = $1 AND "tenantId" = $2 AND "endedAt" IS NULL AND "expiresAt" > NOW()`,
      [platformUser.id, tenantId],
    );
    const { rows } = await client.query(
      `INSERT INTO crm_platform."HelpAccessGrant"
         ("platformUserId", "tenantId", reason, "handoffCodeHash", "handoffExpiresAt", "expiresAt")
       VALUES ($1, $2, $3, $4, NOW() + make_interval(secs => $5), NOW() + make_interval(mins => $6))
       RETURNING id, "expiresAt"`,
      [platformUser.id, tenantId, reason, handoffCodeHash, handoffSeconds, minutes],
    );
    await client.query(
      `INSERT INTO crm_platform."AuditLog"
         ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
       VALUES ($1::uuid, $2, $3, $4, 'platform.help_access_started', 'help_access', $5, $6, $7::jsonb, $8, $9)`,
      [tenantId, platformUser.id, platformUser.email, `platform:${platformUser.role}`.slice(0, 32), rows[0].id,
        audit.summary.slice(0, 300), JSON.stringify({ reason, minutes, viewOnly: true }), audit.ipAddress, audit.requestId],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

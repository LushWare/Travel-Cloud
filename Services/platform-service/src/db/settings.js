import pool from './pool.js';

export const SIGNUP_APPROVAL_KEY = 'require_signup_approval';

/** Whether new self-signups wait for Lushware's approval. Off when never set. */
export async function getSignupApprovalRequired() {
  const { rows } = await pool.query(
    `SELECT value FROM crm_platform."PlatformSetting" WHERE key = $1`,
    [SIGNUP_APPROVAL_KEY],
  );
  return rows[0]?.value === true;
}

/** Turns the approval switch on or off and records who did it, in one transaction. */
export async function setSignupApprovalRequired(enabled, audit) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO crm_platform."PlatformSetting" (key, value, "updatedById", "updatedAt")
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedById" = EXCLUDED."updatedById", "updatedAt" = NOW()`,
      [SIGNUP_APPROVAL_KEY, JSON.stringify(enabled), audit.actorId],
    );
    // A platform event, not an agency's: tenantId is null, so no agency ever sees it.
    await client.query(
      `INSERT INTO crm_platform."AuditLog"
         ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
       VALUES (NULL, $1, $2, $3, 'platform.signup_approval_changed', 'setting', $4, $5, $6::jsonb, $7, $8)`,
      [audit.actorId, audit.actorEmail, audit.actorRole, SIGNUP_APPROVAL_KEY,
        enabled ? 'New sign-ups now need approval' : 'New sign-ups no longer need approval',
        JSON.stringify({ enabled }), audit.ipAddress, audit.requestId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

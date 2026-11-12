import pool from './pool.js';

const USER_COLUMNS = `id, email, name, "passwordHash", "mustChangePassword", role::text AS role, "totpSecret", "lastTotpStep",
  "isActive", "authenticatorSetupRequired", "failedLoginCount", "lockedUntil", "lastLoginAt"`;

export async function findStaffByEmail(email) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM crm_platform."PlatformUser" WHERE email = $1`, [email]);
  return rows[0] ?? null;
}

export async function findStaffById(id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM crm_platform."PlatformUser" WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listPlatformStaff() {
  const { rows } = await pool.query(
    `SELECT id, email, name, role::text AS role, "isActive", "authenticatorSetupRequired",
            "setupPurpose", "lastLoginAt", "createdAt"
     FROM crm_platform."PlatformUser" ORDER BY "createdAt" DESC, email ASC`,
  );
  return rows;
}

export async function findPlatformStaff(id) {
  const { rows } = await pool.query(
    `SELECT id, email, name, role::text AS role, "isActive", "authenticatorSetupRequired", "setupPurpose"
     FROM crm_platform."PlatformUser" WHERE id = $1`, [id],
  );
  return rows[0] ?? null;
}

export async function createPlatformStaff({ email, name, role, passwordHash, totpSecret, setupTokenHash, setupTokenExpiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO crm_platform."PlatformUser"
       (email, name, role, "passwordHash", "mustChangePassword", "totpSecret", "authenticatorSetupRequired",
        "setupTokenHash", "setupTokenExpiresAt", "setupPurpose", "isActive")
     VALUES ($1, $2, $3::crm_platform."PlatformRole", $4, true, $5, true, $6, $7, 'invite', false)
     RETURNING id, email, name, role::text AS role, "isActive", "authenticatorSetupRequired", "setupPurpose", "createdAt"`,
    [email, name, role, passwordHash, totpSecret, setupTokenHash, setupTokenExpiresAt],
  );
  return rows[0];
}

export async function findSetupByTokenHash(setupTokenHash) {
  const { rows } = await pool.query(
    `SELECT id, email, name, role::text AS role, "passwordHash", "totpSecret", "lastTotpStep", "setupPurpose"
     FROM crm_platform."PlatformUser"
     WHERE "setupTokenHash" = $1 AND "setupTokenExpiresAt" > NOW() AND "authenticatorSetupRequired" = true
       AND "setupPurpose" IN ('invite', 'authenticator_reset')`,
    [setupTokenHash],
  );
  return rows[0] ?? null;
}

export async function completePlatformStaffSetup({ id, setupTokenHash, totpStep, passwordHash }) {
  const { rows } = await pool.query(
    `UPDATE crm_platform."PlatformUser"
     SET "passwordHash" = COALESCE($4, "passwordHash"), "mustChangePassword" = false,
         "passwordChangedAt" = CASE WHEN $4::text IS NULL THEN "passwordChangedAt" ELSE NOW() END,
         "isActive" = true, "authenticatorSetupRequired" = false, "lastTotpStep" = $3,
         "setupTokenHash" = NULL, "setupTokenExpiresAt" = NULL, "setupPurpose" = NULL, "updatedAt" = NOW()
     WHERE id = $1 AND "setupTokenHash" = $2 AND "setupTokenExpiresAt" > NOW()
       AND "authenticatorSetupRequired" = true
     RETURNING id, email, name, role::text AS role`,
    [id, setupTokenHash, totpStep, passwordHash ?? null],
  );
  return rows[0] ?? null;
}

export async function rotateStaffSetup({ id, totpSecret, setupTokenHash, setupTokenExpiresAt, purpose }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE crm_platform."PlatformUser"
       SET "totpSecret" = $2, "lastTotpStep" = 0, "authenticatorSetupRequired" = true,
           "setupTokenHash" = $3, "setupTokenExpiresAt" = $4, "setupPurpose" = $5,
           "isActive" = CASE WHEN $5 = 'invite' THEN false ELSE "isActive" END, "updatedAt" = NOW()
       WHERE id = $1 AND (($5 = 'invite' AND "isActive" = false AND "setupPurpose" = 'invite')
         OR ($5 = 'authenticator_reset' AND "isActive" = true))
       RETURNING id, email, name, role::text AS role, "isActive", "authenticatorSetupRequired", "setupPurpose"`,
      [id, totpSecret, setupTokenHash, setupTokenExpiresAt, purpose],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    if (purpose === 'authenticator_reset') {
      await client.query(
        `UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW() WHERE "platformUserId" = $1 AND "revokedAt" IS NULL`, [id],
      );
    }
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function updatePlatformStaffRole(id, role) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('crm_platform.staff_admin_guard'))`);
    const { rows: targetRows } = await client.query(
      `SELECT role::text AS role, "isActive" FROM crm_platform."PlatformUser" WHERE id = $1 FOR UPDATE`, [id],
    );
    const target = targetRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return 'not_found';
    }
    if (target.isActive && target.role === 'platform_admin' && role !== 'platform_admin') {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM crm_platform."PlatformUser" WHERE "isActive" = true AND role = 'platform_admin'`,
      );
      if (rows[0].count <= 1) {
        await client.query('ROLLBACK');
        return 'last_admin';
      }
    }
    await client.query(
      `UPDATE crm_platform."PlatformUser" SET role = $2::crm_platform."PlatformRole", "updatedAt" = NOW() WHERE id = $1`,
      [id, role],
    );
    await client.query(
      `UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW() WHERE "platformUserId" = $1 AND "revokedAt" IS NULL`, [id],
    );
    await client.query('COMMIT');
    return 'updated';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deactivatePlatformStaff(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('crm_platform.staff_admin_guard'))`);
    const { rows: targetRows } = await client.query(
      `SELECT role::text AS role, "isActive" FROM crm_platform."PlatformUser" WHERE id = $1 FOR UPDATE`, [id],
    );
    const target = targetRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return 'not_found';
    }
    if (target.isActive && target.role === 'platform_admin') {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM crm_platform."PlatformUser" WHERE "isActive" = true AND role = 'platform_admin'`,
      );
      if (rows[0].count <= 1) {
        await client.query('ROLLBACK');
        return 'last_admin';
      }
    }
    await client.query(
      `UPDATE crm_platform."PlatformUser"
       SET "isActive" = false, "authenticatorSetupRequired" = false, "setupTokenHash" = NULL,
         "setupTokenExpiresAt" = NULL, "setupPurpose" = NULL, "updatedAt" = NOW()
       WHERE id = $1`, [id],
    );
    await client.query(`UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW() WHERE "platformUserId" = $1 AND "revokedAt" IS NULL`, [id]);
    await client.query('COMMIT');
    return 'deactivated';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function deletePlatformStaff(id, { actor, ipAddress, requestId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('crm_platform.staff_admin_guard'))`);
    const { rows: targetRows } = await client.query(
      `SELECT id, email, name, role::text AS role, "isActive"
       FROM crm_platform."PlatformUser" WHERE id = $1 FOR UPDATE`, [id],
    );
    const target = targetRows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return { result: 'not_found' };
    }
    if (target.isActive && target.role === 'platform_admin') {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM crm_platform."PlatformUser" WHERE "isActive" = true AND role = 'platform_admin'`,
      );
      if (rows[0].count <= 1) {
        await client.query('ROLLBACK');
        return { result: 'last_admin' };
      }
    }

    await client.query(
      `WITH ended AS (
         UPDATE crm_platform."HelpAccessGrant"
         SET "endedAt" = NOW()
         WHERE "platformUserId" = $1 AND "endedAt" IS NULL AND "expiresAt" > NOW()
         RETURNING id, "tenantId"
       )
       INSERT INTO crm_platform."AuditLog"
         ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
       SELECT ended."tenantId", $2, $3, $4, 'platform.help_access_ended', 'help_access', ended.id::text,
              $5, '{"reason":"staff_account_deleted"}'::jsonb, $6, $7
       FROM ended`,
      [id, actor.id, actor.email, `platform:${actor.role}`.slice(0, 32),
        `View-only help access ended because ${target.email}'s Console account was deleted`, ipAddress, requestId],
    );

    await client.query(`DELETE FROM crm_platform."PlatformUser" WHERE id = $1`, [id]);
    await client.query(
      `INSERT INTO crm_platform."AuditLog"
         ("actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
       VALUES ($1, $2, $3, 'platform.staff_deleted', 'platform_user', $4, $5, $6::jsonb, $7, $8)`,
      [actor.id, actor.email, `platform:${actor.role}`.slice(0, 32), target.id,
        `Deleted ${target.email}'s Console account`, JSON.stringify({ role: target.role }), ipAddress, requestId],
    );
    await client.query('COMMIT');
    return { result: 'deleted', staff: target };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Counts a failed attempt; the account locks for `lockMinutes` once `maxAttempts` is reached. */
export async function recordFailedAttempt(id, { maxAttempts, lockMinutes }) {
  await pool.query(
    `UPDATE crm_platform."PlatformUser"
     SET "failedLoginCount" = "failedLoginCount" + 1,
         "lockedUntil" = CASE WHEN "failedLoginCount" + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE "lockedUntil" END,
         "updatedAt" = NOW()
     WHERE id = $1`,
    [id, maxAttempts, lockMinutes],
  );
}

/**
 * Marks a completed sign-in. The step is only accepted if it is newer than the last one used,
 * so two requests racing with the same code cannot both succeed.
 */
export async function recordSuccessfulLogin(id, totpStep) {
  const { rowCount } = await pool.query(
    `UPDATE crm_platform."PlatformUser"
     SET "lastTotpStep" = $2, "failedLoginCount" = 0, "lockedUntil" = NULL, "lastLoginAt" = NOW(), "updatedAt" = NOW()
     WHERE id = $1 AND "lastTotpStep" < $2`,
    [id, totpStep],
  );
  return rowCount === 1;
}

export async function createSession({ platformUserId, tokenHash, ipAddress, userAgent, expiresAt }) {
  await pool.query(
    `INSERT INTO crm_platform."PlatformSession" ("platformUserId", "tokenHash", "ipAddress", "userAgent", "expiresAt")
     VALUES ($1, $2, $3, $4, $5)`,
    [platformUserId, tokenHash, ipAddress, userAgent, expiresAt],
  );
}

/** The live session and its staff member, or null if it is unknown, revoked, expired or idle too long. */
export async function findLiveSession(tokenHash, { idleMinutes }) {
  const { rows } = await pool.query(
    `SELECT s.id AS "sessionId", u.id, u.email, u.name, u.role::text AS role, u."mustChangePassword"
     FROM crm_platform."PlatformSession" s
     JOIN crm_platform."PlatformUser" u ON u.id = s."platformUserId"
     WHERE s."tokenHash" = $1 AND s."revokedAt" IS NULL AND s."expiresAt" > NOW()
       AND s."lastSeenAt" > NOW() - make_interval(mins => $2)
       AND u."isActive" = true`,
    [tokenHash, idleMinutes],
  );
  return rows[0] ?? null;
}

export async function touchSession(sessionId) {
  await pool.query(`UPDATE crm_platform."PlatformSession" SET "lastSeenAt" = NOW() WHERE id = $1`, [sessionId]);
}

/**
 * Saves a person's own password and ends their other console sessions, all together, so a
 * session started with the old password cannot outlive the change.
 */
export async function setOwnPassword(userId, passwordHash, keepSessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE crm_platform."PlatformUser"
       SET "passwordHash" = $2, "mustChangePassword" = false, "passwordChangedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1`,
      [userId, passwordHash],
    );
    await client.query(
      `UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW()
       WHERE "platformUserId" = $1 AND id <> $2 AND "revokedAt" IS NULL`,
      [userId, keepSessionId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeSession(tokenHash) {
  await pool.query(`UPDATE crm_platform."PlatformSession" SET "revokedAt" = NOW() WHERE "tokenHash" = $1 AND "revokedAt" IS NULL`, [tokenHash]);
}

/** Platform events go to the audit log with no agency. */
export async function recordPlatformAudit(req, actor, { action, targetType, targetId, tenantId = null, summary, details }) {
  await pool.query(
    `INSERT INTO crm_platform."AuditLog"
       ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
    [tenantId, actor?.id ?? null, actor?.email ?? null, actor?.role ? `platform:${actor.role}`.slice(0, 32) : null,
      action, targetType ?? null, targetId ?? null, String(summary).slice(0, 300),
      details == null ? null : JSON.stringify(details), req.headers['x-client-ip'] ?? req.ip ?? null, req.requestId ?? null],
  );
}

// Test-only database access for the new-agency journey. Two things cannot be done through the
// API on purpose: reading the six-digit code we email at sign-up, and deleting a whole agency.
// So the test sets a known code just before verifying, and afterwards removes everything its
// own throwaway agency created. Needs the admin connection in E2E_ADMIN_DATABASE_URL; without it
// the journey is skipped. Loads pg/bcryptjs from sibling services so this suite gains no deps.

const ADMIN_URL = process.env.E2E_ADMIN_DATABASE_URL || '';
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
// Only ever touch agencies and accounts this suite created.
const E2E_EMAIL = /^e2e-[A-Za-z0-9-]+\+[a-z0-9-]+@travelcrm\.test$/;
const E2E_AGENCY_NAME = /^\[E2E-[A-Za-z0-9-]+\] /;

export const adminDbConfigured = () => Boolean(ADMIN_URL);

let poolPromise;
async function pool() {
  poolPromise ??= (async () => {
    const pg = (await import('../../analytics-service/node_modules/pg/lib/index.js')).default;
    return new pg.Pool({ connectionString: ADMIN_URL, max: 2, ssl: ADMIN_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  })();
  return poolPromise;
}

/** Gives the unverified sign-up for `email` the code `code`, as if we had emailed it. */
export async function setSignupCode(email, code) {
  if (!E2E_EMAIL.test(email)) throw new Error(`Refusing to touch a non-test account: ${email}`);
  const bcrypt = (await import('../../auth-service/node_modules/bcryptjs/index.js')).default;
  const db = await pool();
  const { rowCount } = await db.query(
    `UPDATE crm_users."User"
        SET "emailVerificationToken" = $1, "emailVerificationExpire" = NOW() + INTERVAL '10 minutes'
      WHERE email = $2 AND "isEmailVerified" = false`,
    [await bcrypt.hash(code, 4), email],
  );
  if (rowCount !== 1) throw new Error(`No unverified sign-up for ${email}`);
}

/** Whether new sign-ups currently wait for Lushware's approval (Console switch). */
export async function signupApprovalRequired() {
  const db = await pool();
  try {
    const { rows } = await db.query(`SELECT value FROM crm_platform."PlatformSetting" WHERE key = 'require_signup_approval'`);
    return rows[0]?.value === true;
  } catch {
    return false;
  }
}

/**
 * Deletes the throwaway agency and its owner account. Rows go in passes because tables refer to
 * each other; the append-only audit log keeps its rows by design.
 */
export async function removeTestAgency({ tenantId, ownerEmail }) {
  if (!tenantId) return;
  if (!E2E_EMAIL.test(ownerEmail)) throw new Error(`Refusing to remove an agency not created by this suite: ${ownerEmail}`);
  const db = await pool();
  const { rows: [tenant] } = await db.query(`SELECT name FROM crm_platform."Tenant" WHERE id = $1`, [tenantId]);
  if (!tenant) return;
  if (!E2E_AGENCY_NAME.test(tenant.name)) throw new Error(`Refusing to remove agency "${tenant.name}": not an E2E agency`);

  const { rows: tables } = await db.query(
    `SELECT table_schema AS s, table_name AS t FROM information_schema.columns
      WHERE column_name = 'tenantId' AND table_schema LIKE 'crm\\_%'
        AND NOT (table_schema = 'crm_platform' AND table_name IN ('AuditLog', 'Tenant'))`,
  );
  let pending = tables.filter(({ s, t }) => IDENTIFIER.test(s) && IDENTIFIER.test(t)).map(({ s, t }) => `"${s}"."${t}"`);
  for (let pass = 0; pending.length && pass < 10; pass += 1) {
    const blocked = [];
    for (const table of pending) {
      try {
        await db.query(`DELETE FROM ${table} WHERE "tenantId" = $1`, [tenantId]);
      } catch (error) {
        if (!/foreign key/i.test(error.message)) throw error;
        blocked.push(table);
      }
    }
    if (blocked.length === pending.length) throw new Error(`Could not clean up tables: ${blocked.join(', ')}`);
    pending = blocked;
  }
  await db.query(`DELETE FROM crm_users."User" WHERE email = $1 AND NOT EXISTS (SELECT 1 FROM crm_users."Membership" m WHERE m."userId" = "User".id)`, [ownerEmail]);
  await db.query(`DELETE FROM crm_platform."Tenant" WHERE id = $1`, [tenantId]);
}

export async function closeAdminDb() {
  if (poolPromise) await (await poolPromise).end();
}

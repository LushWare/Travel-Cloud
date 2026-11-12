import pool from './pool.js';

// Platform staff see business facts about each agency (status, people, counts, activity), never
// its customers' data: every query here returns counts, names of the agency's own staff, or yes/no.

export const SORTS = {
  name: 't.name ASC',
  created: 't."createdAt" DESC',
  activity: 'activity."lastActivityAt" DESC NULLS LAST',
  staff: 'COALESCE(people.staff, 0) DESC',
};

const STAFF_ROLES = `('superAdmin', 'admin', 'salesRep', 'vendor')`;

/** One page of agencies with their owner, staff counts and last activity. */
export async function listAgencies({ search, status, sort = 'name', limit, offset }) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length} OR owner.email ILIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    where.push(`t.status::text = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.slug, t.status::text AS status, t."createdAt",
            owner.name AS "ownerName", owner.email AS "ownerEmail",
            COALESCE(people.staff, 0)::int AS staff, COALESCE(people.admins, 0)::int AS admins,
            COALESCE(people."salesReps", 0)::int AS "salesReps", COALESCE(people.vendors, 0)::int AS vendors,
            activity."lastActivityAt",
            plan.name AS "planName",
            COUNT(*) OVER()::int AS total
     FROM crm_platform."Tenant" t
     LEFT JOIN LATERAL (
       SELECT u.name, u.email FROM crm_users."Membership" m JOIN crm_users."User" u ON u.id = m."userId"
       WHERE m."tenantId" = t.id AND (m."isOwner" OR m.role = 'superAdmin') AND m.status = 'active'
       ORDER BY m."createdAt" LIMIT 1
     ) owner ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE m.status <> 'suspended') AS staff,
              COUNT(*) FILTER (WHERE m.status <> 'suspended' AND m.role IN ('superAdmin', 'admin')) AS admins,
              COUNT(*) FILTER (WHERE m.status <> 'suspended' AND m.role = 'salesRep') AS "salesReps",
              COUNT(*) FILTER (WHERE m.status <> 'suspended' AND m.role = 'vendor') AS vendors
       FROM crm_users."Membership" m WHERE m."tenantId" = t.id AND m.role IN ${STAFF_ROLES}
     ) people ON true
     LEFT JOIN LATERAL (
       SELECT MAX(s."createdAt") AS "lastActivityAt" FROM crm_auth."RefreshSession" s WHERE s."tenantId" = t.id
     ) activity ON true
     LEFT JOIN LATERAL (
       SELECT pv.name FROM crm_platform."TenantPlan" tp
       JOIN crm_platform."PlanVersion" pv ON pv.id = tp."planVersionId"
       WHERE tp."tenantId" = t.id
     ) plan ON true
     ${whereSql}
     ORDER BY ${SORTS[sort] ?? SORTS.name}, t.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.map(({ total, ...row }) => row), total: rows[0]?.total ?? 0 };
}

export async function findAgency(id) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, status::text AS status, region, "createdAt" FROM crm_platform."Tenant" WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Everything the detail page shows, as counts and yes/no answers. */
export async function agencyDetail(id) {
  const [people, owners, usage, activity, setup, sends] = await Promise.all([
    pool.query(
      `SELECT role::text AS role, status::text AS status, COUNT(*)::int AS count
       FROM crm_users."Membership" WHERE "tenantId" = $1 AND role IN ${STAFF_ROLES}
       GROUP BY role, status`,
      [id],
    ),
    pool.query(
      `SELECT u.name, u.email, m.status::text AS status, u."lastLogin"
       FROM crm_users."Membership" m JOIN crm_users."User" u ON u.id = m."userId"
       WHERE m."tenantId" = $1 AND (m."isOwner" OR m.role = 'superAdmin')
       ORDER BY m."createdAt"`,
      [id],
    ),
    pool.query(
      `SELECT 'leads' AS metric, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int AS "thisMonth" FROM crm_leads."Lead" WHERE "tenantId" = $1
       UNION ALL SELECT 'quotations', COUNT(*)::int, COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int FROM crm_billing."Quotation" WHERE "tenantId" = $1
       UNION ALL SELECT 'invoices', COUNT(*)::int, COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int FROM crm_billing."Invoice" WHERE "tenantId" = $1
       UNION ALL SELECT 'bookings', COUNT(*)::int, COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int FROM crm_bookings."Booking" WHERE "tenantId" = $1
       UNION ALL SELECT 'packages', COUNT(*)::int, COUNT(*) FILTER (WHERE "createdAt" >= date_trunc('month', NOW()))::int FROM crm_packages."Package" WHERE "tenantId" = $1`,
      [id],
    ),
    pool.query(
      `SELECT MAX("createdAt") AS "lastActivityAt",
              COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS "activeUsers7d",
              COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS "activeUsers30d"
       FROM crm_auth."RefreshSession" WHERE "tenantId" = $1`,
      [id],
    ),
    pool.query(
      `SELECT (NULLIF(TRIM("companyName"), '') IS NOT NULL AND NULLIF(TRIM("companyAddress"), '') IS NOT NULL) AS "companyDetails",
              (NULLIF(TRIM("logoUrl"), '') IS NOT NULL) AS logo,
              (NULLIF(TRIM("bankName"), '') IS NOT NULL AND NULLIF(TRIM("bankAccountNumber"), '') IS NOT NULL) AS "bankDetails"
       FROM crm_users."OrganizationSettings" WHERE "tenantId" = $1 LIMIT 1`,
      [id],
    ),
    // Metered sends this month. The table arrives with a migration; until then show zero.
    pool.query(
      `SELECT "metric", "count" FROM crm_platform."UsageCounter"
       WHERE "tenantId" = $1 AND "period" = date_trunc('month', NOW() AT TIME ZONE 'UTC')::date`,
      [id],
    ).catch(() => ({ rows: [] })),
  ]);
  const sendCount = (metric) => sends.rows.find((row) => row.metric === metric)?.count ?? 0;

  const byRole = { owners: 0, admins: 0, salesReps: 0, vendors: 0 };
  const byStatus = { active: 0, invited: 0, suspended: 0 };
  const roleKey = { superAdmin: 'owners', admin: 'admins', salesRep: 'salesReps', vendor: 'vendors' };
  for (const { role, status, count } of people.rows) {
    byStatus[status] = (byStatus[status] ?? 0) + count;
    if (status !== 'suspended') byRole[roleKey[role]] += count;
  }

  return {
    people: { total: byStatus.active + byStatus.invited, byRole, byStatus },
    owners: owners.rows,
    usage: Object.fromEntries(usage.rows.map(({ metric, total, thisMonth }) => [metric, { total, thisMonth }])),
    sends: { emails: sendCount('emails'), whatsapp: sendCount('whatsapp') },
    activity: activity.rows[0] ?? { lastActivityAt: null, activeUsers7d: 0, activeUsers30d: 0 },
    setup: setup.rows[0] ?? { companyDetails: false, logo: false, bankDetails: false },
  };
}

/** The platform's own actions on this agency (status changes, help access), newest first. */
export async function agencyHistory(id, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, action, summary, "actorEmail", "createdAt" FROM crm_platform."AuditLog"
     WHERE "tenantId" = $1 AND action LIKE 'platform.%'
     ORDER BY "createdAt" DESC LIMIT $2`,
    [id, limit],
  );
  return rows;
}

/**
 * Suspends or restores an agency and records it, all together. Suspending also ends every
 * login session in that agency, so staff are signed out at their next renewal (within minutes).
 */
export async function setAgencyStatus(id, { status, expectedStatus, revokeSessions, audit }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE crm_platform."Tenant" SET status = $2::crm_platform."TenantStatus", "updatedAt" = NOW()
       WHERE id = $1 AND status::text = $3`,
      [id, status, expectedStatus],
    );
    if (rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }
    if (revokeSessions) {
      await client.query(`UPDATE crm_auth."RefreshSession" SET "revokedAt" = NOW() WHERE "tenantId" = $1 AND "revokedAt" IS NULL`, [id]);
    }
    await client.query(
      `INSERT INTO crm_platform."AuditLog"
         ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
       VALUES ($1::uuid, $2, $3, $4, $5, 'agency', $6, $7, $8::jsonb, $9, $10)`,
      [id, audit.actorId, audit.actorEmail, audit.actorRole, audit.action, String(id), audit.summary,
        JSON.stringify(audit.details ?? null), audit.ipAddress, audit.requestId],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The status an agency had before its most recent suspension, so restoring puts it back. */
export async function statusBeforeSuspension(id) {
  const { rows } = await pool.query(
    `SELECT details->>'previousStatus' AS previous FROM crm_platform."AuditLog"
     WHERE "tenantId" = $1 AND action = 'platform.agency_suspended'
     ORDER BY "createdAt" DESC LIMIT 1`,
    [id],
  );
  return rows[0]?.previous ?? null;
}

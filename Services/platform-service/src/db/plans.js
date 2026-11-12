import pool from './pool.js';

const VERSION_SELECT = `pv."id", pv."planId", pv."version", pv."name", pv."description",
  pv."priceMinorUnits", pv."currency", pv."billingInterval", pv."entitlements", pv."isCurrent", pv."createdAt"`;

async function audit(client, req, action, targetType, targetId, summary, details, tenantId = null) {
  await client.query(
    `INSERT INTO crm_platform."AuditLog"
       ("tenantId", "actorId", "actorEmail", "actorRole", action, "targetType", "targetId", summary, details, "ipAddress", "requestId")
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
    [tenantId, req.platformUser.id, req.platformUser.email, `platform:${req.platformUser.role}`.slice(0, 32),
      action, targetType, String(targetId), summary.slice(0, 300), JSON.stringify(details),
      req.headers['x-client-ip'] ?? req.ip ?? null, req.requestId ?? null],
  );
}

export async function listPlans() {
  const { rows } = await pool.query(
    `SELECT p.id AS "planId", p.key, p."archivedAt", p."createdAt" AS "planCreatedAt",
            ${VERSION_SELECT},
            (SELECT COUNT(*)::int FROM crm_platform."TenantPlan" tp WHERE tp."planVersionId" = pv.id) AS assignments
     FROM crm_platform."Plan" p
     LEFT JOIN crm_platform."PlanVersion" pv ON pv."planId" = p.id
     ORDER BY p.key, pv.version DESC`,
  );
  const plans = new Map();
  for (const row of rows) {
    let plan = plans.get(row.planId);
    if (!plan) {
      plan = { id: row.planId, key: row.key, archivedAt: row.archivedAt, createdAt: row.planCreatedAt, versions: [] };
      plans.set(row.planId, plan);
    }
    if (row.id) {
      const { planId, planCreatedAt, ...version } = row;
      plan.versions.push({ ...version, assignments: Number(version.assignments) });
    }
  }
  return [...plans.values()];
}

export async function findPlan(id) {
  const { rows } = await pool.query(
    `SELECT id, key, "archivedAt", "createdAt" FROM crm_platform."Plan" WHERE id = $1`, [id],
  );
  return rows[0] ?? null;
}

export async function findPlanVersion(planId, { currentOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT p.id AS "catalogPlanId", p.key, p."archivedAt", ${VERSION_SELECT}
     FROM crm_platform."Plan" p JOIN crm_platform."PlanVersion" pv ON pv."planId" = p.id
     WHERE p.id = $1 ${currentOnly ? 'AND pv."isCurrent" = true' : ''}
     ORDER BY pv.version DESC LIMIT 1`,
    [planId],
  );
  return rows[0] ?? null;
}

export async function createPlan(input, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: planRows } = await client.query(
      `INSERT INTO crm_platform."Plan" (key) VALUES ($1) RETURNING id, key, "createdAt"`, [input.key],
    );
    const plan = planRows[0];
    const { rows: versions } = await client.query(
      `INSERT INTO crm_platform."PlanVersion" AS pv
         ("planId", version, name, description, "priceMinorUnits", currency, "billingInterval", entitlements, "isCurrent", "createdById")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7::jsonb, true, $8)
       RETURNING ${VERSION_SELECT}`,
      [plan.id, input.name, input.description, input.priceMinorUnits, input.currency, input.billingInterval,
        JSON.stringify(input.entitlements), req.platformUser.id],
    );
    await audit(client, req, 'platform.plan_created', 'plan', plan.id, `Created plan ${input.name}`, { key: input.key, version: 1 });
    await client.query('COMMIT');
    return { ...plan, versions: [versions[0]] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function createPlanVersion(planId, input, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: plans } = await client.query(
      `SELECT id, key, "archivedAt" FROM crm_platform."Plan" WHERE id = $1 FOR UPDATE`, [planId],
    );
    if (!plans[0] || plans[0].archivedAt) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows: current } = await client.query(
      `SELECT COALESCE(MAX(version), 0)::int AS version FROM crm_platform."PlanVersion" WHERE "planId" = $1`, [planId],
    );
    const version = current[0].version + 1;
    await client.query(`UPDATE crm_platform."PlanVersion" SET "isCurrent" = false WHERE "planId" = $1 AND "isCurrent"`, [planId]);
    const { rows } = await client.query(
      `INSERT INTO crm_platform."PlanVersion" AS pv
         ("planId", version, name, description, "priceMinorUnits", currency, "billingInterval", entitlements, "isCurrent", "createdById")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, true, $9)
       RETURNING ${VERSION_SELECT}`,
      [planId, version, input.name, input.description, input.priceMinorUnits, input.currency, input.billingInterval,
        JSON.stringify(input.entitlements), req.platformUser.id],
    );
    await audit(client, req, 'platform.plan_version_created', 'plan', planId, `Created version ${version} of ${input.name}`, { version });
    await client.query('COMMIT');
    return { ...plans[0], ...rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function archivePlan(planId, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE crm_platform."Plan" SET "archivedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1 AND "archivedAt" IS NULL RETURNING id, key`, [planId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await audit(client, req, 'platform.plan_archived', 'plan', planId, `Archived plan ${rows[0].key}`, {});
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getAgencyPlan(tenantId) {
  const [assignment, overrides] = await Promise.all([
    pool.query(
      `SELECT tp."planVersionId", tp."priceMinorUnits", tp.currency, tp."assignedAt", tp."assignedById",
              p.id AS "planId", p.key, pv.version, pv.name, pv.description, pv."billingInterval",
              pv.entitlements, pv."isCurrent"
       FROM crm_platform."TenantPlan" tp
       JOIN crm_platform."PlanVersion" pv ON pv.id = tp."planVersionId"
       JOIN crm_platform."Plan" p ON p.id = pv."planId"
       WHERE tp."tenantId" = $1`, [tenantId],
    ),
    pool.query(
      `SELECT id, "entitlementKey", value, reason, "changedById", "updatedAt"
       FROM crm_platform."PlanEntitlementOverride" WHERE "tenantId" = $1 ORDER BY "entitlementKey"`, [tenantId],
    ),
  ]);
  return { assignment: assignment.rows[0] ?? null, overrides: overrides.rows };
}

export async function assignAgencyPlan(tenantId, planVersionId, snapshot, reason, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: versions } = await client.query(
      `SELECT pv."priceMinorUnits", pv.currency, p.key, pv.name, pv.version
       FROM crm_platform."PlanVersion" pv JOIN crm_platform."Plan" p ON p.id = pv."planId"
       WHERE pv.id = $1 AND p."archivedAt" IS NULL FOR SHARE OF p`, [planVersionId],
    );
    if (!versions[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const { rows: previous } = await client.query(
      `SELECT "planVersionId" FROM crm_platform."TenantPlan" WHERE "tenantId" = $1 FOR UPDATE`, [tenantId],
    );
    const version = versions[0];
    const price = snapshot.priceMinorUnits ?? version.priceMinorUnits;
    const currency = snapshot.currency ?? version.currency;
    const { rows } = await client.query(
      `INSERT INTO crm_platform."TenantPlan" ("tenantId", "planVersionId", "priceMinorUnits", currency, "assignedById")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("tenantId") DO UPDATE SET "planVersionId" = EXCLUDED."planVersionId",
         "priceMinorUnits" = EXCLUDED."priceMinorUnits", currency = EXCLUDED.currency,
         "assignedById" = EXCLUDED."assignedById", "assignedAt" = NOW(), "updatedAt" = NOW()
       RETURNING "planVersionId", "priceMinorUnits", currency, "assignedAt"`,
      [tenantId, planVersionId, price, currency, req.platformUser.id],
    );
    await audit(client, req, 'platform.agency_plan_assigned', 'agency_plan', tenantId,
      `Assigned ${version.name} to agency: ${reason}`, {
        fromPlanVersionId: previous[0]?.planVersionId ?? null, planVersionId, planKey: version.key,
        planVersion: version.version, priceMinorUnits: price, currency, reason,
      }, tenantId);
    await client.query('COMMIT');
    return { ...rows[0], planId: version.key, name: version.name, version: version.version };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function setAgencyOverride(tenantId, entitlementKey, value, reason, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO crm_platform."PlanEntitlementOverride"
         ("tenantId", "entitlementKey", value, reason, "changedById")
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT ("tenantId", "entitlementKey") DO UPDATE SET value = EXCLUDED.value,
         reason = EXCLUDED.reason, "changedById" = EXCLUDED."changedById", "updatedAt" = NOW()
       RETURNING id, "entitlementKey", value, reason, "updatedAt"`,
      [tenantId, entitlementKey, JSON.stringify(value), reason, req.platformUser.id],
    );
    await audit(client, req, 'platform.agency_plan_override_set', 'agency_plan', tenantId,
      `Changed ${entitlementKey} for agency: ${reason}`, { entitlementKey, value, reason }, tenantId);
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function removeAgencyOverride(tenantId, entitlementKey, reason, req) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM crm_platform."PlanEntitlementOverride"
       WHERE "tenantId" = $1 AND "entitlementKey" = $2 RETURNING value`, [tenantId, entitlementKey],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await audit(client, req, 'platform.agency_plan_override_removed', 'agency_plan', tenantId,
      `Removed ${entitlementKey} override for agency: ${reason}`, { entitlementKey, value: rows[0].value, reason }, tenantId);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
// Creates the starting plan catalogue and gives the local agencies their plans.
//   cd Services/platform-service && npm run seed-plans            (shows what would happen)
//   cd Services/platform-service && npm run seed-plans:apply      (does it; PowerShell drops a bare `--`)
//
// Only adds what is missing: an existing plan, an agency that already has a plan, or an existing
// special deal is left exactly as it is. Every change is recorded in the audit log under the first
// active platform admin, the same way the console records it.
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { createPlan, assignAgencyPlan, setAgencyOverride } from '../src/db/plans.js';
import { DEFAULT_ASSIGNMENTS, DEFAULT_PLANS } from '../src/planDefaults.js';

const apply = process.argv.includes('--apply');
const money = (minor, currency) => (minor == null ? 'not for sale' : `${(minor / 100).toFixed(2)} ${currency}`);
const limit = (n) => (n == null ? 'unlimited' : String(n));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run this from Services/platform-service.');
  const ready = await pool.query(`SELECT to_regclass('crm_platform."Plan"') AS t`);
  if (!ready.rows[0].t) throw new Error('The plan tables do not exist yet. Run `node migrate-all.mjs` in Services first.');

  const { rows: admins } = await pool.query(
    `SELECT id, email, role::text AS role FROM crm_platform."PlatformUser"
     WHERE "isActive" = true AND role = 'platform_admin' ORDER BY "createdAt" LIMIT 1`,
  );
  if (!admins[0]) throw new Error('No active platform admin exists. Run `npm run create-admin` first.');
  // The console's own functions record who made each change; this is the same shape a console request has.
  const req = { platformUser: admins[0], headers: {}, ip: null, requestId: 'seed-plans' };

  console.log(`\n${apply ? 'Applying' : 'Dry run (nothing written)'} as ${admins[0].email}\n`);

  const { rows: existing } = await pool.query(
    `SELECT p.key, pv.id AS "versionId" FROM crm_platform."Plan" p
     LEFT JOIN crm_platform."PlanVersion" pv ON pv."planId" = p.id AND pv."isCurrent"`,
  );
  const versionByKey = new Map(existing.map((r) => [r.key, r.versionId]));

  for (const plan of DEFAULT_PLANS) {
    const e = plan.entitlements;
    const line = `${plan.name.padEnd(14)} ${limit(e.staff_seats).padStart(9)} staff  ${limit(e.packages).padStart(9)} packages  AI ${e.features.ai_itinerary_builder ? 'yes' : 'no '}  ${money(plan.priceMinorUnits, plan.currency)}`;
    if (versionByKey.has(plan.key)) {
      console.log(`= plan ${line}  (exists, unchanged)`);
      continue;
    }
    console.log(`+ plan ${line}`);
    if (apply) versionByKey.set(plan.key, (await createPlan(plan, req)).versions[0].id);
  }
  console.log('');

  for (const a of DEFAULT_ASSIGNMENTS) {
    const { rows: tenants } = await pool.query(
      `SELECT t.id, t.name, tp."planVersionId" FROM crm_platform."Tenant" t
       LEFT JOIN crm_platform."TenantPlan" tp ON tp."tenantId" = t.id WHERE t.slug = $1`,
      [a.slug],
    );
    const tenant = tenants[0];
    if (!tenant) {
      console.log(`- ${a.slug}: no such agency here, skipped`);
      continue;
    }
    if (tenant.planVersionId) {
      console.log(`= ${tenant.name}: already has a plan, unchanged`);
    } else {
      console.log(`+ ${tenant.name} → ${DEFAULT_PLANS.find((p) => p.key === a.plan).name}`);
      if (apply) await assignAgencyPlan(tenant.id, versionByKey.get(a.plan), {}, a.reason, req);
    }

    for (const o of a.overrides ?? []) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM crm_platform."PlanEntitlementOverride" WHERE "tenantId" = $1 AND "entitlementKey" = $2`,
        [tenant.id, o.key],
      );
      if (rowCount) {
        console.log(`  = special deal ${o.key}: exists, unchanged`);
        continue;
      }
      console.log(`  + special deal ${o.key} = ${o.value}`);
      if (apply) await setAgencyOverride(tenant.id, o.key, o.value, o.reason, req);
    }
  }
  console.log(apply ? '\nDone.\n' : '\nNothing was written. To apply: npm run seed-plans:apply\n');
}

main()
  .catch((err) => {
    console.error(`\n✗ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

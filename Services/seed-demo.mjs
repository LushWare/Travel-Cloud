#!/usr/bin/env node
/**
 * Comprehensive demo seed for the Travel CRM.
 *
 *   cd Services && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' lead-service/.env | cut -d= -f2- | tr -d '"')" \
 *     node seed-demo.mjs
 *
 * What it does, in order: users → packages → leads → quotations → bookings →
 * invoices → careers → flights → assistant → auth. Each step lives in
 * seed-demo/domains/ and receives the same context object, so a later step can
 * reference the ids an earlier one created (a lead's selection id, the
 * quotation raised against it, the invoice that receipt paid).
 *
 * Properties this script is built to have:
 *   • Deterministic — every id comes from seed-demo/lib/ids.mjs, so the same
 *     database is produced on every machine and every run.
 *   • Idempotent — rows with a natural unique key are upserted; rows without
 *     one (reviews, transports, careers, vacancies, OTPs) are deleted for the
 *     scope this script owns before being re-inserted. Re-running never
 *     duplicates, and --reset removes the whole demo book of business.
 *   • Additive — existing users, packages and any row another session created
 *     are left alone. Only rows carrying this script's id prefixes are ever
 *     deleted.
 *
 * Agencies (Phase 1): every step runs once per test agency — lush-demo (the
 * existing data), acme-tours and globe-dmc — inside that agency, so each row is
 * labelled with it. The agency is also part of every id ('2a000001-…' is an
 * acme-tours lead), which keeps each agency's rows apart and lets --reset find
 * all of them. A consultant account belongs to both acme-tours and globe-dmc.
 *
 * Usage:
 *   node seed-demo.mjs                 # seed (idempotent)
 *   node seed-demo.mjs --agencies=lush-demo   # seed only the named agencies
 *   node seed-demo.mjs --reset         # delete demo rows, then reseed
 *   node seed-demo.mjs --reset --dry-run   # report what reset would delete
 *   node seed-demo.mjs --only=users,packages
 *   node seed-demo.mjs --only=consultant   # just the two-agency login
 *   node seed-demo.mjs --audit         # row counts only, change nothing
 */
import { connect, disconnect } from './seed-demo/lib/clients.mjs';
import { makeCounters, setAgencyIndex, id as idFor } from './seed-demo/lib/ids.mjs';
import { AGENCIES, CONSULTANT, selectAgencies } from './seed-demo/lib/agencies.mjs';
import { runWithTenant } from './shared/tenancy/src/index.js';
import { DEMO_PASSWORDS } from './seed-demo/domains/users.mjs';
import bcrypt from './user-service/node_modules/bcryptjs/index.js';
import { makeRng, makeRngFor, utcDate } from './seed-demo/lib/rng.mjs';
import * as fx from './seed-demo/lib/fixtures.mjs';
import { DEMO_ID_PREFIXES, resetDemoData } from './seed-demo/lib/reset.mjs';
import { audit } from './seed-demo/lib/audit.mjs';

import * as users from './seed-demo/domains/users.mjs';
import * as packages from './seed-demo/domains/packages.mjs';
import * as leads from './seed-demo/domains/leads.mjs';
import * as quotations from './seed-demo/domains/quotations.mjs';
import * as bookings from './seed-demo/domains/bookings.mjs';
import * as invoices from './seed-demo/domains/invoices.mjs';
import * as careers from './seed-demo/domains/careers.mjs';
import * as flights from './seed-demo/domains/flights.mjs';
import * as hotels from './seed-demo/domains/hotels.mjs';
import * as assistant from './seed-demo/domains/assistant.mjs';
import * as auth from './seed-demo/domains/auth.mjs';

const STEPS = [
  ['users', users],
  ['packages', packages],
  ['leads', leads],
  ['quotations', quotations],
  ['bookings', bookings],
  // flights runs before invoices: a confirmed booking's voucher lists its
  // flight segments. quotations and bookings run before invoices so the
  // invoice can close both loops (quotation → invoice, booking → invoice).
  ['flights', flights],
  ['hotels', hotels],
  ['invoices', invoices],
  ['careers', careers],
  ['assistant', assistant],
  ['auth', auth],
];

// Login codes live with the global accounts, not with an agency: seeded once.
const GLOBAL_STEPS = new Set(['auth']);

function parseArgs(argv) {
  const args = { reset: false, dryRun: false, audit: false, only: null, agencies: null, quiet: false, help: false };
  for (const a of argv) {
    if (a === '--reset') args.reset = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--audit') args.audit = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--agencies=')) args.agencies = a.slice('--agencies='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const HELP = `
Travel CRM — demo seed

  node seed-demo.mjs [options]

Options
  --reset            delete every row this script owns, then reseed
  --dry-run          with --reset: report what would be deleted, change nothing
  --audit            print row counts per table and exit (no writes)
  --only=a,b         run only the named steps (${STEPS.map(([n]) => n).join(', ')})
  --agencies=a,b     seed only the named agencies (${AGENCIES.map((a) => a.slug).join(', ')})
  --quiet            suppress the per-step progress output
  --help             this message

Database
  Requires DATABASE_URL. There is no fallback — these scripts once carried the
  shared Supabase DSN as a literal default, and an unset variable silently
  wrote to the live database instead of failing.

  cd Services && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' lead-service/.env | cut -d= -f2- | tr -d '"')" \\
    node seed-demo.mjs
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const db = connect();
  const log = args.quiet ? () => {} : (...a) => console.log(...a);
  const started = Date.now();

  // Deterministic reference clock: today at 09:00 UTC. Fixed within a day, so
  // the same command run twice on the same day produces the same rows.
  const today = new Date();
  const now = utcDate(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate(), 9, 0);

  const agencies = selectAgencies(args.agencies);

  // A fresh context per agency with the same random streams: every agency gets the same
  // names, slugs and document numbers, which is what makes the isolation tests meaningful.
  const contextFor = (agency) => ({
    db,
    fx,
    now,
    log,
    agency,
    ids: makeCounters(),
    rng: makeRng(0x5eed_2026),
    // Each domain draws from its own stream so one step's output cannot be
    // reshuffled by a conditional draw added in another (see lib/rng.mjs).
    rngFor: makeRngFor(0x5eed_2026),
    data: {},
  });

  try {
    if (args.audit) {
      await audit(db, { title: 'Row counts (audit only — nothing written)' });
      return;
    }

    log(`\n  Travel CRM demo seed  ·  ${now.toISOString().slice(0, 10)}`);
    log(`  ─────────────────────────────────────────────────────────`);

    if (args.reset) {
      await resetDemoData(db, { dryRun: args.dryRun, log });
      if (args.dryRun) return;
    }

    await ensureAgencies(db, agencies);

    let ran = 0;
    let total = 0;
    for (const agency of agencies) {
      log(`\n  ── ${agency.name} (${agency.slug}) ${'─'.repeat(Math.max(0, 40 - agency.name.length - agency.slug.length))}`);
      setAgencyIndex(agency.index);
      const ctx = contextFor(agency);
      await runWithTenant(agency.id, async () => {
        for (const [name, mod] of STEPS) {
          if (args.only && !args.only.includes(name)) continue;
          if (GLOBAL_STEPS.has(name) && !agency.isDemo) continue;
          const t = Date.now();
          const result = await mod.seed(ctx);
          ctx.data[name] = result;
          ran += 1;
          const ms = Date.now() - t;
          const detail = typeof result?.summary === 'string' ? result.summary : '';
          log(`  ${name.padEnd(12)} ${String(detail).padEnd(46)} ${String(ms).padStart(5)}ms`);
        }
      });
      // The counters are the seed's own claim about what it created; the audit
      // below is the database's. Printing both makes a mismatch obvious.
      total += Object.values(ctx.ids.snapshot()).reduce((sum, n) => sum + n, 0);
    }
    setAgencyIndex(0);

    if (!args.only || args.only.includes('users') || args.only.includes('consultant')) {
      await ensureAgencies(db, AGENCIES);
      await ensureConsultant(db, AGENCIES, log);
      log(`  ─────────────────────────────────────────────────────────`);
      log(`  ${ran} step(s) across ${agencies.length} agenc${agencies.length === 1 ? 'y' : 'ies'} · ${total} rows minted · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }

    await audit(db, { title: 'Row counts (after seed)' });
  } finally {
    await disconnect(db);
  }
}

/** The agency rows themselves; lush-demo is created by the user-service migration. */
async function ensureAgencies(db, agencies) {
  for (const agency of agencies) {
    await db.users.tenant.upsert({
      where: { id: agency.id },
      update: {},
      create: { id: agency.id, slug: agency.slug, name: agency.name, status: 'active' },
    });
  }
}

/** One person who works for two agencies, with a different role in each. */
async function ensureConsultant(db, agencies, log) {
  const targets = CONSULTANT.memberships
    .map((m) => ({ ...m, agency: agencies.find((a) => a.slug === m.agency) }))
    .filter((m) => m.agency);
  if (targets.length < 2) return;

  const existing = await db.users.user.findUnique({ where: { email: CONSULTANT.email } });
  const user = existing ?? await db.users.user.create({
    data: {
      id: idFor('user', 9000, 0),
      name: CONSULTANT.name,
      email: CONSULTANT.email,
      // Signs in on the admin page; what they may do in each agency comes from that membership's role.
      password: await bcrypt.hash(DEMO_PASSWORDS.admin, 12),
      role: 'admin',
      permissions: [],
      isActive: true,
      isEmailVerified: true,
      phoneCountry: 'LK',
    },
  });
  for (const m of targets) {
    await runWithTenant(m.agency.id, () => db.users.membership.upsert({
      where: { tenantId_userId: { tenantId: m.agency.id, userId: user.id } },
      update: {},
      create: { userId: user.id, role: m.role, permissions: m.permissions, status: 'active', joinedAt: new Date() },
    }));
  }
  log(`  consultant   ${CONSULTANT.email} in ${targets.map((m) => `${m.agency.slug} (${m.role})`).join(' and ')}`);
}

main().catch(async (err) => {
  console.error(`\n  ✗ seed-demo failed: ${err.message}\n`);
  if (process.env.DEBUG_SEED) console.error(err.stack);
  process.exitCode = 1;
});

# Backend API E2E tests

Cross-service, real-HTTP, real-JWT tests driven through the Gateway against a
fully running local microservices stack. Nothing here mocks Prisma/pg, and
nothing injects `x-user-*` headers directly — every request goes through
`/api/v1/auth/login` and the real Gateway auth middleware, exactly like a
real client would.

This is a **new, additive test category** — there was no existing precedent
for this in the repo before it (see `CLAUDE.md`'s Testing section for how
this relates to the existing per-service integration-test layer, which stays
the primary place for coverage; this suite is intentionally narrow).

## Prerequisites

1. The full backend stack running locally: `cd Services && npm run dev`
   (boots the gateway + all 12 microservices via `concurrently`).
2. Seed data present in whatever database that stack points at:
   `cd Services && node seed.mjs && node seed-extended.mjs && node update-passwords.mjs`
   (only needs to be run once against a given database — these tests reuse
   the seeded accounts rather than creating their own users).
3. **Organization Settings must be configured** (company name, address,
   contact info) for the seeded org — the quotation/invoice/receipt PDF
   generators 422 if these are missing, the same requirement the Management
   UI has for sending any of these documents. Configure via the Management
   app's Organization Settings page, or however your seed data already sets
   this up.
4. `cp .env.example .env` and review it — in particular `GATEWAY_URL` must
   point at your local Gateway, and `E2E_I_UNDERSTAND_SHARED_DB=true` must be
   set explicitly (see "About the shared database" below).

## Running

```bash
cd Services/e2e-tests
npm install
npm test
```

## About the shared database

There is no disposable test database in this repo — every Prisma service
(plus analytics/notification, which use raw `pg`) points at **one shared
live Postgres instance** (Supabase), namespaced by schema
(`crm_auth`, `crm_billing`, etc. — see the root `CLAUDE.md`). This suite
creates real rows there. To keep that safe:

- **Safety guard** (`global-setup.js`): refuses to run unless `GATEWAY_URL`
  looks like `localhost`/`127.0.0.1` (never a production-looking URL), and
  requires `E2E_I_UNDERSTAND_SHARED_DB=true` to be set explicitly.
- **Tagging**: every lead this suite creates gets `name: "[E2E-<runId>] ..."`
  and a synthetic `email: "e2e-<runId>+<role>@travelcrm.test"`. `<runId>` is
  generated fresh per run (see `global-setup.js`).
- **Cleanup** (`helpers/test-data-cleanup.js`): an `afterAll` in each spec
  file removes everything it created, via the Gateway, using an admin token.
  Leads and quotations have real `DELETE` endpoints and are actually removed.
  **Invoices and payment receipts do not have a delete endpoint** —
  billing-service only exposes a `cancel` transition for them (by design,
  for audit-trail reasons) — so cleanup cancels them instead; the cancelled
  rows remain in the shared DB after a run. This is a limitation of the
  underlying API, not something this suite works around.
- The suite **never mutates the seeded accounts themselves**
  (`superadmin@travelcrm.com`, `alice.admin@travelcrm.com`,
  `bob.sales@travelcrm.com`) — they're only used to log in and act as the
  actor for each flow.

## What's covered

- **`flows/career-application.spec.js`** — public apply → staff review →
  status update. No lead/billing entanglement; this is the smoke test for
  the whole harness (health-wait, real auth, cleanup wiring) and the
  cheapest flow to get green first.
- **`flows/new-agency-signup.spec.js`** — a brand-new agency end to end: sign-up
  → email code → its own Growth trial → sees no other agency's leads → company
  details → first lead → price → quotation → invoice numbered from 1 → paid.
  Creates a throwaway `[E2E-<run>]` agency and deletes it afterwards. Runs only
  when `E2E_ADMIN_DATABASE_URL` is set (the emailed code and the cleanup need the
  admin connection), and with the Console's sign-up approval switch off.
- **`flows/lead-to-payment-lifecycle.spec.js`** — one continuous, stateful
  journey: create lead → assign → manual package selection → pricing →
  quotation → send → accept → convert to invoice → send → payment receipt →
  verify → reconcile → send. Uses a **manual** (non-package) selection with
  an explicit cost-line array, so it doesn't depend on any specific seeded
  `Package` row existing in package-service.

Both flows use the `email` channel for every "send" step (not `whatsapp`) —
this repo's WhatsApp sends go through the real Meta Cloud API/Twilio
integration, and asserting against that from an E2E suite would mean either
requiring real credentials or auditing that service's specific mock-mode
wiring in detail; email is simpler to reason about here and already
exercises the same PDF-generation/send-tracking code paths.

## Deferred (not built in this pass)

Per the test-pyramid guidance in `CLAUDE.md` (E2E should stay a narrow slice,
not exhaustive coverage), these flows were scoped but intentionally not
implemented yet:

- **Voucher send/confirm** — same billing-service/notification-service shape
  as the payment-receipt flow already covered; low marginal value to add
  immediately.
- **Flight search → price → book → link to lead itinerary day** — needs
  flight-service's mock-provider mode confirmed/enabled first (so the suite
  doesn't depend on a real Duffel/Travelport sandbox).
- **Public contact/booking funnel** (`POST /leads/website-contact`,
  `POST /bookings/website`) — a good second-wave addition; tests the
  Gateway's `PUBLIC_PATTERNS` allow-list boundary directly.

Add these as their own `flows/*.spec.js` files following the existing two as
templates, rather than growing the two existing files further.

## CI — not wired up yet

Deliberately left local-only for now — there's a real, unresolved decision
here that shouldn't get defaulted silently inside a CI config: **what
database does CI talk to?**

**Option A — ephemeral Postgres in the CI job (recommended once someone
commits to the setup work).** A fresh `postgres:` service container per run,
with all 8 Prisma services' migrations applied (`prisma migrate deploy` per
service — there's no single root migration command, each service owns its
own `prisma/migrations/`) and `node seed.mjs && node seed-extended.mjs && node
update-passwords.mjs` run against it before tests start. Clean and isolated —
never touches real dev data, safe to run on every PR — but `seed.mjs` and
`seed-extended.mjs` currently hardcode a Supabase connection string at the top
of the file rather than reading `DATABASE_URL` from the environment, so that
needs fixing first (parameterize it) or CI can't point them at the ephemeral
container. Also confirm each service's `.env`-driven `DATABASE_URL` can be
overridden per-schema against one shared ephemeral Postgres instance the same
way the real shared Supabase is namespaced (`crm_auth`, `crm_billing`, etc.).

**Option B — point CI at the shared Supabase dev DB.** Minimal setup (add the
connection secrets to GitHub Actions), reuses this suite's existing safety
guard/tagging/cleanup as-is. The tradeoff is real, not hypothetical: while
building this suite in one session, I hit the Gateway's shared 10-req/15-min
login rate limit multiple times just from normal iteration (manual `curl`
checks plus test runs stacking on the same limiter) — concurrent CI runs
against the same shared instance would compound that, and every CI run adds
load to a resource the whole team's local dev also depends on.

Either way, a CI job needs:

1. **Boot the full stack**: `cd Services && npm run dev`, then poll `/health`
   on the Gateway and all 10 services before running anything (this suite's
   own `helpers/wait-for-services.js` health-check logic is a reusable
   reference for that — note it accepts any non-5xx response, not just 200,
   because the Gateway's own `/health` route is registered after its global
   JWT-auth middleware and returns 401 even when fully healthy).
2. **Secrets**: `DATABASE_URL` (per service, or one shared string + schema
   namespacing depending on which DB option above), `JWT_SECRET`,
   `INTERNAL_SERVICE_KEY`/`INTERNAL_EVENTS_TOKEN`, and enough
   email/WhatsApp config for the `email`-channel sends this suite exercises
   (or confirm each service's mock-mode env vars so it doesn't need real
   credentials at all).
3. **Organization Settings must already be configured** in whichever DB is
   used — this suite depends on it (see Prerequisites above) and there's no
   seed step that sets it up automatically today.
4. **`GATEWAY_URL=http://localhost:3000/api/v1` and
   `E2E_I_UNDERSTAND_SHARED_DB=true`** in the job env (the latter is a real
   opt-in gate, not boilerplate — keep it explicit even in CI rather than
   hardcoding it into the workflow without a comment explaining why).
5. **Trigger**: start with `workflow_dispatch` (manual) only. Promote to
   running on PRs/pushes only once the suite has proven stable over several
   manual runs and the database question above is actually settled —
   automatic-on-every-push against Option B in particular would need the
   rate-limit and shared-data-contention concerns above resolved first.

## Verifying the safety guard / harness actually work

- Temporarily set `GATEWAY_URL=https://api.lushtravelcloud.com` and confirm
  `npm test` refuses to run (then revert).
- Temporarily unset `E2E_I_UNDERSTAND_SHARED_DB` and confirm the same
  (then revert).
- Stop one backend service and confirm `global-setup.js` reports exactly
  which service never became healthy, rather than a generic timeout.
- Run `npm test` twice back-to-back and confirm no unique-constraint
  collisions (proves the per-run tagging is actually unique) and no `429`s
  on login (proves `auth-helper.js`'s token caching is working).

# Design: Multi-Tenant SaaS — Self-Serve Agencies on One Platform

Branch: multi-tenant
Status: Phases 0–2 built (2026-11-12, not yet deployed); Phases 3–5 planned. Where a section below
differs from what was built, the "As built" notes in §11 and §15 take precedence.
Date: 2026-11-07 (updated 2026-11-12)
Priority order for every trade-off in this document: **1. security, 2. correctness of existing data, 3. agency autonomy, 4. cost/speed.**

## 1. Problem Statement

Travel CRM is built and operated for one agency (Lush Travel Cloud). The goal is to sell **the Management portal (the CRM)** as SaaS: anyone opens one app address, signs up, gets a private workspace for their agency, configures branding, team, documents and external integrations (email, WhatsApp, payments, lead ads, later flights and AI products), and runs their business **without the development team being involved**. This is the standard workspace model used by SaaS CRMs: one app, one login page, many isolated workspaces.

**Scope:** the Management portal and the services behind it. The customer-facing public website (`Client/`) is **out of scope** for now; it keeps serving Tenant #1 only (§9).

**Terminology:** "tenant" and "workspace" mean the same thing (one agency's private space). "Tenant #1" is the Lush workspace, seeded as `lush-demo` (§7.2).

Today the system is single-tenant all the way down:

| Area | Current state | Evidence |
|---|---|---|
| Data | 67 Prisma models in 11 schemas, none carries a tenant identifier | `Services/*/prisma/schema.prisma` |
| Raw SQL | 52 `$queryRaw`/`$executeRaw` call sites + ~66 `pg` queries in analytics-service that read across `crm_leads`, `crm_billing`, `crm_packages`, `crm_bookings`, `crm_users`, `crm_flights`, `crm_careers` | `analytics-service/src/controllers/*` |
| Settings | Two singletons: `crm_users.OrganizationSettings` (one row by convention) and `crm_leads.Settings` (`singletonKey = 1`) | `user-service`, `lead-service` schemas |
| Global uniques | `User.email`, `User.phoneE164`, every document number, `Package.slug`, `Place.name`, `ActivityCatalog.name` are unique platform-wide | schemas |
| Identity | JWT (HS256, shared `JWT_SECRET`, 7 days) carries `id, role, email, name, permissions, isSuperAdmin`, no tenant | `auth-service/src/controllers/auth.controller.js:12` |
| Integrations | WhatsApp, Duffel, Travelport, ElevenLabs, Gemini, SMTP, Facebook/Google Ads, Cloudinary all configured by global env vars | `grep process.env` across `Services/` |
| Caches | `billing-service/src/config/orgSettings.js` caches settings in one module-level variable | line 77 |
| Files | Cloudinary uploads into fixed folders (`quotations/`) with `overwrite: true` | `billing-service/src/utils/cloudinary.js:33` |

## 2. Goals and Non-Goals

**Goals**
1. Strict tenant isolation, enforced by the database (not just by application code), proven by automated tests.
2. Rebuild the existing test data into several seeded test workspaces (§7), so isolation is proven against realistic multi-agency data before any real agency signs up.
3. Agencies self-serve: signup, onboarding, branding, team/roles, documents, website/domain, integrations, plan and billing.
4. A separate, heavily guarded platform console for the Lushware team.

**Non-goals (this design)**
- AI products for other tenants (assistant, voice agent, recommendations) are **deferred**. Their tables still get `tenantId` in Phase 1 (isolation is not optional), but the features stay entitlement-gated to Tenant #1.
- Database-per-tenant. Revisit only as a paid "dedicated" tier.
- Per-agency public websites, subdomains and custom domains. All agencies use the one app address. A per-agency website builder can be designed later on top of this foundation.
- The legacy `Server/` MongoDB monolith. It is no longer used (confirmed by the product owner) and is out of scope.

## 3. Security First: Threat Model

| # | Threat | Primary control | Backstop |
|---|---|---|---|
| T1 | Tenant A reads or writes tenant B's rows (missing `where`, raw SQL, IDOR by ID) | Prisma tenant extension injects `tenantId` | Postgres RLS `FORCE`d on every table; runtime role has no `BYPASSRLS` |
| T2 | Attacker forges tenant or user identity via headers | Gateway strips all identity headers on **every** request; services accept only a gateway-signed context token | Cloud Run IAM (`run.invoker` only for gateway) |
| T3 | User switches to, or is issued a token for, a workspace they don't belong to | Auth-service issues a token for workspace `tid` only after checking an active `Membership`; the gateway takes the tenant **only** from that signed token | Short-lived access tokens + revocable refresh sessions; RLS on `Membership` |
| T4 | Integration secrets stolen (DB dump, logs, API response) | Envelope encryption via Cloud KMS, AAD bound to tenant; write-only secrets | Only integration-service has KMS decrypt; secrets never logged/returned |
| T5 | Spoofed webhook injects data into a tenant | Signature verified with provider secret; tenant resolved from provider-controlled ID via `InboundRoute` | Unknown routing key → 404 + alert, never a default tenant |
| T6 | Cross-tenant leak via caches, files, PDFs, search indexes | Every cache key and storage path starts with `tenantId`; private assets via signed URLs | Isolation test suite covers documents and uploads |
| T7 | Platform staff abuse/over-reach | Separate identity realm, MFA, IAP, time-boxed audited impersonation visible to the tenant | Append-only audit log |
| T8 | Privilege escalation inside a tenant | Server-side role/permission checks; owner role non-transferable without re-auth | Tenant audit log |
| T9 | Noisy neighbour / abuse (DoS, cost burn on AI, email spam) | Per-tenant rate limits and quotas in shared Redis | Plan entitlements, suspension switch |
| T10 | SSRF through tenant-supplied URLs/hosts (SMTP, webhooks, image URLs) | Allowlisted schemes, DNS-resolve-then-block private/metadata ranges | Egress firewall |
| T11 | Data remains after tenant leaves | Deletion pipeline across all schemas, Cloudinary, provider integrations | Deletion verification report |

### 3.1 Existing vulnerabilities found while designing (fix in Phase 0, independent of multi-tenancy)

All found by reading the code on 2026-11-07, not by exploiting a deployed environment.

1. **Identity header forgery on public routes.** `gateway/src/index.js:122` returns `next()` for public routes *before* any header stripping, so client-supplied `x-user-id`, `x-user-role`, `x-user-is-super-admin`, `x-service-key` reach services. Services trust them (`*/src/middleware/auth.js` `extractUser`). Concrete impact today: `GET /api/v1/packages` (public) with `x-user-id: x` + `x-user-role: admin` lists inactive/draft packages (`package.controller.js:32`). After multi-tenancy, the same gap would allow forging `x-tenant-id` — **this must be closed before any tenant work.**
2. **CORS allows every origin with credentials.** `gateway/src/index.js:37` calls `cb(null, true)` on the "not allowed" branch. Only the `SameSite=Strict` cookie is preventing cross-site abuse today.
3. **JWT in `localStorage`.** `Management/src/contexts/AuthContext.jsx:81` stores a 7-day bearer token readable by any XSS. Violates the project's own "httpOnly cookies, not localStorage" rule.
4. **Public, enumerable financial PDFs.** `billing-service/src/utils/cloudinary.js` uploads invoices/quotations/receipts as public `raw` assets at `quotations/invoice-<INV-YYYYMM-NNNN>.pdf`. The numbers are sequential, so anyone with one link can guess others (customer names, amounts, bank details). With tenants it gets worse: two agencies with the same invoice number would **overwrite each other's PDF** (`overwrite: true`) and a customer could receive another agency's invoice.
5. **Racy document numbering.** `billing-service/src/utils/docNumber.js` reads the highest number and adds 1. Concurrent requests produce the same number (unique-violation 500s today; worse under load with many tenants).
6. `getPackageById` returns inactive packages to anonymous callers (no `isActive` filter). Low impact, same fix pattern.

## 4. Decisions

| Decision | Choice | Why |
|---|---|---|
| Tenancy model | Shared database, shared schemas, `tenantId` column on **every** table (including child tables) | 11 schemas × N tenants is unmanageable; denormalising `tenantId` onto children keeps RLS policies join-free and fast |
| Isolation enforcement | Prisma client extension **and** Postgres RLS with `FORCE ROW LEVEL SECURITY`, runtime role without `BYPASSRLS` | Application bugs are expected; the database must still refuse |
| Tenant context in DB | `set_config('app.tenant_id', $1, true)` (transaction-local) in the same transaction as each query | Supabase pooler runs in **transaction mode** (`:6543?pgbouncer=true`); session-level `SET` would leak between tenants on pooled connections |
| Tenant resolution | From the **signed access token** (`tid` claim), which auth-service issues only for a workspace the user is an active member of. Never from a header, body, query param or URL | One app address for everyone; the token is the only thing the client cannot forge |
| API origin | Same-origin: the app address serves the Management SPA and `/api/*` (load balancer → gateway) | First-party `__Host-` cookies with `SameSite=Strict`; CORS becomes an allowlist of zero |
| Identity scope | **One global user account** (email unique platform-wide, as today) + `Membership(tenantId, userId, role, permissions)` per workspace | Matches the existing global `User.email` unique, so existing data needs no change there; one person can belong to several workspaces (e.g. a consultant) and switch between them |
| Platform staff | Separate `PlatformUser` realm, separate token audience and signing key, console behind Google IAP | A tenant `superAdmin` must never be able to become a platform admin |
| Ownership of new data | New `platform-service` (`crm_platform`) and `integration-service` (`crm_integrations`) | Keeps the credential vault in the smallest possible blast radius; only integration-service gets KMS decrypt |

## 5. Identity, Authentication and Request Context

### 5.1 Addresses

| Address | Serves | Who |
|---|---|---|
| `app.lushtravelcloud.com` | Management portal (signup, login, workspaces) + `/api` | All agencies' staff |
| `console.lushtravelcloud.com` | Platform console, behind Google Identity-Aware Proxy | Lushware platform staff only |
| `lushtravelcloud.com` (existing) | Tenant #1's public website, unchanged | Lush's customers (out of scope, §9) |

Each workspace has an immutable internal `id` and a display `slug` (lowercase `[a-z0-9-]{3,40}`), used only for display and URLs inside the app (`/w/acme/leads`). **The slug in the URL is never trusted for authorisation**; the gateway compares it to the token's `tid` and rejects a mismatch.

### 5.2 Signup, login and switching workspace

- **Signup**: `app.<domain>/signup` → name, email, password → email verification → "Create your agency workspace" (agency name) → the user becomes that workspace's `owner` → onboarding (§10).
- **Login**: email + password (+ OTP/MFA) → auth-service lists the user's **active** memberships → one membership: enter it directly; several: workspace picker → auth-service issues tokens for the chosen `tid` **after re-checking the membership**.
- **Switch workspace**: `POST /api/v1/auth/switch-workspace {tenantId}` → membership re-checked server-side → new token pair; the old access token is not reusable for the new workspace.
- **Invite teammate**: owner/admin enters email + role → existing account: a pending membership they accept after login; new person: invite link (single-use, 72 h, hashed in DB) → set password → membership active.
- **Removing a member** or suspending a workspace revokes that membership's refresh sessions immediately; access tokens die within 15 minutes.

### 5.3 Tokens and sessions

- **Access token**: JWT, **EdDSA/RS256**, private key only in auth-service (Secret Manager), public keys published as JWKS with `kid` for rotation. Lifetime **15 minutes**. Claims: `sub` (user id), `tid` (workspace), `mid` (membership id), `role`, `perms` (from the membership), `sv`, `aud: "tenant"`, `iss, iat, exp, jti`.
- **Refresh token**: opaque random 256-bit, stored hashed in `crm_auth.Session(tenantId, userId, refreshHash, expiresAt, revokedAt, ip, userAgent)`, rotated on every use, reuse detection revokes the whole family. Lifetime 7 days (configurable per tenant, max 30).
- Both delivered as `__Host-` cookies: `HttpOnly; Secure; SameSite=Strict; Path=/`. **Never** returned in the JSON body. Management/Client stop using `localStorage`/`sessionStorage` for tokens.
- `sv` (session version) on `User` is incremented on password change, role/permission change, deactivation → all refresh tokens die; access tokens expire within 15 min.
- **MFA**: required for tenant `owner`/`admin` (TOTP or WebAuthn), optional for others; salesRep email OTP stays. Required for all platform staff.
- CSRF: `SameSite=Strict` + same-origin API + a double-submit token on state-changing requests from the portals.

### 5.4 Gateway pipeline (order matters)

```
1. requestId                      (existing)
2. stripInboundIdentity           NEW — delete every x-user-*, x-tenant-*, x-ctx, x-service-key,
                                  x-internal-token, x-platform-* header on EVERY request, public or not
3. authenticate                   CHANGED — verify JWT via JWKS; tenant = token.tid (only source);
                                  if the URL carries a workspace slug/id that ≠ token.tid → 403
4. tenantStatus                   NEW — tenant status from Redis cache (60 s); suspended/deleted → 403/410
5. rateLimit(tenant, user, ip)    CHANGED — Redis store (Memorystore); per-tenant + per-user + per-IP buckets
6. entitlements                   NEW — plan feature/limit checks for gated route prefixes
7. mintContext                    NEW — sign x-ctx (60 s JWT, aud = target service) containing
                                  {tid, uid, mid, role, perms, requestId, realm}
8. proxy                          (existing, plus Cloud Run ID token)
```

Routes with **no** logged-in user and therefore no token-derived tenant:

| Route group | How the tenant is decided |
|---|---|
| Signup, login, password reset, invite acceptance | No tenant yet; auth-service decides after verifying credentials and membership |
| Webhooks (WhatsApp, lead ads, voice, Duffel) | From the verified provider payload via `InboundRoute` (§8.4) |
| Existing public-website routes (packages list, contact forms, assistant, careers) | **Pinned to Tenant #1** by gateway config (`PUBLIC_SITE_TENANT_ID`) until a website feature is designed. Without this pin they would return every workspace's packages |
| Provider webhooks (WhatsApp, voice, Duffel, lead ads) | **Pinned to Tenant #1** in Phase 1, the only agency with connected integrations. Phase 3 routes each one by its provider key (`InboundRoute`, `VoiceNumber`) to the agency that connected it |

Services replace `extractUser` with `verifyContext`: verify `x-ctx` signature (gateway public key), `aud`, and expiry; put `{tenantId, user}` into `AsyncLocalStorage`. **No context → 401**, for every route that touches tenant data. This kills the whole header-forgery class even if a service is accidentally exposed.

### 5.5 Service-to-service and background work

- **On behalf of a request**: forward the received `x-ctx` (it is audience-scoped, so the gateway mints one per downstream audience, or services exchange it at a shared `ctx` endpoint — implementation detail for Phase 1).
- **System-originated** (webhooks, cron, queues): the entry service resolves the tenant from a verified source (§8.4), then mints a context with the **internal** signing key (Secret Manager, backend services only, never the gateway key). `INTERNAL_EVENTS_TOKEN`/`INTERNAL_SERVICE_KEY` shared secrets are retired in favour of this plus Cloud Run IAM identity.
- Every queued job payload carries `tenantId`; the worker re-establishes context before touching the DB.
- Maintenance that is legitimately cross-tenant (expired OTP purge, usage roll-up) runs through narrowly scoped `SECURITY DEFINER` SQL functions owned by the migrator role — never by giving the app role `BYPASSRLS`.

### 5.6 Roles

Roles and permissions move from `User` to `Membership`, so the same person can be `owner` in their own workspace and `salesRep` in another.

| Realm | Role | Notes |
|---|---|---|
| Tenant | `owner` | At least one per workspace (the last owner cannot leave or be demoted); billing, delete workspace, manage admins. Replaces today's `isSuperAdmin` semantics **inside a workspace** |
| Tenant | `admin` | Everything except billing/ownership/tenant deletion |
| Tenant | `salesRep` | Existing permission strings (`manage_leads`, `manage_packages`, …) |
| Tenant | `vendor`, `customer` | Existing |
| Platform | `platform_support` | Read tenant metadata, start read-only impersonation |
| Platform | `platform_admin` | Suspend/restore tenants, plans, refunds; write impersonation needs second approver |

`authorize()` keeps its `isSuperAdmin` shortcut only as `role === 'owner'`, and only ever within the context tenant.

## 6. Data Layer

### 6.1 New schemas

**`crm_platform`** (platform-service, port 3014)

| Table | Key fields |
|---|---|
| `Tenant` | `id uuid`, `slug unique`, `name`, `status (trial, active, past_due, suspended, pending_deletion, deleted)`, `planId`, `region`, `createdAt`, `deletedAt` |
| `Plan`, `Subscription` | entitlements JSON (features, seats, monthly quotas); Stripe customer/subscription IDs |
| `UsageCounter` | `(tenantId, metric, period)` unique — emails, WhatsApp messages, storage, AI tokens, voice minutes |
| `PlatformUser`, `PlatformSession` | separate from tenant users; MFA mandatory |
| `ImpersonationGrant` | `platformUserId, tenantId, reason, mode (read/write), approvedBy, expiresAt (≤ 30 min)` |
| `AuditLog` | append-only (app role: `INSERT, SELECT` only); `tenantId nullable` for platform events; actor, action, target, before/after hash, ip, requestId |

**`crm_integrations`** (integration-service, port 3015) — see §8.

`crm_platform` tables are **not** under tenant RLS (they are the tenant registry); they are only reachable through platform-service, which has no public routes except workspace creation during signup.

**New in `crm_users`: `Membership`**

| Field | Notes |
|---|---|
| `id`, `tenantId`, `userId` | `@@unique([tenantId, userId])` |
| `role`, `permissions String[]`, `isOwner` | moved from `User` |
| `status (invited, active, suspended)`, `invitedById`, `inviteTokenHash`, `inviteExpiresAt`, `joinedAt` | |

`User` becomes the global **identity** only (name, email, password hash, MFA, avatar, verification). It is not tenant-owned, so it cannot use the plain `tenantId` policy. Its RLS policy instead allows a row to be seen only when it is the current user, or when the user has a membership in the current workspace:

```sql
CREATE POLICY user_visible ON crm_users."User" USING (
  id = nullif(current_setting('app.user_id', true), '')
  OR EXISTS (SELECT 1 FROM crm_users."Membership" m
             WHERE m."userId" = "User".id
               AND m."tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
);
```

Login and signup (before a workspace is chosen) use narrow `SECURITY DEFINER` functions in auth-service (`find_identity_by_email`, `list_memberships_for_user`) instead of broad table access.

### 6.2 `tenantId` on every existing table

All 67 tables except `User` (the global identity, see §6.1) receive `"tenantId" uuid NOT NULL`, indexed, with every existing index re-led by `tenantId` where it is used for lookups.

Prisma declaration (each model):

```prisma
tenantId String @default(dbgenerated("(nullif(current_setting('app.tenant_id', true), ''))::uuid")) @db.Uuid
@@index([tenantId])
```

The column default reads the transaction's tenant context: an insert that forgets `tenantId` still lands in the right tenant, and an insert with **no** context fails the `NOT NULL` constraint (fail closed).

### 6.3 Uniqueness changes

| Table | Today | Becomes | Reason |
|---|---|---|---|
| `crm_users.User` | `email` unique | **unchanged (global)** | One login identity per person; workspace access comes from `Membership` |
| `crm_users.User` | `phoneE164` unique | **unchanged (global)** | identity attribute |
| `crm_users.Membership` | — | `(tenantId, userId)` | new |
| `crm_users.VendorProfile` | `businessRegistrationNumber` unique | `(tenantId, businessRegistrationNumber)` | vendor records are the agency's own supplier data |
| `crm_users.OrganizationSettings` | singleton by convention | `tenantId` unique | one per tenant, enforced by DB |
| `crm_leads.Settings` | `singletonKey` unique | `tenantId` unique (drop `singletonKey`) | same |
| `crm_billing.Invoice/Quotation/PaymentReceipt/PaymentHistory/CreditNote/Voucher` | `<x>Number` unique | `(tenantId, <x>Number)` | each agency has its own numbering |
| `crm_packages.Package` | `slug` unique | `(tenantId, slug)` | |
| `crm_packages.Place`, `ActivityCatalog` | `name` unique | `(tenantId, name)` | per-tenant catalogue, seeded from a platform template at signup |
| `crm_leads.Lead` | `(intakeChannel, intakeSessionId)` | `(tenantId, intakeChannel, intakeSessionId)` | |
| `crm_assistant.*` | `(actorId, …)` uniques | prefixed with `tenantId` | |
| `crm_recommendations.Recommendation` | `(scopeKey, key)` | `(tenantId, scopeKey, key)` | |
| **Kept global** | `VoiceNumber.e164`, `VoiceCall.conversationId`, `LeadInternalEvent.eventId`, all `id` PKs | unchanged | Provider-owned or random routing keys must map to **exactly one** tenant; global uniqueness is what guarantees that |

Child-table uniques that already include a parent id (`LeadItineraryDay(leadPackageSelectionId, dayNumber)`, etc.) stay as they are; `tenantId` is added as a plain column.

### 6.4 Row-Level Security

For every table in every `crm_*` schema except `crm_platform`:

```sql
ALTER TABLE crm_leads."Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads."Lead" FORCE  ROW LEVEL SECURITY;   -- applies to the table owner too
CREATE POLICY tenant_isolation ON crm_leads."Lead"
  USING      ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK ("tenantId" = (nullif(current_setting('app.tenant_id', true), ''))::uuid);
```

Missing context ⇒ `NULL` ⇒ zero rows readable, no row writable.

**Database roles** (created once via Supabase SQL editor, scripted in `infra/`):

| Role | Used by | Rights |
|---|---|---|
| `crm_migrator` | `DIRECT_URL`, `migrate deploy` only | owns tables, DDL |
| `crm_app` | every service's `DATABASE_URL` (via pooler as `crm_app.<project-ref>`) | DML on `crm_*`, **`NOBYPASSRLS`**, not an owner, no DDL |
| `crm_platform_app` | platform-service only | DML on `crm_platform`, read-only on the reporting views below |
| `crm_reporting` | platform usage roll-ups | `SELECT` on aggregate views only (counts, never row data) |

Also: confirm the `crm_*` schemas are **not** in Supabase's exposed Data API schemas, and that the `anon`/`authenticated` roles have no grants on them.

### 6.5 The shared tenant-aware data access library

New package `Services/shared/tenancy/`:

- `tenantContext` — `AsyncLocalStorage` holder; `requireTenant()` throws `TENANT_CONTEXT_MISSING` (500, alerting) when absent.
- `createTenantPrisma(PrismaClient)` — `$extends({ query: { $allModels: { $allOperations } } })` that:
  1. reads the context (throws if absent);
  2. adds `tenantId` to `where` (reads/updates/deletes, including `findUnique` via `extendedWhereUnique`) and to `data` (creates/upserts/`createMany`);
  3. runs `set_config('app.tenant_id', …, true)` and the operation in one `$transaction` (the pattern from Prisma's official RLS extension example);
  4. exposes `tenantTransaction(fn)` for interactive transactions so the setting is applied once at the start and nested calls do not open a second transaction.
- `withTenantPg(pool, fn)` for analytics/notification (`pg`): `BEGIN; SELECT set_config(...); …; COMMIT` on one checked-out client.
- Cache helper: `tenantCache(namespace)` whose keys are always `${tenantId}:${key}`.

Lint rules (eslint `no-restricted-syntax`/`no-restricted-imports`) in every service: no `new PrismaClient()` outside `src/db/client.js`, which must use `createTenantPrisma`; no direct `pool.query` outside `withTenantPg`; no module-level `let cache`.

## 7. Existing Data and Test Workspaces

All current data is test and demo data (confirmed by the product owner on 2026-11-07). There is no real customer data to preserve, so the migration is a one-step rebuild instead of a long compatibility period.

### 7.1 Approach: one migration per service, final form directly

- Each Prisma service gets a single `add_tenancy` migration that goes straight to the final shape. There are no temporary compatibility defaults and no period where old and new code run together.
  1. Add `"tenantId" uuid` (nullable), then set every existing row to the demo workspace `lush-demo`, then `SET NOT NULL` and the context default (§6.2). This keeps the existing demo data usable instead of deleting it.
  2. Composite uniques (§6.3), `Membership`, `DocumentCounter`, `crm_platform` tables.
  3. Enable and force RLS with policies on every table.
- The new code and the migrations ship together in one release, first on dev, then staging.
- Still mandatory, because the database is shared with other developers and sessions: a `pg_dump` before applying; `db:migrate:deploy` / `migrate-all.mjs` only, never `migrate dev` (per `CLAUDE.md`); and no other session applying migrations at the same time.
- Analytics (`pg`) and every raw SQL call site are updated in the same release.

### 7.2 Test workspaces (`seed-demo.mjs` becomes tenant-aware)

The seed builds several agencies on purpose, so isolation is tested against realistic data, not a single tenant.

| Workspace | Shape | Purpose |
|---|---|---|
| `lush-demo` | All existing rows (backfilled), existing `isSuperAdmin` accounts become owners | Proves current flows still work |
| `acme-tours` | Small agency: 1 owner, 2 sales reps, ~30 leads, Starter plan | Plan limits, small-team flows |
| `globe-dmc` | Operator/DMC: owner, admin, 5 reps, vendors, ~80 leads with cost lines, invoices, vouchers, Pro plan | Full finance chain, permissions |
| Shared user `consultant@…` | Member of `acme-tours` (salesRep) and `globe-dmc` (admin) | Workspace switching, role per workspace |

The seed deliberately creates **colliding values** across workspaces: the same invoice and quotation numbers (`INV-202611-0001` in each), the same package slug, the same `Place` names, and the same traveller email/phone on leads. The isolation suite then proves each workspace sees only its own copy. All rows carry the seed's id prefixes, so `seed-demo.mjs --reset` and `clean-test-data.mjs` stay scoped.

### 7.3 Verification (`Services/verify-tenancy.mjs`)

- No row in any `crm_*` table has a NULL `tenantId`.
- RLS coverage: every table in `crm_*` (excluding `crm_platform`) has `relrowsecurity AND relforcerowsecurity` and a `tenant_isolation` policy (from `pg_class`/`pg_policies`). **Runs in CI forever**, so a new table without RLS fails the build.
- With the `crm_app` role and no context, `SELECT count(*) FROM crm_leads."Lead"` returns 0.
- Cross-workspace matrix across the seeded workspaces (§12) passes.
- Full `Services/e2e-tests` and Management Playwright suites pass in `lush-demo`.

### 7.4 Accounts

- Existing users keep their login and get one `Membership` in `lush-demo` with their current role and permissions; `isSuperAdmin` becomes `owner`.
- Lushware staff get separate `PlatformUser` accounts with MFA. No existing account becomes platform staff.
- All existing sessions are invalidated at the release (new token format).

### 7.5 Once real agencies exist

The first real agency is created only after the Phase 1 exit gate (§11) passes. From that point on, real data exists, so every later schema change follows **expand → migrate code → contract**, with a backup before each step and a tested rollback.

## 8. Integration Hub (self-serve integrations)

### 8.1 Model (`crm_integrations`, owned by integration-service)

```
TenantIntegration
  id, tenantId, provider, label, status (pending, connected, error, revoked)
  config            jsonb   -- non-secret settings, validated by a per-provider zod schema
  secretCiphertext  bytea   -- AES-256-GCM
  wrappedDek        bytea   -- DEK wrapped by Cloud KMS key 'integrations-kek' (per environment)
  kekVersion, secretFingerprint (sha256 prefix, shown in UI), lastFour
  lastTestedAt, lastError (sanitised), connectedById, createdAt, updatedAt
  @@unique([tenantId, provider, label])

InboundRoute
  provider, externalId      -- e.g. ('whatsapp', phone_number_id), ('facebook', page_id), ('voice', e164)
  tenantId, integrationId
  @@unique([provider, externalId])   -- one external id → exactly one tenant
```

Both tables are under tenant RLS (except `InboundRoute` lookups, done through a `SECURITY DEFINER` function that returns only `tenantId, integrationId` for a given `(provider, externalId)`).

### 8.2 Secret handling rules

- Encryption AAD = `tenantId|integrationId|provider`: ciphertext copied to another tenant's row fails to decrypt.
- Only integration-service's service account has `cloudkms.cryptoKeyVersions.useToDecrypt`.
- Secrets are **write-only** through the API: the UI shows status, fingerprint and last four characters, never the value. Replacing a secret is a new write.
- Plaintext is held in memory per request (cache ≤ 5 min, keyed by tenant), never logged (pino redact paths include every credential field), never put in error messages.
- Sending services (notification-service for email/WhatsApp, flight-service for Duffel) obtain credentials from integration-service per call over an authenticated internal request, or integration-service performs the provider call itself (preferred for low-volume providers).
- Every connect, change, test and disconnect writes an `AuditLog` entry.

### 8.3 Connect flows (prefer OAuth/embedded flows over pasted keys)

| Integration | Flow | Tenant-visible setup |
|---|---|---|
| Email (platform-sent) | Default: sent from the platform domain with `Reply-To` = agency | none |
| Email (own domain) | Tenant enters domain → we show SPF/DKIM/DMARC records → verify → mail from `@agency.com` | DNS records + verify button |
| WhatsApp | Meta **Embedded Signup** with the platform's Meta app; we store WABA id + phone_number_id + system-user token; templates submitted via API, approval status shown | "Connect WhatsApp" button |
| Payments to agency | **Stripe Connect** (Standard) — funds go to the agency's own account; we never touch card data (PCI scope stays SAQ-A) | "Connect Stripe" button |
| Facebook / Instagram lead ads | OAuth (Meta) → choose page → we subscribe the page webhook; `InboundRoute(facebook, page_id)` | Connect + pick page |
| Google Ads lead forms | Per-tenant webhook URL + generated key shown once | Copy URL/key into Google Ads |
| Flights (Duffel) | Platform account with per-tenant markup, **or** tenant's own access token | Toggle + token field |
| GDS (Travelport/Amadeus) | Tenant enters credentials from **their own** commercial contract — cannot be fully self-serve | Credential form + test |
| AI assistant / voice / recommendations | **Deferred** (platform-provided and metered when enabled) | — |

Every integration provides: `validateConfig` (zod), `testConnection`, `registerWebhooks`, `revoke`, `healthCheck` (scheduled; failures alert the tenant owner by email and in-app).

### 8.4 Inbound webhooks

1. Verify the provider signature **before** parsing anything (platform app secret for Meta, per-tenant secret for generic webhooks, ElevenLabs/Duffel secrets as today).
2. Resolve tenant via `InboundRoute(provider, externalId)` where `externalId` comes from the signed payload (phone_number_id, page_id, called number) or from the per-tenant URL path for providers that sign with a per-tenant secret.
3. Unknown `externalId` ⇒ 404 + structured warn log + metric. **Never** fall back to Tenant #1.
4. Mint an internal context for that tenant and continue.

### 8.5 SSRF guard

Any tenant-supplied host/URL (SMTP host, outbound webhook, image URL to fetch) goes through one helper: `https` only (SMTP: port allowlist), resolve DNS, reject private, loopback, link-local and `169.254.169.254`, re-check after redirects, short timeouts. Cloud Run egress through a VPC connector with firewall rules as backstop.

## 9. Per-Tenant Configuration and Product Surfaces

- **Organization settings** (`OrganizationSettings` per tenant): branding, contact, PDF theme, document terms, numbering prefixes, bank/UPI details (admin/owner only). `orgSettings.js` cache becomes `tenantCache('org-settings')` — the current module-level cache would put tenant A's bank details on tenant B's invoice.
- **Lead assignment settings** (`crm_leads.Settings` per tenant). `enabledSalesRepIds` validated to belong to the same tenant (RLS makes foreign IDs unresolvable).
- **Catalogues**: `Place`/`ActivityCatalog` seeded per tenant from a platform template at signup; tenants edit their copy.
- **Public website (Client)**: out of scope. It keeps working for Tenant #1 only, through the gateway pin in §5.4. Other workspaces get no public website routes until a website feature is designed.
- **Management**: one build at one address; workspace from the token; adds signup, workspace picker/switcher, and settings pages for Team & invites, Roles, Integrations, Billing, Audit log, Data export.
- **Files**: Cloudinary path `tenants/{tenantId}/{kind}/{uuid}`. Financial PDFs uploaded as `type: authenticated`; the customer link and WhatsApp media URL are signed and expire (WhatsApp needs ~1 h). Per-tenant storage counted in `UsageCounter`.
- **Email templates** (`emailLayout.js` in auth/booking/career) read branding from tenant settings instead of hardcoded strings.
- **Logging**: every log line gets `tenantId` alongside `requestId`.

## 10. Tenant Lifecycle

**Signup** (`app.<domain>/signup`): name + email + password → Turnstile/reCAPTCHA, IP and email-domain rate limits, disposable-email block → email verification → "Create workspace" (agency name) → provisioning runs as one idempotent job:

1. `Tenant` (status `trial`)
2. Owner `Membership` for the signing-up user (MFA enrolment forced before first sensitive action)
3. `OrganizationSettings`, lead `Settings`, `DocumentCounter` rows
4. Catalogue seed, default email/WhatsApp templates
5. Audit entry; welcome email; onboarding checklist

An existing user can create additional workspaces from the workspace switcher (limited per account to stop abuse).

**Onboarding checklist** (in Management): company & branding → documents & bank details → invite team → import leads/packages (CSV with preview, validation report, per-row errors, max file size, MIME/extension allowlist) → connect email → connect WhatsApp → connect payments.

**Billing**: plans with entitlements (seats, packages, monthly emails/WhatsApp/storage; AI later). Subscription via Stripe Billing on the platform account. `past_due` → banner + 14-day grace → `suspended` (read-only for staff, public website shows a neutral page) → owner can export data.

**Deletion**: owner requests with re-auth + typed slug → `pending_deletion` (30-day grace, restorable) → export bundle offered → hard delete job removes the tenant's rows in every schema (one transaction per schema, verified by count = 0), Cloudinary prefix, revokes provider tokens (Meta, Stripe Connect), releases phone numbers, deletes memberships (user identities that have no remaining membership are deleted too) → `Tenant` row kept as a tombstone (`deleted`, no PII) for audit. Note: database backups/PITR keep data until backup retention expires — documented in the DPA.

**Platform console** (`console.lushtravelcloud.com`, behind Google IAP + PlatformUser MFA): tenant search, status, plan, usage, suspend/restore, domain issues, integration health, impersonation. Impersonation: reason required, ≤ 30 minutes, read-only by default, write mode needs a second platform admin's approval, visible banner in the session, and an entry in the **tenant's own** audit log.

## 11. Delivery Phases and Security Gates

| Phase | Scope | Exit gate (must all pass) |
|---|---|---|
| **0 — Harden today's system** | Fix §3.1 #1–#6; `stripInboundIdentity` in gateway; CORS allowlist; httpOnly `__Host-` cookies + refresh sessions, remove tokens from `localStorage`; asymmetric JWT with JWKS; private signed PDFs; atomic document counters; Redis-backed rate limits | Header-forgery regression tests per public route; no token in any JS-readable storage; PDF URLs unguessable and expiring |
| **1 — Tenant foundation** | `crm_platform`, `Membership`, `add_tenancy` migration per service, multi-workspace demo seed (§7.2), token-based tenant + workspace switch, public-route pin to Tenant #1, context tokens, `shared/tenancy`, all 67 tables + all raw SQL tenant-aware, lint rules, RLS coverage check in CI | Verification script green; **isolation suite** green across the seeded workspaces (every endpoint: list, get-by-id, update, delete, search, export, PDF, file, webhook — tenant A must get 404/empty for B's ids); a missing-context test returns zero rows |
| **2 — Per-tenant config + platform console** | Org/lead settings, catalogues, roles (`owner`), audit log, platform console with impersonation, entitlements, per-tenant logs/metrics | Audit entries for every privileged action; impersonation visible to tenant |
| **3 — Integration Hub** | integration-service + KMS; email (platform + own domain), WhatsApp Embedded Signup, Stripe Connect, Meta/Google lead ads; webhook routing; SSRF guard | Secrets never appear in API responses/logs (automated log scan); unknown webhook routing key → 404; KMS AAD swap test fails decrypt |
| **4 — Self-serve SaaS** | Signup, provisioning, invites, onboarding checklist, CSV import, subscriptions, suspension/deletion/export | **External penetration test** before the first external agency; deletion verification report |
| **5 — Later** | Flights per tenant, AI products per tenant (assistant, voice, recommendations), per-agency public websites and custom domains, data residency, dedicated-DB tier | Per-product design docs |

**Status (2026-11-12):**

| Phase | Status | Gate evidence |
|---|---|---|
| 0 | Built | Header-forgery tests per public route (gateway `security.test.js`); httpOnly cookies + refresh sessions; asymmetric JWT |
| 1 | Built | `verify-tenancy.mjs` green; isolation suite (`e2e-tests/flows/tenant-isolation.spec.js`) 37/37 with RLS enforced under `crm_app` |
| 2 | Built, not deployed | Audit entries for every privileged action (see "Phase 2 as built"); help access recorded in the agency's own audit log and shown as a banner in its session |
| 3–5 | Not started | — |

**Phase 2 as built** (differs from the row above in these ways):
- **Help access instead of impersonation.** Lushware staff get view-only access to an agency for 15 or 30 minutes, with a required reason, a one-time code, a banner in the session, and `platform.help_access_started`/`_ended` entries in the agency's own audit log. Every write is refused at the gateway (`HELP_ACCESS_READ_ONLY`). Write-mode impersonation was not built and is not planned.
- **Entitlements:** see §15 "As built".
- **Audited actions:** staff added/invited/removed/suspended/reactivated, role, permission, owner and commission changes, password-reset links; organization and bank-detail settings; lead-assignment settings; policy documents; customer deletion/deactivation; account email changes; lead deletion; quotation and voucher deletion; billing exports; the 80% monthly sending warning; and every console action (sign-in, staff, plans, plan assignment and overrides, suspend/restore, help access).
- **What agencies see of the audit log:** only Lushware support visits, as a "Lushware support access" note in Management's Settings (`GET /admin/support-access`: date, length, reason; never the staff member). The full log, including the agency's own staff actions and Lushware's plan changes and internal notes, is recorded but not shown to agencies; there is no Audit Log page.
- **Per-agency logs:** every service log line carries `tenantId`. Per-agency request/error dashboards and an alert on `TENANT_CONTEXT_MISSING` are Cloud Logging log-based metrics, set up with the deployment.
- **Not yet built:** Redis-backed rate limits (Phase 0 scope, still in-memory per instance); emailing the owner at 80% of a sending allowance (today: audit entry + warning on the plan card).

Pilot plan: after Phase 1's gate, onboard 1–2 friendly agencies with hands-on help through Phases 2–3, and use what they actually need to order the Phase 3 integration list.

## 12. Testing Strategy

- **Unit** (vitest): `shared/tenancy` extension injects `tenantId` for every Prisma operation type; throws without context; cache keys always prefixed.
- **DB policy tests** (vitest against a disposable Postgres in CI, never the shared database): with `crm_app`, tenant A context cannot `SELECT/UPDATE/DELETE` tenant B rows and cannot `INSERT` with B's id; no context ⇒ zero rows.
- **RLS coverage check**: CI job fails when any `crm_*` table lacks forced RLS + policy.
- **Gateway tests**: forged `x-user-*`/`x-tenant-*`/`x-ctx` stripped on public and private routes; URL workspace ≠ token `tid` ⇒ 403; suspended tenant ⇒ 403; public website routes only ever return Tenant #1 data.
- **Auth tests**: switch-workspace to a workspace without an active membership ⇒ 403; removed member's refresh token ⇒ 401; invite token single-use and expiring.
- **Isolation E2E** (`Services/e2e-tests/isolation/`): two marker-tagged tenants created in global setup, the cross-tenant matrix from the Phase 1 gate, cleaned up in teardown.
- **Management Playwright**: signup → create workspace → invite teammate; workspace switch; existing lead → quotation → invoice → payment → voucher journey in `lush-demo` unchanged.
- Test names describe outcomes, e.g. "returns 404 when tenant A requests tenant B's invoice by id".

## 13. Operational Notes

- Redis (Memorystore) becomes required: rate limits, tenant/domain cache, session revocation hints.
- Per-tenant dashboards: request rate, error rate, latency, quota usage; alert on any `TENANT_CONTEXT_MISSING`.
- The extra `set_config` round trip per query must be measured in Phase 1 staging (p95 per endpoint before/after); `tenantTransaction` batching is the mitigation.
- `CLAUDE.md` gains a Tenancy section (context rules, lint rules, never-bypass-RLS, how to add a table) once Phase 1 lands.

## 14. Decisions and Open Questions

**Decided (product owner, 2026-11-07)**

| Topic | Decision | Design impact |
|---|---|---|
| Launch market | **Global (all markets)** | Plan prices in several currencies (Stripe multi-currency prices); Stripe Tax for subscription VAT/GST; per-workspace `defaultCurrency`, timezone and date/number formats; no market-specific fields required at signup (GST, IFSC, UPI become optional, country-dependent fields) |
| App address | **`app.lushtravelcloud.com`** | One address for every agency (§5.1); platform console at `console.lushtravelcloud.com` |
| Subscription billing | **Stripe** (Stripe Billing for subscriptions; Stripe Connect for agencies' own traveller payments, §8.3) | Customer Portal for self-serve card/plan changes; webhooks drive `Subscription` status (§10) |
| Who has accounts | **Only agencies use the SaaS.** Accounts are agency staff (owner, admin, sales rep). Travellers/customers never get platform accounts | Signup always creates an agency workspace; `customer`/`vendor` accounts remain only inside `lush-demo` for the legacy website. Multi-workspace membership stays technically supported for agency staff (e.g. the consultant test user), and can be capped by config |

| Legacy `Server/` | **Not used.** Out of scope entirely; remove from the repo in a separate cleanup | No tenancy work for MongoDB |
| Data residency | **One region at launch (current `ap-southeast-1`), built so regions can be added later** | `Tenant.region` is stored from day one (value `apac` for everyone). Global compliance at launch comes from a Data Processing Agreement with Standard Contractual Clauses, a published sub-processor list (Supabase, Google Cloud, Cloudinary, Stripe, Meta, email provider), encryption at rest and in transit, and per-workspace export/deletion. An EU region (separate database + services, workspaces pinned by `Tenant.region`, routing by token claim) is added in Phase 5 only when EU demand or a customer contract requires it. Running several regions before there are customers would double cost and operational risk for no benefit |

No open questions remain that block Phase 0 or Phase 1.

## 15. Product Positioning, Plans and Entitlements

### 15.1 Competitive frame

From the product owner's competitor sheet (prices as published or reported there; not independently verified):

| Group | Products | Entry price | What they are |
|---|---|---|---|
| **Direct competitors: travel-advisor CRMs** | TravelJoy, Travefy, Tern | $19–59 per account or $35–49 per seat / month | CRM, itineraries/proposals, payments, commission tracking for solo advisors and small agencies |
| **Direct competitors: operator/DMC platforms** | Ezus, Tourwriter, TravelWorks, Moonstride | ~$75–195 per user / month, or custom | Trip production, supplier costing, quotes, back office and finance for tour operators, DMCs, mid-size agencies |
| Generic CRMs | HubSpot, Zoho, Pipedrive, Freshsales | Free to ~$20 per seat | Cheap pipeline tools with no travel operations |
| Adjacent | Axus, Vamoos, mTrip | $35+/seat, volume-based, custom | Itinerary display and traveller apps |
| Infrastructure | Sabre / Amadeus | Transaction / contract | GDS distribution, an integration rather than a competitor |

**Where this product sits.** It already covers the full chain that operator platforms charge $75+ per user for: lead → day-by-day itinerary → cost-line pricing → quotation → invoice → receipt → voucher, plus vendors and hotel/flight booking. But it is as easy to start as the advisor CRMs. The target is **small and mid-size agencies and DMCs that have outgrown TravelJoy/Tern-level tools but find Ezus/Tourwriter too expensive or too heavy.**

**Differentiators to lead with** (already built):
- WhatsApp-native delivery of quotations, invoices, receipts and vouchers. Competitors are email-first.
- Automatic lead intake from Facebook, Instagram and Google Ads lead forms.
- A complete finance document set with branded PDFs, credit notes and vouchers.
- Later, as add-ons: AI copilot and voice sales agent. None of the listed competitors offers a voice agent.

**Gaps compared with competitors** (backlog candidates after the SaaS foundation, in rough order of how often competitors offer them):
1. Online payment collection from travellers on invoices (TravelJoy, Travefy). Builds on Stripe Connect from §8.3.
2. A client-facing trip page or proposal link that the traveller can view and approve (Travefy, Axus, Vamoos).
3. Commission and supplier-payable tracking (Tern, TravelJoy, TravelWorks).
4. Accounting export (Xero/QuickBooks/Zoho Books) (TravelWorks, Moonstride).
5. Supplier rate contracts and seasonal rates (Tourwriter, Ezus).

### 15.2 Plans (proposal: final prices are a business decision)

Seat-based, like most of the competitors listed. A seat is an active staff membership; vendors and customers are not seats.

| Module (entitlement key) | Starter | Growth | Pro |
|---|---|---|---|
| Leads & pipeline (`leads`) | ✓ | ✓ | ✓ |
| Packages & itinerary builder (`packages`) | ✓ | ✓ | ✓ |
| Quotations with branded PDF (`quotations`) | ✓ | ✓ | ✓ |
| Email sending (`email`) | ✓ | ✓ | ✓ |
| Invoices, receipts, credit notes, vouchers (`finance_docs`) | — | ✓ | ✓ |
| WhatsApp delivery (`whatsapp`) | — | ✓ | ✓ |
| Lead-ads intake (`lead_ads`) | — | ✓ | ✓ |
| Vendors / suppliers (`vendors`) | — | ✓ | ✓ |
| Hotel & flight booking (`travel_booking`) | — | — | ✓ |
| Analytics (`analytics_full`) | basic | full | full |
| Audit log export, custom roles (`advanced_admin`) | — | — | ✓ |
| AI copilot / voice agent (`ai_copilot`, `voice_agent`) | — | add-on (later) | add-on (later) |
| Seats | up to 3 | per seat | per seat |

Pricing hypothesis to test with pilots: Starter ≈ $25, Growth ≈ $45, Pro ≈ $75 per seat per month, about 20% off annually, and a 14-day trial of Growth. Growth undercuts the operator platforms while costing about the same as the advisor CRMs. The launch is global: USD is the reference price, with local-currency prices set in Stripe for major currencies (EUR, GBP, AUD, INR, and others as demand appears).

**Careers** (`careers`) is Lush's own hiring page, not a product feature. It is disabled for every workspace except `lush-demo`.

### 15.3 How entitlements are enforced

- `Plan.entitlements` holds module keys, seat limit and monthly quotas (emails, WhatsApp messages, storage; AI usage later).
- **Server-side enforcement is mandatory.** The gateway checks module keys by route prefix (§5.4 step 6), and services check them again for actions that cross modules (for example, converting a quotation to an invoice needs `finance_docs`). Hiding menu items in Management is only for convenience and is never relied on.
- Inviting a teammate past the seat limit is blocked, with an "upgrade or add seats" prompt.
- Upgrades apply immediately. **Downgrades never delete data**: modules no longer in the plan become read-only, and existing documents stay viewable and downloadable.
- Quota counters live in `UsageCounter`; at 80% the owner is warned, and at 100% sending pauses with a clear message. A quota is never silently exceeded or silently dropped.

### 15.4 As built (Phase 2, 2026-11-12)

**Plans** live in `crm_platform`: `Plan` → immutable `PlanVersion`s (editing a plan creates a new version; agencies keep the version they were given) → `TenantPlan` (one per agency, optional special price) → `PlanEntitlementOverride` (per-agency special deals, reason required). **An agency with no plan gets every feature with no limits.** Pricing is a **flat price per agency with seat caps**, not per seat; starting prices are placeholders in `platform-service/src/planDefaults.js`, edited in the console.

**Entitlements** (`shared/tenancy/src/entitlements.js`):

| Kind | Keys | Enforced by |
|---|---|---|
| Limits (null = unlimited) | `staff_seats`, `packages` | user-service / package-service, under an advisory lock |
| Monthly allowances | `emails_per_month`, `whatsapp_per_month` | `meteredSend` in billing-service and lead-service; `UsageCounter` per agency, metric and UTC month |
| Feature | `ai_itinerary_builder` | package-service route check |
| Modules | `finance_docs`, `whatsapp`, `vendors`, `travel_booking` (flights), `analytics_full` | Gateway by route (`gateway/src/planModules.js`) + live service checks for cross-module actions |

- A stored plan version that does not mention a module includes it (only `ai_itinerary_builder` defaults to off), so plans saved before modules existed keep working unchanged.
- Switched-off modules travel in the staff login token (`off`), so the gateway needs no database; a plan change reaches staff at the next token renewal (≤ 15 minutes). Services check live for actions the gateway cannot see by route: quotation → invoice needs `finance_docs`; every WhatsApp send needs `whatsapp`.
- **Downgrades never hide data:** a switched-off record module (`finance_docs`, `vendors`, `travel_booking`) stays readable and refuses only changes (403 `FEATURE_NOT_IN_PLAN`). `analytics_full` blocks the report pages entirely; the dashboard figures stay in every plan. Management marks such menu items with a lock instead of hiding them.
- **Only customer-facing sends are metered** (billing documents by email and WhatsApp, staff WhatsApp replies). Sign-in codes, password resets and staff notifications are never counted or paused. Over the allowance → 429 `USAGE_LIMIT_REACHED`; a failed send gives its unit back; if the counter itself is unreachable the send goes out and the failure is logged.
- `lead_ads` waits for Phase 3 (lead-ads webhooks still route only to Tenant #1); `advanced_admin` was dropped because the audit log must stay visible to every agency, since help-access transparency depends on it.

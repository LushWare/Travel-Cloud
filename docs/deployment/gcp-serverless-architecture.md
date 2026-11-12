# GCP Serverless Deployment — Architecture Decision Record

Status: accepted. This document is the durable architecture record for Travel-CRM's first-stage GCP serverless deployment. It records the decisions made, the rejected alternatives, the service-exposure and secrets model, and what is deliberately deferred; the Terraform and CI/CD configuration in this repository implements exactly this design.

## 1. Components

| Deployable | GCP target | Rationale |
|---|---|---|
| Client SPA | Firebase Hosting — one site per environment (`Client/dist`) | First-party customer-facing SPA served as a static build; gets real custom domains (`lushtravelcloud.com`, `www.lushtravelcloud.com`) via Firebase Hosting's region-independent, free custom-domain feature. |
| Management SPA | Firebase Hosting — one site per environment (`Management/dist`) | First-party admin SPA served as a static build; gets `manage.lushtravelcloud.com` the same way; no server-side compute. |
| Landing page | Firebase Hosting — one site per environment (`Landing/dist`) | Standalone marketing page (Vite + React + Tailwind) with no backend of its own; every CTA links out to the Client/Management sites, whose URLs are baked in at build time. |
| Services (gateway + 12 microservices) | Cloud Run ×13 + Supabase Postgres | All stateless Express apps — one Cloud Run service per `Services/*` directory (12 services) plus `Services/gateway`; they share one Supabase Postgres database with one schema per service, matching the existing `schema.prisma` `schemas` arrays with zero schema changes. |

**Compute.** Cloud Run, one service per `Services/*` directory (12 services) + `Services/gateway` = 13 Cloud Run services. All are stateless Express apps; no code changes needed for Cloud Run compatibility except the gateway ID-token change (see "Service exposure").

**Static hosting.** Firebase Hosting, three sites per environment in one Firebase project — `Client/dist`, `Management/dist` and `Landing/dist` (`Landing/` is the backendless marketing page; `infra/README.md` records the deployed dev URLs).

**Database.** Supabase Postgres (not Cloud SQL) — external managed Postgres, region `ap-south-1` (Mumbai) to match Cloud Run region `asia-south1`. Single database, one Postgres schema per service (`crm_assistant`, `crm_auth`, `crm_users`, `crm_packages`, `crm_leads`, `crm_bookings`, `crm_billing`, `crm_careers`, `crm_flights`), exactly matching the existing `schema.prisma` `schemas` arrays — zero schema changes. Supabase's Supavisor pooler (port 6543, `?pgbouncer=true`) is `DATABASE_URL`; the direct connection (port 5432) is `DIRECT_URL`, used only by `prisma migrate deploy`. This is not new design — `Services/booking-service/.env.example`, `Services/flight-service/.env.example`, and `Services/analytics-service/.env.example` already document exactly this pattern; the other 6 DB-backed services' `.env.example` files are stale and were brought in line by this plan.

## 2. Why not X

### Cloud SQL → Supabase
Cloud SQL was rejected in favor of Supabase because every `schema.prisma`'s `directUrl = env("DIRECT_URL")` already matches Supabase's Prisma pooling pattern.

### GCP API Gateway → gateway kept
GCP API Gateway was rejected. The gateway's core job — decode a custom HS256 JWT (`jwt.sign(..., process.env.JWT_SECRET)`, confirmed in `Services/auth-service/src/controllers/auth.controller.js`) and turn it into trusted `x-user-*` headers for 11 downstream services, plus a hand-tuned public-route allowlist — has no managed GCP equivalent without switching to RS256/JWKS (a real auth-architecture change, out of scope). GCP API Gateway's native JWT auth requires exactly that switch, so it is rejected for this pass. The gateway is kept, not replaced by GCP API Gateway or a bare load balancer.

### External Load Balancer + Cloud Armor → deferred
Deferred (not rejected outright) because Cloud Run domain mapping is unsupported in `asia-south1` (confirmed: supported only in `us-central1`, `us-east1`, `europe-west1`, `asia-northeast1`), and a Global HTTPS LB + Cloud Armor costs a fixed ~$28+/mo this "first stage of app" doesn't need. Instead, the gateway is invoked directly at its default `*.run.app` URL (Cloud Run's built-in HTTPS endpoint, works in every region, $0 extra) — `Client`/`Management` call it via `VITE_API_URL` set to that URL, with no custom `api.` domain for stage 1. Edge WAF/rate limiting (Cloud Armor's job) is not replaced by anything for stage 1 — accepted risk, documented with an explicit revisit trigger (see "Deferred, with revisit triggers"). Cloudflare in front of the Firebase Hosting domains is noted as an optional $0 future add, not built now.

## 3. Service exposure

The 11 non-gateway Cloud Run services are deployed with `ingress = all` (required — Cloud Run's `internal` ingress only admits traffic from resources actually attached to a VPC connector, which nothing in this architecture has) but `allow_unauthenticated = false`, with Cloud Run IAM invoker (`roles/run.invoker`) granted **only** to the gateway's service account. This closes the gap that public ingress would otherwise open: without an additional check, any caller who discovers a backend's `*.run.app` URL could bypass the gateway's JWT check entirely. The gateway must therefore mint a Google-signed ID token per backend call — a required code change, not optional hardening:

- New gateway dependency: `google-auth-library` (`^9.15.0`).
- A module-level `GoogleAuth` instance plus an `IdTokenClient` cache keyed by backend target URL (`getIdTokenClient` internally handles token refresh, so one client per target is correct and avoids re-fetching metadata-server credentials on every request); a `getAuthHeader(target)` async helper returns the ready-to-use `Authorization: Bearer <id_token>` header for that target's audience.
- Env-var gate: `K_SERVICE` is a Cloud Run-only auto-injected env var. When it is unset (local dev / docker-compose / CI test runs), `getAuthHeader` returns `null` and the proxy behaves exactly as today — local dev keeps working unauthenticated.
- No changes to any of the 11 backend services — Cloud Run's platform-level IAM invoker check rejects unauthorized requests before they reach the Express app, so there is nothing for the backends to validate.

The gateway itself is invoked at its default `*.run.app` URL. `Client`/`Management` call it via `VITE_API_URL` set to that URL; the two SPAs still get real custom domains (`lushtravelcloud.com`, `www.lushtravelcloud.com`, `manage.lushtravelcloud.com`) via Firebase Hosting's own custom-domain feature, which is region-independent and free.

**No VPC, no Cloud SQL, no Serverless VPC Access / Direct VPC egress** — Supabase is reached over the public internet with TLS; there is nothing else in the architecture that needs a private network.

## 4. Secrets and config

All secrets live in Secret Manager. Because all three environments share one GCP project and Secret Manager IDs are unique per project, every created secret ID is env-prefixed: the actual secret ID is `${env}-<Secret ID>` (e.g. `prod-database-url`, `dev-jwt-secret`). The table below lists the unprefixed logical Secret ID, the env var it populates, and the consuming service(s).

| Secret ID | Env var | Consumers |
|---|---|---|
| `database-url` | `DATABASE_URL` | auth, user, package, lead, booking, billing, career, flight, analytics, assistant |
| `direct-url` | `DIRECT_URL` | auth, user, package, lead, booking, billing, career, flight, analytics, assistant |
| `jwt-secret` | `JWT_SECRET` | gateway, auth |
| `internal-service-key` | `INTERNAL_SERVICE_KEY` | user, package, billing, assistant |
| `internal-events-token` | `INTERNAL_EVENTS_TOKEN` | billing, lead, notification |
| `cloudinary-api-key` | `CLOUDINARY_API_KEY` | package, billing, career |
| `cloudinary-api-secret` | `CLOUDINARY_API_SECRET` | package, billing, career |
| `stripe-secret-key` | `STRIPE_SECRET_KEY` | billing |
| `razorpay-key-id` | `RAZORPAY_KEY_ID` | billing |
| `razorpay-key-secret` | `RAZORPAY_KEY_SECRET` | billing |
| `gemini-api-key` | `GEMINI_API_KEY` | package, assistant |
| `email-user` | `EMAIL_USER` | notification, booking |
| `email-password` | `EMAIL_PASSWORD` (notification) / `EMAIL_PASS` (booking — differing var name, confirmed from each service's own `.env.example`) | notification, booking |
| `whatsapp-access-token` | `WHATSAPP_ACCESS_TOKEN` | notification |
| `whatsapp-app-secret` | `WHATSAPP_APP_SECRET` | notification |
| `whatsapp-verify-token` | `WHATSAPP_VERIFY_TOKEN` | notification |
| `facebook-verify-token` | `FACEBOOK_VERIFY_TOKEN` | notification |
| `facebook-app-secret` | `FACEBOOK_APP_SECRET` | notification |
| `facebook-page-access-token` | `FACEBOOK_PAGE_ACCESS_TOKEN` | notification |
| `duffel-access-token` | `DUFFEL_ACCESS_TOKEN` | flight |
| `travelport-client-id` | `TRAVELPORT_CLIENT_ID` | flight |
| `travelport-client-secret` | `TRAVELPORT_CLIENT_SECRET` | flight |
| `travelport-token-url` | `TRAVELPORT_TOKEN_URL` | flight |
| `travelport-api-base-url` | `TRAVELPORT_API_BASE_URL` | flight |
| `travelport-access-group` | `TRAVELPORT_ACCESS_GROUP` | flight |
| `travelport-target-branch` | `TRAVELPORT_TARGET_BRANCH` | flight |

Plain env vars (set directly on the Cloud Run service, not Secret Manager):

- `NODE_ENV=production` — all 13 services.
- `CLIENT_URL` / `MANAGEMENT_URL` — that environment's two Firebase Hosting site URLs (gateway, booking, analytics).
- `CLOUDINARY_CLOUD_NAME` — package, billing, career (not a secret; it's part of every public Cloudinary asset URL).
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`/absent, `EMAIL_FROM` — notification, booking.
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` — notification.
- `TRAVELPORT_ENV=sandbox`, `TRAVELPORT_MOCK_MODE` — flight (leave `true` until real Travelport credentials are supplied).
- `GEMINI_ROUTER_MODEL=gemini-3.5-flash-lite` — assistant; this model is pinned independently from the resolver, on the lite tier because the stage-1 classifier has a 1.5s budget.
- `ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED=true` — assistant; the conversational pair and the stage-1 router are both gated by this. It ships enabled now that the client bundle has propagated and the rollback window has been tested; the flag itself is a removal candidate.
- `ASSISTANT_ROUTER_SOCIAL_ENABLED=false` and `ASSISTANT_ROUTER_OFF_TOPIC_ENABLED=false` — assistant; these direct-response classes remain independently disabled until their evaluation gates pass.
- `ASSISTANT_ROUTER_SOCIAL_THRESHOLD=0.95` and `ASSISTANT_ROUTER_OFF_TOPIC_THRESHOLD=0.95` — assistant confidence thresholds for the corresponding direct-response classes.
- Every `*_SERVICE_URL` var — resolved from that same environment's `module.services[...].uri` outputs, so an environment's gateway only ever points at that same environment's backends, never another environment's.
- `SKIP_OTP` is deliberately never set in any environment.

### Assistant intent-router rollout and evaluation

The router is an abstaining, stage-one classifier. A committed social or off-topic fast path is allowed only when its class flag is enabled, confidence meets that class's threshold, and the message has no actionable clause; otherwise the normal resolver handles the turn. Keep both direct-response flags disabled in every environment until the class has at least 50 `real_sanitized` direct-response examples and passes every precision, confidence, data, and zero-leak safety gate. The checked-in synthetic corpus is not evidence for enablement.

Before deploying a schema change, run the assistant migration through the existing migration step (`Services/migrate-all.mjs`, using `DIRECT_URL`), which applies the nullable turn correlation and resolution metadata fields. To inspect the checked-in corpus without a model call, run `cd Services/assistant-service && npm run eval:router -- --validate-only`. A live replay uses `npm run eval:router -- evaluation/<corpus>.jsonl`, one Gemini request per row with one attempt and a 1.5-second timeout; it is currently blocked by the provider's 5 RPM quota and timeout budget, so an incomplete replay must not be used to enable a class.

## 5. Deferred, with revisit triggers

- **External LB + Cloud Armor** — revisit when: sustained production traffic, a compliance requirement, or a real abuse/DDoS incident.
- **Custom `api.` domain for the gateway** — revisit when: a mobile client or third-party integration needs a stable branded API host (today only the two first-party SPAs call it). Options at that point: move the gateway's Cloud Run service to a domain-mapping-supported region, or add one LB serverless NEG in front of just the gateway.
- **Redis rate-limit store** — the gateway now reads `REDIS_URL` for shared limits across Cloud Run instances. It is required in production; local development may omit it and use process-local limits. Redis is not provisioned by this Terraform stack, so deployment remains blocked until a managed Redis endpoint is chosen and `REDIS_URL` is supplied securely to the gateway. Prefer a TLS endpoint reachable from Cloud Run; do not put credentials in checked-in env files.

## 6. Cloud Logging and agency visibility

Agency-aware services emit request log entries with the gateway-forwarded `tenantId` and `requestId`. Save a Logs Explorer query or use the same filter in a Cloud Logging dashboard to inspect one agency:

```text
jsonPayload.tenantId="AGENCY_UUID"
```

Tenant-context failures are logged with `jsonPayload.alertType="missing_tenant_context"` and `jsonPayload.errorCode="TENANT_CONTEXT_MISSING"` (with the request ID for tracing). Create a log-based alert using:

```text
jsonPayload.alertType="missing_tenant_context"
```

Route that alert to the operations notification channel. These log fields and filters are implemented in the services; the Cloud Logging dashboard, alert policy, and notification channel must be created in the target GCP project during deployment.

## 7. Region

Cloud Run, Artifact Registry, and Secret Manager run in `asia-south1` (matches the app's `en-IN`/INR defaults and the `lushtravelcloud.com` production domain). The Supabase project region is `ap-south-1` (Mumbai), chosen at manual Supabase project-creation time.

## Provisioning, CI/CD, and cost

- **IaC**: Terraform, GCS state backend. **CI/CD**: GitHub Actions (extends the existing `.github/workflows/` setup), Workload Identity Federation for GCP auth (no long-lived JSON key committed to GitHub secrets).
- **Migrations**: `Services/migrate-all.mjs` (existing, already idempotent — runs `prisma migrate deploy` per service) runs as a CI step against `DIRECT_URL`, before backend Cloud Run deploys, after image builds.
- **Cost floor this plan produces**: ~$2/mo GCP (Secret Manager + Artifact Registry storage) + $0 Cloud Run/Firebase Hosting at low traffic (free tier) + Supabase free tier ($0, pauses after 7 days idle — acceptable for stage 1; upgrade to Supabase Pro $25/mo before real user traffic to avoid pausing).
- **Multi-tenant/multi-env packaging**: this repo is reused as a template per company (matches the existing "configurable template, customize per client" convention already in `Client/.env.example`'s "COMPANY BRANDING (Customize for each client)" section) — each company gets its own fork/clone, owning its own GCP project, its own Firebase project, and its own Supabase projects. There is no shared multi-tenant Terraform state across companies; onboarding a new company means re-running this plan's Terraform/CI steps against that company's own new projects, not adding rows to a shared table. Within one company's fork, three environments (`dev`, `staging`, `prod`) live inside that one GCP project, distinguished by env-prefixed resource names, and each environment gets its **own** Supabase project (never share one Postgres instance across environments) and its own pair of Firebase Hosting sites. A `company_slug` Terraform variable exists purely for resource labeling/cost-attribution — isolation between companies comes from separate GCP/Supabase/Firebase projects, not from this label.

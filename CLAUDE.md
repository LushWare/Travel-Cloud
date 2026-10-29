# Travel CRM

Monorepo with two React frontends (Client + Management), an API gateway, and 12 Express/Prisma microservices behind it. The `Server/` directory is the legacy Express/MongoDB monolith being migrated away from.

## Architecture

```
Client (React/Vite :5173) ──┐
Management (React/Vite :5174) ─┤─→ Gateway (:3000) ──→ microservices (:3001–:3012)
                                                                └── Server legacy (:5000, MongoDB)
```

| Service | Port | DB |
|---|---|---|
| Gateway (reverse proxy) | 3000 | — |
| auth-service | 3001 | Prisma/PostgreSQL |
| user-service | 3002 | Prisma/PostgreSQL |
| package-service | 3003 | Prisma/PostgreSQL |
| lead-service | 3004 | Prisma/PostgreSQL |
| booking-service | 3005 | Prisma/PostgreSQL |
| billing-service | 3006 | Prisma/PostgreSQL |
| career-service | 3007 | Prisma/PostgreSQL |
| notification-service | 3008 | pg (raw) |
| analytics-service | 3009 | pg (raw) |
| flight-service | 3010 | Prisma/PostgreSQL |
| assistant-service | 3011 | Prisma/PostgreSQL |
| voice-service | 3012 | Prisma/PostgreSQL |
| Server (legacy monolith) | 5000 | MongoDB/Mongoose |

Gateway handles JWT verification, rate limiting, CORS, and downstream CORS-stripping. Public routes: auth, GET packages/reviews/itineraries, contact forms, career applications, webhooks, site-wide assistant turn/events.

## Commands

Each service has its own `package.json` — there is no root workspace. Commands must be run from within the service directory.

### Frontends
- **Client:** `cd Client && npm run dev` (Vite default :5173)
- **Management:** `cd Management && npm run dev` (fixed :5174)

### Backend (every service)
- **Start dev:** `cd Services/<name> && npm run dev` (nodemon with hot reload)
- **Start prod:** `cd Services/<name> && npm start`

### Assistant intent-router dark launch
- **Validate the checked-in corpus without calling Gemini:** `cd Services/assistant-service && npm run eval:router -- --validate-only`. The default `evaluation/assistant-router.synthetic.v1.jsonl` corpus is for development and safety fixtures only; synthetic rows never count as production enablement evidence.
- **Run a live replay only with an approved, already-sanitized corpus:** `cd Services/assistant-service && npm run eval:router -- evaluation/<corpus>.jsonl`. Each row makes one Gemini request using `GEMINI_ROUTER_MODEL`, a 1.5-second timeout, and no retry. The live replay is currently blocked by the provider's 5 RPM quota and this timeout budget, so an incomplete replay cannot authorize rollout.
- **Keep all router gates disabled by default:** `ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED`, `ASSISTANT_ROUTER_SOCIAL_ENABLED`, and `ASSISTANT_ROUTER_OFF_TOPIC_ENABLED` must remain `false`. The social and off-topic classes are independent gates with a `0.95` confidence threshold; enable either only after at least 50 `real_sanitized` direct-response examples for that class pass every precision, confidence, data, and zero-leak safety gate.
- **Apply the assistant telemetry migration before deploying the service:** `cd Services/assistant-service && npm run db:migrate:deploy`.


### Database (Prisma services)
- **Generate client:** `cd Services/<name> && npm run db:generate`
- **Push schema (local/dev only):** `cd Services/<name> && npm run db:push`
- **Migrate — local dev:** `cd Services/<name> && npm run db:migrate` (`prisma migrate dev`, interactive, can reset drift — only ever run this against a local/disposable database, never the shared remote one)
- **Migrate — apply pending (safe, non-interactive):** `cd Services/<name> && npm run db:migrate:deploy`, or `node Services/migrate-all.mjs` to apply pending migrations across every service in one pass
- **Migrate status:** `cd Services/<name> && npm run db:migrate:status`
- **Studio:** `cd Services/<name> && npm run db:studio`

**Shared database, per-service schemas:** all 10 Prisma services (auth, user, package, lead, booking, billing, career, flight, assistant, voice) connect to the **same physical Postgres database** (one Supabase instance) — each just owns its own Postgres schema namespace (`crm_auth`, `crm_billing`, `crm_flights`, etc.) via `@@schema(...)`. Because of this, Prisma's `_prisma_migrations` bookkeeping table is shared: running `prisma migrate status` inside any one service will list every other service's migration names too — that's expected, not drift. `migrate deploy`/`migrate status` only ever act on the migrations declared in that service's own `prisma/migrations/` folder, so this is safe to ignore. Never run `prisma migrate dev` against this shared remote database — use `db:migrate:deploy` (or `migrate-all.mjs`) instead, which only ever applies pending migrations and never resets/drops anything.

### Voice agent (ElevenLabs Conversational AI)
- **Service:** `cd Services/voice-service && npm run dev` (:3012). Webhooks are proxied from the gateway at `/api/v1/webhooks/voice/*` — mounted **before** the catch-all `/webhooks` → notification-service route, which Express would otherwise match first.
- **Post-call signature verification is mandatory in every environment.** `ELEVENLABS_WEBHOOK_SECRET` must be set or the transcription webhook returns 503; there is no non-production bypass. Verification uses ElevenLabs' official `@elevenlabs/elevenlabs-js` verifier and `elevenlabs-signature`. Inbound initiation and tool webhooks each use their own configured shared secret.
- **Apply the voice schema before deploying:** `cd Services/voice-service && npm run db:migrate:deploy`.
- **The agent never commits.** It may read and prepare reversible draft state; applying pricing, sending quotations, booking flights/hotels, and any status transition past `NEW` are rep-only. Flight prices are never spoken at all — Duffel offers expire, so a spoken fare is stale on arrival. See `docs/designs/voice-sales-agent.md` for the full capability tiers.
- **The prompt source is `docs/voice-agent-prompt.md`.** Edit it there, then run `cd Services && node setup-voice-agent.mjs --apply` to sync the prompt, seven tools, and webhooks to ElevenLabs (omit `--apply` for a dry run). The script enforces the safety rules (never speak a price, never speak a flight fare, never look someone up). When it creates a workspace webhook, it prints the signing secret once; store it as `ELEVENLABS_WEBHOOK_SECRET` before relying on call delivery.
- **The published number is registered locally, not changed through the CRM UI.** Set `ELEVENLABS_PHONE_NUMBER`/`ELEVENLABS_AGENT_ID` in `voice-service/.env`, assign/import that number to the agent in ElevenLabs, then run `cd Services && node setup-voice-number.mjs` (`--show` lists registered numbers). Only one local number is active; changing it deactivates the old mapping without deleting call history.
- **A promised callback is not just a lead flag — the sales team is emailed.** Every voice-originated lead lands `needsRepFollowup: true` unless the agent's `needs_rep_followup` analysis field says otherwise (absence defaults to `true` — an extra email costs nothing, an unkept promise costs a customer). See `Services/voice-service/src/services/notify.service.js`.
- **One number can't flood the pipeline.** `VOICE_MAX_CALLS_PER_NUMBER_PER_DAY` (default 20) caps how many calls from one number this service acts on per rolling 24h. Over-cap calls still reach the agent and are recorded, but skip caller lookup and lead intake/rep notification.
- **The agent has seven live in-call tools** (`search_packages`, `get_trip_status`, `get_payment_status`, `attach_package`, `adjust_itinerary`, `preview_price`, `resend_document`), each mounted at `/api/v1/webhooks/voice/fn/<name>`. ElevenLabs supplies the provider-controlled `system__conversation_id` in the configured `x-elevenlabs-conversation-id` header; every handler resolves the acting lead from the call's database row, never from an LLM argument. A brand-new caller has no Lead row until post-call intake, so the lead-bound tools only work for a returning, already-matched caller.
  - **The exact payloads must be confirmed on the first real test call.** The integration follows ElevenLabs' documented initiation webhook, webhook-tool headers, transcription event, and audio API; monitor service logs and Management's AI tab before switching the published number.
  - **`preview_price` and `get_payment_status` never let a figure reach the LLM.** `preview_price`'s response omits the computed numbers entirely — a stronger guarantee than a prompt instruction, since even a prompt failure can't leak a number that was never sent back. `get_payment_status` only returns figures when `LeadPackageSelection.currentQuoteId` is set (a quote already reached the customer); this gate lives in lead-service, not the prompt.
  - **ElevenLabs provides `conversation_id` at initiation.** The initiation webhook creates the in-progress row before tools run; `post_call_transcription` updates that row. The migration renames provider-specific ID columns in place to preserve existing call history.
  - **Recordings are proxied through voice-service** from ElevenLabs' conversation-audio API. The API key is never sent to Management; playback uses the normal authenticated route.
  - **`VoiceCallEvent.sequence` is a 32-bit Postgres `Int`.** Derive it from a per-call count (`prisma.voiceCallEvent.count(...)`), never from `Date.now()` or any millisecond-epoch value — a `Date.now()`-derived sequence silently overflows Int32 and every insert fails. This exact bug shipped once and was caught only by checking the database directly after a live tool call, not by unit tests (the write was wrapped in a bare `.catch(() => {})`) — never swallow a Prisma write's rejection without at least logging it.
- **Resending a document reuses the exact send path a rep uses, gated on "already sent at least once.​"** All four types have a `POST /api/v1/billing/{quotations|invoices|receipts|vouchers}/:id/resend-voice` (internal-token gated, same convention as quotation's existing `/from-lead` route), each 409ing if the document was never sent — a voice call can never be the first channel something goes out through. Each sends to every channel the customer has on file (email **and** WhatsApp) rather than requiring a channel choice, since a voice caller has no UI to pick one. The agent does not choose a type: `GET /api/v1/billing/internal/leads/:leadId/latest-document` returns whichever type was most recently sent (no figures in that response), and `resend_document` resends that one. Note the real mount prefix is `/api/v1/billing/...` — billing-service mounts nothing at the shorter `/api/v1/quotations/...` path except a legacy `/invoices` alias.
  - **`Voucher` has no `sentAt` column** — it tracks `emailSent`/`whatsappSent` flags only, so its "already sent" gate and its recency sort both differ from the other three. Check the model before assuming a shared shape.
- **A voice-agent itinerary edit leaves a review card for the rep.** `LeadPackageSelection.pendingAiChange` holds `{before, after, summary, changedAt}` for the most recent AI edit; Management renders it in the lead's AI tab with Approve / Discard. **Approve** (`POST /leads/:id/packages/:selectionId/approve-ai-change`) only clears the flag — it deliberately does not send an updated quotation, because fusing the two would let one click push a new figure to a customer without the rep seeing the pricing screen. **Discard** is the existing refresh-from-package action, which clears the same flag by reverting the draft.
  - **The snapshot write happens AFTER the itinerary write commits, and must never fail the request.** `applyLeadSelectionItinerary` has already deleted and recreated every day by then; throwing afterwards tells the agent the edit did not happen when it did, and a retry applies it twice. This was observed for real — a stale Prisma client made the snapshot write throw, the agent saw a 500, and the retry produced 7 nights from a 3-night trip that should have become 5. The bookkeeping after that call is best-effort and logged, and the response carries `reviewCardSaved` so a failure is visible rather than silent.
- **`npm install` in `voice-service` needs `--legacy-peer-deps` on a clean tree** (npm 10.8.3 crashes resolving vitest's peer set); once `package-lock.json` exists a plain `npm install` works.

### Testing
- **Flight service:** `cd Services/flight-service && npm test` (vitest), `npm run test:watch`, `npm run test:coverage`, `npm run test:unit`, `npm run test:integration`
- **Voice service:** `cd Services/voice-service && npm test` (vitest)
- **Server (legacy):** `cd Server && npm test` (jest), `npm run test:watch`, `npm run lint`

### Seed / scripts
- `cd Services && node migrate-all.mjs` — apply pending migrations across all 10 Prisma services in one pass (safe to re-run; no-ops when nothing's pending)
- `cd Services && node seed.mjs` — seed PostgreSQL databases
- `cd Services && node seed-extended.mjs` — extended seed
- `cd Services && node update-passwords.mjs` — password migration
- `cd Server && npm run seed` — seed MongoDB
- `cd Services && node clean-test-data.mjs` / `node seed-demo.mjs` — remove test residue and populate the demo dataset (see below)

### Demo seed & test-data cleanup

Both scripts need `DATABASE_URL` and refuse to guess one (see `Services/database-url.mjs`):

```bash
cd Services
export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' lead-service/.env | cut -d= -f2- | tr -d '"')"

node clean-test-data.mjs            # report test residue (dry run)
node clean-test-data.mjs --commit   # delete it
node seed-demo.mjs                  # populate the demo dataset
node seed-demo.mjs --reset          # delete the demo rows, then reseed
node seed-demo.mjs --audit          # row counts only, writes nothing
```

- **`clean-test-data.mjs`** removes what the test suites leave in the shared Postgres: `[E2E-…]`/`e2e-…@travelcrm.test` rows from `Services/e2e-tests`, `SYNTH-…` rows from `e2e-tests/synthetic`, `E2E Test Lead <ts>` rows from `Management/e2e`, throwaway accounts (`planprobe@test.com`, `smoketest_…@example.com`, …), plus billing documents whose lead no longer exists. Assistant telemetry and OTPs carry no marker string, so they are matched by *absence* of the demo seed's id prefixes — `seed-demo.mjs`'s own transcripts survive the sweep. Dry run by default; all deletes run in one transaction.
- **`seed-demo.mjs`** builds a full book of business — 18 new packages with day-by-day itineraries (plus itineraries for the 7 original packages), ~150 leads across every lifecycle status with pricing, cost lines and copied itineraries, quotations, bookings, hotel and flight bookings, invoices with payments and vouchers, careers, and assistant transcripts. Existing users, packages and anything created through the UI are left alone; only rows carrying the script's own deterministic id prefixes are ever deleted, and `--reset` is scoped to those. The one exception is `Career`/`Vacancy`, which have no unique key: the older seeds left their own postings for the same roles, and those are superseded by natural key so no job is advertised twice.
- Adding a demo login: staff, customers and vendors created by this script share one password per role — `SuperAdmin@123`, `Admin@123`, `Sales@123`, `Vendor@123`, `Customer@123`.

## Code Conventions

- All services use **ES Modules** (`"type": "module"`), CommonJS `require()` is not valid
- Backend pattern: `src/index.js` entry → Express app → route files in `src/routes/`
- Gateway is the single entry point for all API traffic — never call backend services directly from the frontend
- All API routes are prefixed `/api/v1/`
- Use `zod` for input validation (already a root dependency)
- Environment files: `.env` per service, never commit real credentials
- **Git commits:** All commits must include this trailer at the end of the message, naming whichever model actually produced the commit — `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Exception: the first commit of a session is user-only, no `Co-Authored-By` line.

## Logging

- Use **structured JSON logging** via `pino` (already a root dependency) — never `console.log` in production code
- Every log line must include a **correlation ID** (`requestId`) propagated across service boundaries via the gateway's `x-request-id` header
- **Sanitize PII** before logging: redact passwords, tokens, full emails (keep `***@domain`), credit card numbers
- Log at the right level: `debug` for detailed tracing (off in prod), `info` for normal operations, `warn` for recoverable issues, `error` for failures needing attention
- Never log inside tight loops or log raw request bodies without sanitization

## Validation

- **Every API input must be validated** with a Zod schema before processing — no exceptions for internal endpoints
- Validate at the boundary: controllers/route handlers parse with Zod immediately, not deep in business logic
- Use **whitelist validation** (allow known-safe patterns), never blacklist
- File uploads must validate: size limit, allowed MIME types, extension whitelist
- Error messages must not leak internal state — return generic messages to clients, log details server-side

## Testing

- **Every new feature or bugfix requires tests.** Do not skip this.
- **Browser E2E (Playwright) is used, scoped to `Management/` only.** Client stays unit/integration-tested only — no Playwright there. Management E2E lives in `Management/e2e/`, runs via `npm run test:e2e` (`playwright test`), and covers RBAC/auth plus the core lead → quotation → invoice → payment → voucher workflow — keep it narrow (critical journeys, not exhaustive coverage); push edge cases down to unit/component tests.
- **Backend cross-service API E2E is used**, in `Services/e2e-tests/`, driving real HTTP calls through the Gateway (`:3000`) against a fully running local microservices stack — real JWTs from real `/auth/login` calls, no mocked Prisma/pg, no injected `x-user-*` headers. Run with `cd Services/e2e-tests && npm test`. Requires the full stack up (`cd Services && npm run dev`) and must never point at a production URL or database — see the safety guard in that suite's `global-setup.js`. Every record the suite creates must be tagged with a per-run marker and cleaned up in global teardown.
- Both suites are a deliberate, narrow exception to "unit tests + API integration tests" as the default — do not add Playwright to `Client/`, and weigh any new backend E2E flow against the test pyramid (E2E ≈ 10% of the suite; most coverage stays at the existing per-service integration-test layer).
- Test names describe **outcomes, not actions**: "returns err NOT_FOUND when user does not exist" not "test getUser"
- **Assert specific values**, not just types: `expect(result.value.email).toBe('alice@test.com')` not `expect(result).toBeDefined()`
- **One concept per test** — if a test name needs "and", split it
- Use the **AAA pattern**: Arrange (setup), Act (execute), Assert (verify)
- Cover edge cases systematically: empty/null inputs, boundary values, error paths, Unicode, duplicates
- When you find a bug, test related scenarios too — bugs cluster
- Prefer `mock<DepsType>()` for unit tests; use supertest for API integration tests against real service instances
- Flight service uses `vitest` — follow that pattern for other services. Server legacy uses `jest`.

## Security

- **Never hardcode secrets, API keys, or tokens** — use environment variables only
- All database queries use Prisma parameterized queries (safe from SQL injection by default)
- Gateway already handles: JWT verification, rate limiting (300 req/15min global, 10/15min auth), CORS, and `x-service-key` stripping. Do not bypass these.
- Authentication checks before any data access or mutation — verify the user owns or is authorized for the resource
- Tokens in httpOnly cookies, not localStorage
- Run `npm audit` before adding dependencies; don't introduce known vulnerabilities

## Gotchas

- Gateway strips downstream CORS headers — if you add CORS to a microservice, it will be removed at the gateway
- Gateway strips client-supplied `x-service-key` to prevent privilege escalation
- Client depends on `@management` alias pointing to `../Management/src` at build time
- No workspace-level package manager — each directory installs dependencies independently
- Port conflicts are common when running many services — check port availability before starting
- **`lead-service` crash-loops on a transient Supabase pooler blip and does not recover on its own.** Unlike `assistant-service` (which deliberately never eager-connects, specifically to avoid this), `lead-service`'s `src/index.js` calls `prisma.$connect()` at startup — if the pooler is unreachable for even an instant at that exact moment, the process exits and nodemon sits at "waiting for file changes" until something touches a file. This happened repeatedly during real testing, each time a false "the feature is broken" signal that was actually just this. If a request to `:3004` gets `ECONNREFUSED` or `fetch failed`, check `curl localhost:3004/health` before debugging anything else — `touch src/index.js` restarts it once the pooler is back.

## API Testing

When testing API endpoints, use `curl http://localhost:3000/api/v1/<path>` to hit the gateway. Do not call microservices directly on their ports unless debugging routing issues within the gateway. If you find yourself running the same curl patterns repeatedly, create a script at `Services/test-<scenario>.sh` instead of re-running raw curl commands each time.

## Parallel sessions & git worktrees (Worktrunk)

[Worktrunk](https://worktrunk.dev) (`wt`) manages one git worktree + branch per parallel session (`wt switch -c -x omp feat`). File edits are isolated — but *nothing else is*. Ports, the one shared Supabase Postgres instance, the running stack, the Gateway's auth rate limiter, and all gitignored machine-local state (`.env` files, `node_modules/`, `env_backup/`, `.claude/skills/deploy-travelcrm/`) are shared.

**Before running anything in a worktree, read `skill://parallel-worktrees`.** Non-negotiables it expands:

- A fresh worktree has **no `.env` files and no `node_modules`** (worktrees contain tracked files only). `.config/wt.toml` hooks `wt step copy-ignored` on `post-start` + `.worktreeinclude` to copy the 16 `.env` files; run it manually with `wt step copy-ignored` if the hook hasn't. Install deps per package (`node_modules` is deliberately not copied).
- **One backend stack.** Do not start a second `cd Services && npm run dev` — ports are fixed (3000, 3001–3011, 5173, 5174, 5000) and collide. The stack runs the **primary worktree's** code, so a worktree edit is *not* live on it. Frontends are the exception: worktrunk's `hash_port` gives each worktree its own (`--port {{ branch | hash_port }}`).
- **The database is shared and live.** Never `prisma migrate dev` / `db:push` / seed scripts from a parallel session; never apply two services' migrations concurrently. `migrate deploy` only when the migrations are yours.
- **E2E is exclusive.** `Services/e2e-tests` and `Management` Playwright both need the shared stack + DB and the Gateway's 10-req/15-min login limiter — never run them concurrently from two sessions.
- **Stage explicitly** (`wt step commit --stage=tracked`, or `git add <paths>`) so untracked local artifacts don't get committed, and install the packages you touch before committing so the `pre-commit` lint-staged hook finds its per-package eslint.
- **Tear down long servers** with `wt step tether`, or stop them before `wt remove`, so `wt remove` doesn't leave an orphaned process.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
- Parallel sessions / Worktrunk / git worktrees / multiple agents at once → invoke /parallel-worktrees

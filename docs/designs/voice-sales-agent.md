# Design: Voice Sales Agent — Inbound Call Handling & Rep Workflow Automation

> **Provider update:** This design was drafted around Retell. The implementation now uses ElevenLabs Conversational AI. Provider-specific references below describe the original proposal; use `docs/voice-agent-prompt.md`, `Services/setup-voice-agent.mjs`, and `Services/voice-service/` for the deployed ElevenLabs contracts.

Branch: microservices
Repo: LushWare-Org/Travel-CRM
Status: DRAFT — pending user approval
Mode: Startup (intrapreneurship)

## Problem Statement

The website publishes a phone number. Today every call to it either reaches a human sales rep or is lost. Calls outside working hours, calls while every rep is busy, and repeat calls from existing customers asking routine questions ("is my booking confirmed?", "can you resend the quotation?") all consume rep time or evaporate entirely.

The ask is a Retell AI voice agent that answers that number 24/7 and performs the sales rep's workflow — qualifying new enquiries, answering questions about existing bookings, and **preparing** package/itinerary/pricing changes a rep later approves. Explicitly **not** a receptionist that transfers calls: the user rejected call transfer as a primary path, on the grounds that reps are not reliably available to take one. The agent's fallback when it cannot handle something is *"one of our team members will get back to you as soon as possible"* — a promise backed by a flagged lead in Management, not a dropped call.

The second, equal half of the ask is **evidence**: every call the agent handles must be stored individually — full script, date, time, duration, recording, and what the agent did — so a rep can audit anything the AI touched.

## Demand Evidence

Not measured. This is an inference from the codebase and the user's description, not a hard number, and it is flagged as an assignment below.

What the codebase does confirm: `LeadSource` already contains `phone_call` and `LeadPlatform` already contains `Phone_Call`, meaning phone-originated leads are a real, recognised category that a human currently keys in by hand. `LeadCommunicationLog.type` already includes `call` as an enum value, with no service code that writes it automatically — every call log today is manual rep data entry, or absent.

**Assignment before/while building:** for two weeks, count (a) inbound calls to the published number, (b) how many are answered, (c) how many are outside working hours, and (d) time a rep spends per call on routine status/resend questions. Without (b) and (c), there is no baseline to prove containment, and the cost-per-qualified-lead metric below is unfalsifiable.

## Status Quo

1. A prospect calls the published number. A rep answers, or nobody does.
2. If answered, the rep manually creates the Lead in Management (`POST /api/v1/leads`, `admin`/`salesRep`-only), typing the destination, dates, traveller count and budget the caller just said aloud.
3. Follow-up work — attaching packages (`createPackageSelection`), drafting the itinerary (`updateSelectionItinerary`), pricing (`calculateSelectionPricing` → `applySelectionPricing`), quoting (`quotePackageSelection`) — is entirely manual.
4. An existing customer calling about a change ("add two days", "swap the hotel") reaches a rep who edits the lead by hand and re-quotes.
5. Requests to resend a document are manual: rep opens the lead, downloads the PDF (`GET /quotations/:id/pdf` et al.), and sends it via `POST /quotations/:id/send`.
6. Nothing about a call is retained except whatever the rep chooses to type into a remark.

## Target User & Narrowest Wedge

Two users, in priority order:

- **The prospect who calls and gets no answer.** Narrowest wedge: every inbound call produces a verifiable Lead with a full transcript, whether or not a human was available.
- **The sales rep who re-keys and re-types.** Narrowest wedge: the rep stops being a typist and becomes a checker — opening a lead where the packages, itinerary and calculated price are already prepared, and approving them.

## Constraints

- **`LeadIntakeChannel` is `z.enum(['chatbot'])`** ([`Services/shared/contracts/src/leadIntake.js:7`](../../Services/shared/contracts/src/leadIntake.js)), documented in-file as extensible: *"a future WhatsApp bot or contact-form widget would call the same endpoint with a different `channel`."* Voice is precisely that second caller. Reusing `POST /leads/internal/intake` is not opportunism — it is the documented intent of that contract.

- **Idempotency already exists.** `Lead` carries `@@unique([intakeChannel, intakeSessionId])`. Retell delivers a `call_id` per call and retries webhooks on non-2xx. Setting `sessionId = call_id` makes duplicate webhook delivery a safe no-op through machinery already built and tested.

- **`LeadIntakeTranscriptMessage` caps the transcript at `.min(1).max(40)` messages of ≤2000 chars.** A six-minute phone call routinely exceeds 40 turns. This design therefore does **not** reuse the chatbot's one-`LeadCommunicationLog`-row-per-message model. See Implementation shape #6.

- **`Lead.phone` is stored in two incompatible formats today.** This is a live defect, not a hypothetical:
  - Rep-created leads: `NewLeadDialog.tsx` uses `react-phone-number-input`, which emits E.164 **with** a leading `+`; [`lead.controller.js:88`](../../Services/lead-service/src/controllers/lead.controller.js) stores `body.phone` **raw**. Result: `+94771234567`.
  - Website/chatbot/Facebook leads: normalised via `String(phone).replace(/\D/g, '')`. Result: `94771234567`.

  Any caller-identification lookup keyed on one format silently misses every lead stored in the other. **This already affects production**: `logCommunication` ([`lead.controller.js:628`](../../Services/lead-service/src/controllers/lead.controller.js)) resolves inbound WhatsApp messages with `where: { OR: [{ phone: sanitizedPhone }, { whatsapp: sanitizedPhone }] }` against digits-only input — so WhatsApp messages from customers whose leads a rep created are already failing to attach. Fixing this is a prerequisite for voice, and a bug fix on its own merits.

- **The gateway already exposes a public webhook namespace.** `[/^\/api\/v1\/webhooks\//, 'ALL']` ([`gateway/src/index.js:107`](../../Services/gateway/src/index.js)) is on the public allowlist, currently proxied wholesale to `notification-service` (line 266). Voice webhooks need a sibling mount, and the mount order matters — the more specific path must be registered first.

- **A webhook-signature verification pattern already exists** — `verifyWebhookSignature(signature, req.rawBody, appSecret)` in `notification-service`. Retell's `x-retell-signature` follows the same HMAC-over-raw-body shape. Note the existing Facebook handler *skips* verification outside production; this design does not copy that leniency (see Security).

- **Pricing is already split into a safe half and a committing half.** `calculateSelectionPricing` takes lines/days from the request body and returns computed numbers, persisting nothing. `applySelectionPricing` writes `LeadPricing`/`LeadCostLine` rows. This pre-existing seam is the exact boundary between what the agent may do and what requires a human. The design does not invent this boundary; it adopts one the codebase already drew.

- **`LeadPackageSelection` rows are lazily materialized.** Per the schema comment: *"a pristine selection (no itineraryDays/pricing rows) is derived on read from the live package blueprint; persisted rows only appear once the rep edits the selection or a quotation is sent."* `refreshPackageSelection` reverts a selection to pristine. Agent-attached packages are therefore cheap and fully reversible — a wrong attachment costs a rep one click, not a data-repair job.

- **The `REVISION` lifecycle status already models "customer wants changes."** `ALLOWED_TRANSITIONS` gives `QUOTED → REVISION` and `REVISION → DRAFTING | QUOTED | APPROVED | CLOSED_LOST`. Change requests need no new status.

- **Document delivery is already built.** `notification-service` exposes `POST /internal/email` (nodemailer, attachment support) and `sendWhatsappTemplateMessage({ headerDocument })`, which attaches a Cloudinary-hosted PDF to an approved WhatsApp template. `billing-service` exposes `/:id/pdf` and `/:id/send` for quotation, invoice, payment receipt, credit note and voucher. Re-sending a document is wiring, not new capability.

- **The agent must never author a price, a policy statement, or a confirmed booking.** This holds architecturally in `wizard-turn` today (fixed tool vocabulary, server executes deterministic logic) and must hold identically here. The agent's tool vocabulary is a closed set; the Retell LLM chooses among server-defined tools and never composes a write itself.

- **Retell's function-call latency budget is sub-second.** Anything the agent waits on mid-call must return in under ~800ms or the caller hears dead air. This rules out chained gateway → voice-service → lead-service → package-service round trips on the hot path.

## Premises

1. **The agent's fallback is a promise plus a flag, never a transfer.** Per the user's explicit direction, warm transfer is dropped from v1. When the agent cannot handle something it says *"one of our team members will get back to you as soon as possible"* and marks the lead `needs_rep_followup`. This removes online-rep checking, business-hours routing and call-transfer plumbing from scope — a material simplification, chosen by the user for a real reason (reps are not reliably free to take a transfer).

2. **The agent prepares; a human commits.** Every capability is classified into exactly one of three tiers — ANSWER (read, speak), PREPARE (write reversible draft state), COMMIT (irreversible, customer-visible, or monetary). The agent operates in ANSWER and PREPARE. COMMIT is human-only, without exception. This is the same "bot proposes, agent verifies" premise the chatbot intake design already established, extended to write operations.

3. **Financial figures are read-only, on-request-only, and never computed aloud.** Refined from the user's clarification. Two rules, both required:
   - **Only on request.** The agent never volunteers a figure. If the caller does not ask about money, money is never mentioned.
   - **Only persisted figures.** The agent may read back a number that already exists on a document previously sent to that customer (invoice total, amount paid, balance due, deposit). It may never compute a new one. "How much for two extra days?" is answered with *"I've added those days — our specialist will send you the updated price shortly,"* never with a number.

   The reasoning: a persisted figure is already in the customer's hands, so speaking it creates no new commitment. A computed figure spoken aloud becomes a promise the business must honour, and `calculateSelectionPricing` involves margin and deposit logic whose output is a commercial decision, not a fact.

4. **Every call is its own record, never merged.** Call 1, Call 2 and Call 3 from the same customer are three `VoiceCall` rows on one lead, each with its own timestamp, duration, transcript, recording and action log. Nothing is overwritten or summarised away. This is the evidence requirement, and it is a hard schema constraint, not a UI preference.

5. **Caller identity comes from the carrier, never from the conversation.** `from_number` is supplied by the telephony network; a caller's spoken claims are not. The agent is given no lookup-by-name, lookup-by-email or lookup-by-id tool. This is the direct application of the IDOR lesson already documented in `leadIntake.controller.js` — *"`contact` is fully attacker-controlled... an anonymous caller could type a stranger's email into a fresh wizard session and merge into that stranger's Lead"* — to a channel where dialling is free and anonymous.

6. **Anything the agent writes is visible to a rep before it is visible to a customer.** No agent-prepared quotation, invoice, itinerary or booking reaches the customer without a human clicking approve. The one exception is re-sending a document that was *already* sent to that same customer previously (Premise 3's logic: no new information leaves the business).

## Approaches Considered

### Approach A: Retell-only, no CRM writes
Agent answers, transcripts land in Retell's dashboard, a rep reads them and keys in leads by hand.
- **For:** near-zero build cost; can be live in days.
- **Against:** solves the "unanswered call" problem and nothing else. Rep workload is unchanged or worse (now they read transcripts *and* type). Fails the stated goal of automating rep workflow.

### Approach B: Voice module inside `assistant-service`
Add `src/voice/` to the existing assistant-service.
- **For:** no twelfth service; reuses app scaffolding, logger, error handler.
- **Against:** conflates two genuinely different concerns. `assistant-service` is deliberately stateless — its schema comment states *"AssistantEvent is a telemetry sink only... the turn protocol itself is stateless."* Voice is the opposite: long-lived stateful calls, recordings and transcripts carrying PII with retention obligations, an unauthenticated public webhook surface with a vendor signature scheme, and a hard sub-second latency budget the site-wide assistant does not share. Mixing them makes both harder to reason about.

### Approach C: Dedicated `voice-service` (chosen)
New service on `:3012`, own `crm_voice` schema, orchestrating calls to lead/package/billing/notification services.
- **For:** clean isolation of the telephony concern, its PII retention rules, and its public attack surface. Independent scaling and rate limiting — a call spike must not degrade the site assistant. Matches the repo's established one-service-per-concern pattern.
- **Against:** a twelfth service; duplicates app/logger/error scaffolding; one more thing to deploy and monitor.

## Recommended Approach

**Approach C**, phased so that each phase is independently shippable and independently abandonable.

The staging discipline matters more than the architecture here. Phases 1–3 exist specifically to answer a question that cannot be answered by design work: *do callers' actual questions match what we assumed?* Building Phase 5's write capability before reading two weeks of real transcripts risks automating answers to questions nobody asks.

### Capability tiers

The complete, closed vocabulary of what the agent may do:

| Tier | Capability | Backing endpoint | Risk |
|---|---|---|---|
| **ANSWER** | Describe packages, destinations, inclusions | `GET /packages/search/query` (already public) | None |
| **ANSWER** | Booking/flight/hotel **status** ("confirmed", "pending") | booking-service read | None |
| **ANSWER** | Financial figures — **on request only**, persisted only | billing-service read | Low (Premise 3) |
| **PREPARE** | Create/merge lead, set slots, notes, follow-up date | `POST /leads/internal/intake` | Reversible |
| **PREPARE** | Attach/detach package to lead | `createPackageSelection` / `deletePackageSelection` | Reversible (lazily materialized) |
| **PREPARE** | Edit draft itinerary — add/remove days, swap hotel, add destination | `PUT /:id/packages/:selectionId/itinerary` | Reversible (`refreshPackageSelection`) |
| **PREPARE** | Compute pricing preview | `calculateSelectionPricing` | **Persists nothing** |
| **PREPARE** | Change/add a hotel on a draft day | `PUT /:id/packages/:selectionId/itinerary` (`accommodation` Json) | Reversible |
| **PREPARE** | Record a flight *preference* (not a search) | note on lead + `needsRepFollowup` | Reversible |
| **PREPARE** | Move `QUOTED → REVISION` on a change request | `validateTransition` | Reversible |
| **PREPARE** | Re-send an **already-sent** document to email + WhatsApp | `POST /internal/email`, `sendWhatsappTemplateMessage` | Low (Premise 6 exception) |
| **COMMIT** | Apply pricing | `applySelectionPricing` | **Rep only** |
| **COMMIT** | Send a new quotation | `quotePackageSelection` | **Rep only** |
| **COMMIT** | Book or cancel a flight | `POST /flights/book`, `/book-for-lead`, `/bookings/:id/cancel` | **Rep only — creates a real airline PNR** |
| **COMMIT** | Confirm a hotel booking | booking-service write | **Rep only** |
| **COMMIT** | Any status transition past `NEW`, invoice, payment, voucher | — | **Rep only** |
| **COMMIT** | Assign or reassign a lead | `assignLead` | **Rep only** |

Every PREPARE capability is reachable only through a server-defined Retell custom function whose handler re-validates authorisation independently. The agent's ability to name a capability is not authorisation to perform it.

### Flights and hotels are not the same risk — treat them separately

An earlier draft of this document lumped both into "shortlist options onto the lead." That was wrong, and the codebase says why.

**Hotels are draft data.** There is no hotel model in `crm_leads` and no live hotel GDS in this system. A hotel lives as `accommodation Json` on `LeadItineraryDay` ([schema.prisma:494](../../Services/lead-service/prisma/schema.prisma)). "Change my hotel" and "add a hotel" are therefore ordinary itinerary-draft edits — the same operation as adding or removing a day, with the same reversibility via `refreshPackageSelection`. **Hotels sit in PREPARE with no special handling.**

**Flights are live airline inventory, and they are the highest-risk surface in this system.** `flight-service` talks to Duffel (with a Travelport client alongside), and three facts from that integration constrain the design:

1. **Flight prices expire.** `duffel.client.js` documents `priceOffer` as *"Price revalidation fetches the latest offer state (price may have changed since search)"* and returns an explicit `priceChanged` flag. The `search → price → book` sequence exists precisely because an offer can move between steps. **A rep must re-price before booking. An agent therefore cannot speak a flight price at all** — not because of the general pricing rule in Premise 3, but because the number is provably stale the moment it is spoken. This is a stronger prohibition than the package-pricing one, and it holds even if the caller asks directly.

2. **Booking creates a real PNR.** `createOrder` issues an order against the airline. It costs money, it may carry a ticketing deadline, and cancelling it may incur a fee. There is no draft state and no undo. **COMMIT tier, rep only, no exception, and the agent is given no tool that reaches it.**

3. **A live flight search cannot run during a call.** A Duffel `offer_requests` round trip takes seconds, against Retell's sub-second function budget (Constraints). Even if it were safe, it would produce dead air. **The agent must not call `POST /flights/search` mid-call.**

The resulting flight flow:

```
Caller: "Can you change my flight to the morning one?"
   │
   ▼
Agent records the PREFERENCE only:
   "morning departure, 19 Dec, CMB→MLE"     ← a note, not a search
   Sets needsRepFollowup = true
   │
   ▼
Agent: "I've noted that. Our specialist will check the
        options and call you back with the details."
   │
   ▼
Rep opens the lead → runs the real search → re-prices → books
```

For an **already-booked** flight the agent stays in ANSWER tier: it may confirm status and PNR from `FlightBooking` ("your flight is confirmed, reference ABC123"), because that is a persisted fact already in the customer's hands. It may not read the fare, and it may not change or cancel anything.

**Optional fast-follow, explicitly not in v1:** an async post-call flight search — the agent captures the preference, and a background job runs `POST /flights/search` after the call ends and attaches a shortlist to the lead for the rep. This sidesteps both the latency budget and the offer-expiry problem, since the rep re-prices anyway. Deferred because it adds a job runner this design does not otherwise need, and Phase 3's transcripts should first confirm callers actually ask for flight changes often enough to justify it.

### Implementation shape

**Shared contract (`Services/shared/contracts/`):**

1. `leadIntake.js`: `LeadIntakeChannel` becomes `z.enum(['chatbot', 'voice'])`. No other change to the intake contract — voice sends a compacted transcript within the existing 40-message cap (see #6).
2. New `voiceAgent.js`: Zod schemas for every custom-function request/response pair, consumed by `voice-service` as server and mirrored in the Retell function definitions. One source of truth, same pattern as `itineraryChat.js` and `leadIntake.js`.

**`lead-service` (schema + normalisation):**

3. Migration, additive: `LeadSource` gains `voice_agent`; `LeadPlatform` gains `Voice_Agent`. Deliberately distinct from the existing `phone_call`/`Phone_Call`, which mean *a human answered a phone* — collapsing them would make containment-rate analytics unmeasurable.
4. Migration: `Lead` gains `phoneNormalized String?` and `whatsappNormalized String?`, each `@@index`ed. Backfill both from existing rows with digits-only normalisation. Every write path that touches `phone`/`whatsapp` — `createLead`, `updateLead`, `createWebsiteContactLead`, `handleFacebookLeadEvent`, `intakeLead` — populates them. **This is a bug fix with independent value**: it repairs the existing WhatsApp-message-to-lead attachment failure in `logCommunication` described in Constraints, and that repair should ship whether or not the voice agent does.
5. `Lead` gains `aiHandled Boolean @default(false)` and `needsRepFollowup Boolean @default(false)`, both `@@index`ed. These drive the Management badges (#12) and the rep's work queue. They are separate from `lifecycleStatus` because they are orthogonal — a lead can be `REVISION` *and* AI-touched *and* awaiting rep review, and overloading the lifecycle enum to express that would corrupt the state machine.
6. **Transcript storage differs from the chatbot's model, deliberately.** The chatbot writes one `LeadCommunicationLog` row per message. For voice this would mean 200+ rows per call and would breach the 40-message contract cap. Instead: **one `LeadCommunicationLog` row per call**, `type: 'call'`, `externalMessageId = retell_call_id`, `notes` = the AI summary, `date` = call start. The existing `@@unique([leadId, externalMessageId])` then makes webhook retries idempotent at this layer too. The full turn-by-turn transcript lives in `VoiceCall.transcript` in `crm_voice` and is joined by `leadId` for display.
7. The existing repeat-call rule from chatbot intake holds unchanged: once a lead leaves `PENDING_VERIFICATION`, intake appends communication logs only and never mutates scalar fields, so a call cannot bypass `validateTravelerUpdate`/`validateTravelDatesUpdate`/pricing gatekeepers on a lead a rep is actively working. Agent edits to a claimed lead go through the explicit PREPARE endpoints, which run those validators, not through intake.

**`voice-service` (new, `:3012`, schema `crm_voice`):**

8. Three models:
   - `VoiceNumber` — `{ e164, label, retellAgentId, isActive, language, disclosureText, businessHours, createdAt }`. **This is the answer to "the number can change later."** The inbound-call webhook resolves the dialled number to this row and returns its agent config. Swapping the published number, or adding a second country's number, is an admin form edit — never a deploy.
   - `VoiceCall` — `{ retellCallId @unique, numberId, direction, fromNumber, toNumber, startedAt, endedAt, durationSec, disposition, transcript Json, recordingUrl, summary, sentiment, leadId?, matchOutcome, needsRepFollowup, costCents }`. One row per call, never merged (Premise 4).
   - `VoiceCallEvent` — `{ voiceCallId, sequence, functionName, args Json, result Json, latencyMs, succeeded, createdAt }`. Append-only audit of every capability the agent invoked. This is what answers *"why did the bot say that?"* and *"what exactly did it change?"*, and it is what the Management diff view renders.

9. Routes, all under the gateway's public `/api/v1/webhooks/voice/`:
   - `POST /inbound` — Retell's pre-answer webhook. Resolves `VoiceNumber` by dialled number, runs caller identification (#10), creates the `VoiceCall` row, returns dynamic variables. Must respond fast; this is on the call-setup path.
   - `POST /fn/:name` — every mid-call custom function, dispatched by name against the closed capability vocabulary. Rejects unknown names.
   - `POST /post-call` — Retell's end-of-call webhook. Persists transcript/recording/summary, then forwards to `POST /leads/internal/intake`.

10. **Caller identification** runs in the `/inbound` handler, before the caller hears anything:
    ```
    digits = normalize(from_number)
    matches = Lead WHERE (phoneNormalized = digits OR whatsappNormalized = digits)
                    AND lifecycleStatus NOT IN ('CLOSED_LOST','CANCELLED')
              ORDER BY updatedAt DESC
    ```
    - **0 matches** → treat as new. Generic greeting, qualify from scratch.
    - **1 match** → known caller. Return a *minimal* variable set: `caller_name` (first name only), `has_open_lead`, `status_class` (a coarse bucket such as `quote_sent`, not the raw `lifecycleStatus`), `destination`, `assigned_rep_name`. Never the lead id, never a figure, never dates, never email.
    - **≥2 matches** → `matchOutcome: 'ambiguous'`. Treat as **unknown** — greet generically and never ask *"are you Nimal?"*, which would leak a name to whoever dialled. Flag in Management for manual merge. Shared family and office lines make this a real case, not a corner one.

    Caller ID is spoofable. Identification is therefore sufficient for personalisation and for reading back that customer's own already-sent figures, and is **not** sufficient for anything in the COMMIT tier — which the agent cannot reach regardless.

11. **The `leadId` is never in a function payload.** Every `/fn/:name` handler resolves the lead server-side from `call_id → VoiceCall.leadId`. Function arguments carry only qualification slots and change descriptions. A Retell custom-function endpoint is an LLM-driven API whose inputs originate as arbitrary caller speech on a free, anonymous channel — treating any identifier in that payload as trustworthy would reproduce the IDOR the chatbot intake design already fixed.

**`gateway`:**

12. Mount `${V1}/webhooks/voice` → `SERVICES.voice` **before** the existing `${V1}/webhooks` → `SERVICES.notification` line, since Express matches mounts in registration order. Preserve `req.rawBody` on this path for signature verification. The existing `[/^\/api\/v1\/webhooks\//, 'ALL']` allowlist entry already covers it publicly — no allowlist change needed, which is worth stating explicitly so a reviewer does not "helpfully" add one.

**`Management`:**

13. **Lead table badges**, driven by the columns in #5, rendered in `LeadTable.tsx`:
    - ✨ **AI** — `aiHandled` true. The lead was created *or modified* by the voice agent. Shown on every AI-touched row, including one where the AI only adjusted an itinerary on a later call.
    - ⚠️ **Needs check** — `needsRepFollowup` true. The agent could not answer something, or made changes awaiting approval. **This is the rep's work queue.**
    - ✓ **AI verified** — a rep has reviewed and confirmed.

14. **Lead table filters.** `FilterDialog.tsx` gains an "AI" filter group with three checkboxes — *AI handled*, *Needs check*, *AI verified* — and `LeadFilters.tsx` gains a one-click ⚠️ **Needs check** quick-filter chip beside the existing status tabs, since that is the filter a rep uses every day. Both must filter **server-side**: `getLeads` needs new `aiHandled`/`needsRepFollowup` query params. Management's existing platform filter is client-side over already-loaded rows, which will not scale once AI-touched leads are the majority.

15. **Two top-level tabs inside the view-details popup.** The popup is `EditLeadDialog.tsx`; its header is `FormDialogHeader` at line 412. Add a tab strip **in that header, directly under the title**, switching the whole dialog body between two views:

    | Tab | Content |
    |---|---|
    | **Overview** | Everything the dialog shows today — unchanged |
    | **AI** ✨ | Call history and everything the AI did |

    Requirements:
    - The tab strip is **top-level**. `EditLeadDialog` already has *package* tabs further down the body (line 640) — these two must sit above them in the header so the two levels are never visually confused.
    - Both tabs live in the **same popup**. Switching tabs must not close, reopen or remount the dialog, and must not lose unsaved Overview edits.
    - Default tab is **Overview**. Exception: open directly on **AI** when the row was clicked from the ⚠️ Needs check filter — that rep is going there anyway.
    - The **AI** tab shows a count badge of calls, and only appears when the lead has at least one `VoiceCall`.

16. **AI tab content**, modelled on the existing `WhatsAppHistoryDialog.tsx`. Reverse-chronological list of `VoiceCall` rows — never merged (Premise 4) — each showing:
    - Date, time, duration, disposition
    - AI summary
    - Recording player
    - Full transcript, expandable
    - The `VoiceCallEvent` list in plain language: *"AI attached Maldives 5N package — 10 Sep 2026, 9:04 AM"*
17. **Change-approval diff view**, living inside the **AI** tab. When the agent has edited a draft itinerary, the rep sees old versus new side by side with one **Approve & Re-quote** action and one **Discard** action. Discard maps to `refreshPackageSelection`, which the schema already provides for reverting a selection to pristine.
18. Admin → Settings → **Voice**: `VoiceNumber` CRUD (number ↔ agent ↔ language ↔ disclosure text ↔ hours), plus a global kill switch that disables the agent without a deploy.
19. `PENDING_VERIFICATION` handling already exists from the chatbot work — no new lifecycle plumbing needed in `StatusChangeDialog`/`LeadStatusBadge`/`LeadFilters`.

**Analytics:**

20. Containment rate, qualified-lead rate, needs-followup rate, cost per qualified lead, and the metric that actually decides this project's fate: **voice-originated lead → `CONFIRMED` conversion, compared against the web-form baseline.**

## Security

1. **Verify `x-retell-signature` against `req.rawBody` on every webhook, in every environment.** Reuse the HMAC shape from `notification-service`'s `verifyWebhookSignature`. Do **not** copy that module's `NODE_ENV !== 'production'` bypass — a permanently-open unauthenticated write endpoint in staging is a real target, and the bypass exists there for legacy reasons, not good ones.
2. **Bind every function call to a live call.** `call_id` must exist in `VoiceCall` and be in-progress. Reject function calls for ended calls — this blocks replay of a captured payload after hang-up.
3. **Never trust an identifier from the agent** (#11 above).
4. **Rate limit per `from_number`**, not only per IP. The gateway's global 300/15min is IP-scoped and will not stop one caller looping the agent to burn Retell minutes. A per-number cap and a per-number daily call cap are both required.
5. **Zod-validate every function payload** at the route handler, per repo convention — whitelist enum values for anything that reaches a state transition.
6. **PII discipline in logs**, per repo logging rules: phone numbers as `***1234`, never a raw transcript at `info`, never a recording URL in a log line.
7. **Recordings are never publicly addressable.** Proxy them through Management auth. Apply a retention TTL — 90 days proposed — with automatic deletion, and document it.
8. **Recording disclosure is per-`VoiceNumber`**, because consent law varies by jurisdiction and the design anticipates multiple country numbers.
9. **`INTERNAL_EVENTS_TOKEN`** for the `voice-service` → `lead-service` hop, matching the existing convention. `voice-service`'s outbound calls carry no user JWT and must never accept an `x-service-key` from the request.

## Phasing

| Phase | Scope | Ship gate |
|---|---|---|
| **0 — Spike** (2–3 days) | Retell account, number, agent prompt. Post-call webhook logs to a table. **Zero CRM writes.** | 20 real calls transcribed. **Measure ASR accuracy on your callers' accents and on destination/hotel names.** This is the single most common failure mode for travel voice agents, it is cheap to test, and a bad result here invalidates every later phase. Do not skip. |
| **1 — Capture** (~2 wks) | `voice-service`, `VoiceNumber`, `phoneNormalized` migration + backfill, inbound/post-call webhooks, intake integration, `VoiceCall` storage, AI Calls tab, ✨AI badge | ≥80% of qualified calls produce a correctly-slotted lead; a rep confirms the summary is usable without listening to the recording |
| **2 — Identify** (~1 wk) | Caller identification, repeat calls stacking on one lead, ambiguous-match flagging | A returning caller is greeted by name; three calls appear as three distinct records on one lead |
| **3 — Answer** (~2 wks) | ANSWER tier: package details, booking/flight/hotel status, on-request persisted financial figures | Zero computed figures spoken across a full week of transcript review |
| **4 — Resend** (~3 days) | Re-send already-sent PDFs to email **and** WhatsApp | Both channels deliver; every send is logged on the lead |
| **5 — Prepare** (~3 wks) | PREPARE tier: attach packages, edit draft itinerary (add/remove days, **swap/add hotel**, add destination, change package), `calculateSelectionPricing`, `QUOTED → REVISION`, approval diff view. Flight *preferences* captured as notes. | Rep approval takes under 2 minutes; every agent edit is reversible via `refreshPackageSelection`; zero flight prices spoken |
| **6 — Async flight shortlist** (~2 wks, optional) | Post-call background Duffel search attaching options to the lead. **Only if Phase 3 transcripts show callers ask for flight changes often.** | Rep books from the shortlist after re-pricing |

Phase 4 is nearly free — the send endpoints already exist. Phase 5 is where rep workload actually drops, and it is deliberately last among the write phases because it depends on Phase 3 proving the agent understands callers correctly.

## Open Questions

- **Telephony — OPEN.** Buy the number from Retell, or import the existing published number via Twilio/SIP? Importing preserves the number customers already know but adds a provider hop; buying is faster to stand up. The user will supply the number later. This blocks Phase 0 only — every schema, contract and UI decision in this document is independent of it, because the number is a `VoiceNumber` row, not a constant.
- **Languages — RESOLVED: English only.** Agent language, disclosure text and the Phase 0 ASR accuracy test are all English. `VoiceNumber.language` still exists as a column so a second language is a row, not a migration, but no multi-language work is in scope. Note the Phase 0 accuracy test still matters as much: the risk is English spoken in the accents your callers actually have, plus destination and hotel proper nouns, not language selection.
- **Recording consent:** which jurisdictions do callers originate from? Determines whether the disclosure line is a legal requirement or a courtesy, per number.
- **Expected call volume:** sizes the Retell concurrency plan and makes the cost model real. At roughly $0.07–0.10/min all-in plus telephony, 500 calls/month at 4 minutes is ~$150–200/month — trivial if containment is good, pure waste if it is not.
- **What does the agent do when `needsRepFollowup` is set — does anyone get notified?** `Lead.notifNewLead` exists as a schema column with no service code reading it; it is dead, not reusable. Team-wide notification for an unassigned flagged lead is net-new plumbing this design does not scope. Flagged as a fast-follow, not a blocker — but "the rep checks the filter" is the honest v1 answer and should be stated as such to the client.
- **Does `status_class` need to distinguish more than three or four buckets?** Starting coarse is safer; the transcripts from Phase 3 will show whether callers need more granularity.

## Success Criteria

- Every inbound call produces a `VoiceCall` row with transcript, recording and duration — zero calls unrecorded, verifiable by reconciling Retell's call count against `VoiceCall` row count.
- A call from an unknown number produces a `PENDING_VERIFICATION` lead with no rep typing, tagged `source: voice_agent`.
- A returning caller's third call appears as a third distinct `VoiceCall` on the *same* lead — not a fourth duplicate lead, and not an overwrite of call two.
- No voice-originated lead is ever auto-assigned, auto-priced, auto-quoted or auto-booked. Verifiable as a test asserting no COMMIT-tier endpoint is reachable from `voice-service`'s outbound client — specifically that `POST /flights/book`, `/flights/book-for-lead` and `/flights/bookings/:id/cancel` appear nowhere in its call graph.
- **No flight price is ever spoken, and no flight search runs during a call.** Verifiable from `VoiceCallEvent`: no event names a flight-search or flight-price function, and no agent turn following a flight question contains a currency figure.
- No computed figure is ever spoken. Verifiable by transcript review against `VoiceCallEvent` — any call where `calculateSelectionPricing` ran and a number appears in the following agent turn is a defect.
- `POST /leads/internal/intake` remains unreachable from the public internet; `/api/v1/webhooks/voice/*` rejects every unsigned request. Both verified by live E2E against the gateway, matching the existing public-route contract specs.
- A rep can answer *"what did the AI tell this customer, and when?"* for any lead in under 30 seconds.

## Dependencies

- **New service** `voice-service` (`:3012`) — the first added since the original eleven. Requires a gateway mount, an `.env`, a `crm_voice` schema, and an entry in `Services/migrate-all.mjs`.
- **Schema migrations** on `crm_leads` (enums, normalised phone columns + backfill, AI flags) and the new `crm_voice` schema. Run via `db:migrate:deploy` or `migrate-all.mjs` — **never** `prisma migrate dev` against the shared remote database, per repo convention.
- **`Services/shared/contracts`** — `LeadIntakeChannel` extension plus the new `voiceAgent.js` schema module.
- **`Management`** — AI Calls tab, three badges, approval diff view, Voice settings page.
- **External:** Retell AI account, a provisioned phone number, and a telephony provider decision.
- **Testing**, per repo convention: vitest unit tests for the normalisation, caller-identification and capability-tier logic; supertest integration tests for all three webhook routes including signature rejection; one `Services/e2e-tests/` flow covering call → lead → rep claim. Management E2E stays out of scope — the existing Playwright suite is deliberately narrow.

## The Assignment

Before writing a line of code: run Phase 0 and personally read all 20 transcripts.

Not the summaries — the raw transcripts. Count how many times the agent misheard a destination or a hotel name, and count the questions callers actually asked. Then compare that list against the ANSWER tier above.

If the two lists do not substantially overlap, the capability table in this document is wrong and should be rewritten before Phase 1 — which is exactly what Phase 0 is for, and exactly why it costs three days instead of three weeks.

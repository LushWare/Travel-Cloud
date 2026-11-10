/**
 * crm_assistant — the copilot's transcript, telemetry, per-actor read state and
 * the insight-suppression log.
 *
 * Every table here is deleted for the scope this seed owns and rewritten on
 * every run — including AssistantSession, ManagementLastSeen and InsightState,
 * whose compound unique keys would otherwise make a rewrite collide with the
 * deterministic id an earlier run already used. The reset helper in
 * lib/reset.mjs only understands id prefixes, so every id this module mints
 * must carry its category prefix — the message ids
 * additionally start with the session id so a session-scoped delete catches
 * them even when the category prefix differs.
 *
 * The conversation data is the fixture transcripts plus a handful of short,
 * plausible exchanges for the panels that need history but have no design
 * copy of their own (a billing question, a package query, a group booking).
 */
import {
  ASSISTANT_CONVERSATIONS,
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_ROUTES,
  ASSISTANT_TOOLS,
  INSIGHT_DECISIONS,
  INSIGHT_KEYS,
  INSIGHT_REASONS,
  INSIGHT_SEVERITIES,
} from '../lib/fixtures.mjs';
import { addDays, addMinutes } from '../lib/rng.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';

// The share of the id space this seed owns for the current agency (mirrors reset.mjs).

/** Insights each page actually shows, so the suppression log reads like real usage. */
const INSIGHT_KEYS_BY_PAGE = {
  '/dashboard': ['overdue_invoices', 'revenue_at_risk', 'conversion_drop', 'stale_leads'],
  '/leads': ['stale_leads', 'unassigned_leads', 'high_value_lead', 'repeated_contact_attempts'],
  '/billing': ['overdue_invoices', 'quote_expiring', 'revenue_at_risk'],
  '/analytics': ['conversion_drop', 'package_without_bookings', 'revenue_at_risk'],
  '/packages': ['package_without_bookings', 'conversion_drop'],
};

/** Resolve a fixture reason by name, so the map below cannot drift from it. */
const reason = (name) => {
  const found = INSIGHT_REASONS.find((r) => r === name);
  if (!found) throw new Error(`assistant: unknown insight reason "${name}"`);
  return found;
};

/** A decision and the reason that would actually have produced it. */
const REASONS_FOR_DECISION = {
  shown: [reason('material_change_detected'), reason('below_severity_threshold')],
  suppressed_acknowledged: [reason('acknowledged_within_window')],
  suppressed_snoozed: [reason('snoozed_until_future')],
  suppressed_unchanged: [reason('unchanged_since_last_seen')],
  dropped_volume_cap: [reason('volume_cap_reached'), reason('scope_not_visible')],
};

/** Where no fixture weight exists yet, sample the type thinly rather than drop it. */
const EVENT_WEIGHTS = { impression: 6, opened: 3, turn: 4, response: 4, nav_click: 2, dismissed: 1, error: 0.4 };
const EVENT_MIX = ASSISTANT_EVENT_TYPES.map((type) => [type, EVENT_WEIGHTS[type] ?? 0.5]);

/** Shown is the common outcome; a volume-cap drop is the rare one. */
const DECISION_MIX = INSIGHT_DECISIONS.map((d, i) => [d, [6, 3, 2, 4, 1][i] ?? 1]);

// A key the service surfaces but this map never assigns to a page would make the
// demo's suppression log silently incomplete, so fail loudly at import time.
const MAPPED_KEYS = new Set(Object.values(INSIGHT_KEYS_BY_PAGE).flat());
const missingKeys = INSIGHT_KEYS.filter((k) => !MAPPED_KEYS.has(k));
if (missingKeys.length) throw new Error(`assistant: insight keys not mapped to a page: ${missingKeys.join(', ')}`);

/**
 * Eight short exchanges beyond the fixture transcripts. Each session's messages
 * alternate user/assistant so the transcript is internally consistent — the
 * assistant never answers a question the customer did not ask.
 */
const EXTRA_CONVERSATIONS = [
  {
    topic: 'Visa requirements',
    suggestsPackages: false,
    turns: [
      ['user', 'Do British passport holders need a visa for Vietnam?'],
      ['assistant', 'Yes — UK passport holders need a visa for Vietnam, but the 90-day e-visa is issued online and is straightforward. It must be applied for at least a week before travel. I can add the visa fee to the quotation as a cost line so it is not a surprise later.'],
      ['user', 'Yes please, add it for two travellers.'],
      ['assistant', 'Added — two e-visa fees at the current rate, listed separately under documentation so the client can see what it covers.'],
    ],
  },
  {
    topic: 'Honeymoon planning',
    suggestsPackages: true,
    turns: [
      ['user', 'We are looking at the Maldives for a honeymoon in June, five nights.'],
      ['assistant', 'June is the start of the south-west monsoon, so expect short afternoon showers and lower rates — often 25 to 35 percent below high season. For five nights I would keep it to one resort to avoid a wasted transfer day. I can show two resorts at different price points.'],
      ['user', 'Show me both, and include the seaplane transfers.'],
      ['assistant', 'Both options are on the shortlist with seaplane transfers included. The lower-priced one is a speedboat resort, so the transfer is shorter but the villa is a beach villa rather than overwater.'],
    ],
  },
  {
    topic: 'Invoice query',
    suggestsPackages: false,
    turns: [
      ['user', 'What payment terms did we quote for the Perera booking?'],
      ['assistant', 'That one was quoted at 25 percent deposit on confirmation and the balance 30 days before arrival. One payment has been received against it so far and the invoice is still within terms.'],
    ],
  },
  {
    topic: 'Family safari',
    suggestsPackages: true,
    turns: [
      ['user', 'Can you recommend a safari that works with a seven-year-old?'],
      ['assistant', 'Yes — several camps accept children from six, and Kenya is the easier choice because the flying distances are short. I would avoid the walking safaris and pick a camp with a family tent and a private vehicle so the game drives can be shaped around the child. Two of our Kenya itineraries fit that.'],
    ],
  },
  {
    topic: 'Airport transfers',
    suggestsPackages: false,
    turns: [
      ['user', 'Is the airport pickup included in the Sri Lanka package?'],
      ['assistant', 'Yes — a private air-conditioned vehicle and an English-speaking driver meet you at arrivals and cover every transfer in the itinerary. Meals and entrance fees are separate line items, not part of the transfer.'],
    ],
  },
  {
    topic: 'Group booking',
    suggestsPackages: true,
    turns: [
      ['user', 'We have eight people travelling to Bali next April. Can you price it as a group?'],
      ['assistant', 'Eight travelling together changes the vehicle and the room mix — you would need two vans or a minibus, and four twin rooms rather than the double rooms a couple would take. I can price the group version against the existing itinerary.'],
      ['user', 'Go ahead, we would want four twin rooms.'],
      ['assistant', 'Priced with four twin rooms and a single minibus. The per-person cost comes down because the vehicle is shared across the whole group.'],
    ],
  },
  {
    topic: 'Best time to visit',
    suggestsPackages: false,
    turns: [
      ['user', 'When is the best time to see the cherry blossoms in Japan?'],
      ['assistant', 'Late March to early April for the main cities, moving north as the season advances — Tokyo and Kyoto peak first, then Hokkaido in early May. It moves a few days either way each year, so building the trip around a date range rather than a single day is safer.'],
    ],
  },
  {
    topic: 'Refund timeline',
    suggestsPackages: false,
    turns: [
      ['user', 'How long does a refund take after a cancellation?'],
      ['assistant', 'Refunds are processed to the original payment method, normally within 10 to 14 working days once the cancellation is confirmed. Supplier penalties are deducted first, and those depend on how close to departure the cancellation falls.'],
    ],
  },
];

const scopeFor = (actor) => (actor.role === 'superAdmin' ? 'role:superAdmin|range:90d' : 'role:admin|range:30d');

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('assistant');

  const { admins, reps } = ctx.data.users;
  const packages = ctx.data.packages?.list ?? [];
  const packageIds = packages.map((p) => p.id);
  const leadIds = (ctx.data.leads?.plan ?? []).map((l) => l.id);
  const invoiceIds = (ctx.data.invoices?.list ?? []).map((i) => i.id);

  // ── 1. Conversation transcripts ────────────────────────────────────────────
  // Both fixture and generated conversations share one shape so the message
  // builder is a single loop, not two code paths that can drift.
  const conversations = [
    ...ASSISTANT_CONVERSATIONS.map((c) => ({
      topic: c.topic,
      turns: c.turns,
      suggestsPackages: c.topic === 'Trip planning' || c.topic === 'Package question',
    })),
    ...EXTRA_CONVERSATIONS,
  ];

  const sessions = [];
  const messages = [];
  for (const conv of conversations) {
    const sessionId = ids.next('assistantSession');
    const createdAt = addDays(now, -rng.int(1, 45));
    const lastSeenAt = addMinutes(createdAt, rng.int(6, 240));
    // seq advances by one per message (two per turn): user 0, assistant 1, user 2…
    // The @@unique([sessionId, seq]) key is what makes a retried turn idempotent.
    const shown = conv.suggestsPackages && packageIds.length
      ? rng.sample(packageIds, rng.int(1, Math.min(3, packageIds.length)))
      : [];
    sessions.push({ id: sessionId, createdAt, lastSeenAt, shownPackageIds: shown, turnCount: conv.turns.length / 2 });
    conv.turns.forEach(([role, text], seq) => {
      messages.push({
        id: `${sessionId}-m${seq}`,
        sessionId,
        seq,
        role,
        content: text,
        createdAt: addMinutes(createdAt, seq * 2),
      });
    });
  }

  // ── 2. Telemetry ───────────────────────────────────────────────────────────
  const EVENT_COUNT = 160;
  const events = [];
  for (let i = 0; i < EVENT_COUNT; i += 1) {
    const session = rng.pick(sessions);
    const eventType = rng.weighted(EVENT_MIX);
    const turn = rng.int(1, Math.max(1, session.turnCount));
    events.push({
      id: ids.next('assistantEvent'),
      sessionId: session.id,
      turnId: `${session.id}-t${turn}`,
      eventType,
      // Only a turn/response had a tool call behind it; the rest are UI events.
      tool: eventType === 'turn' || eventType === 'response' ? rng.pick(ASSISTANT_TOOLS) : null,
      route: rng.pick(ASSISTANT_ROUTES),
      metadata: { turn, latencyMs: rng.int(120, 2400) },
      createdAt: addMinutes(session.createdAt, rng.int(0, 720)),
    });
  }

  // ── 3. Delete the rows this script owns, then rewrite them ─────────────────
  // Prisma has no `startsWith` filter on a String id that is safe across every
  // client version here, and these tables have no compound key to upsert on, so
  // the raw pool does the prefix delete the reset helper also relies on.
  await db.sql.query('DELETE FROM crm_assistant."AssistantMessage" WHERE id LIKE $1 OR "sessionId" LIKE $2', [
    `${ownedPrefix('assistantMessage')}%`,
    `${ownedPrefix('assistantSession')}%`,
  ]);
  await db.sql.query('DELETE FROM crm_assistant."AssistantEvent" WHERE id LIKE $1', [`${ownedPrefix('assistantEvent')}%`]);
  await db.sql.query('DELETE FROM crm_assistant."InsightDecision" WHERE id LIKE $1', [`${ownedPrefix('insightDecision')}%`]);
  // These two carry a compound unique key, so an upsert looks natural — but the
  // id is deterministic while the compound values are drawn from the shared rng
  // stream, and that stream shifts whenever an earlier step gains or loses a
  // draw. A row would then be created under an id whose previous occupant had
  // different compound values, and the insert would die on the primary key.
  // Owning the prefix and rewriting the rows is immune to that.
  await db.sql.query('DELETE FROM crm_assistant."ManagementLastSeen" WHERE id LIKE $1', [`${ownedPrefix('managementLastSeen')}%`]);
  await db.sql.query('DELETE FROM crm_assistant."InsightState" WHERE id LIKE $1', [`${ownedPrefix('insightState')}%`]);

  for (const s of sessions) {
    await db.assistant.assistantSession.upsert({
      where: { id: s.id },
      update: { lastSeenAt: s.lastSeenAt, shownPackageIds: s.shownPackageIds, turnCount: s.turnCount },
      create: {
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        shownPackageIds: s.shownPackageIds,
        turnCount: s.turnCount,
      },
    });
  }
  await db.assistant.assistantMessage.createMany({ data: messages, skipDuplicates: true });
  await db.assistant.assistantEvent.createMany({ data: events, skipDuplicates: true });

  // ── 4. ManagementLastSeen — the copilot's server-side delta window ─────────
  // Compound unique [actorId, pageKey, scopeFingerprint]; the prefix delete
  // above is what keeps a second run from adding a duplicate row.
  const MANAGEMENT_PAGES = ['/dashboard', '/leads', '/packages', '/billing', '/analytics'];
  let lastSeenRows = 0;
  for (const actor of admins) {
    for (const pageKey of MANAGEMENT_PAGES) {
      await db.assistant.managementLastSeen.create({
        data: {
          id: ids.next('managementLastSeen'),
          actorId: actor.id,
          pageKey,
          scopeFingerprint: scopeFor(actor),
          lastSeenAt: addDays(now, -rng.int(0, 9)),
        },
      });
      lastSeenRows += 1;
    }
  }

  // ── 5. InsightState — per-insight acknowledgement and novelty ──────────────
  // Keyed on the insight key (not an array index) so reordering descriptors does
  // not orphan stored state; the prefix delete keeps one row per actor/page/scope/insight.
  const MATERIAL_VALUES = ['12', '4,180.00 USD', '3', '87%', '2 days', '14'];
  let stateRows = 0;
  for (const actor of admins) {
    const scopeFingerprint = scopeFor(actor);
    for (const [pageKey, keys] of Object.entries(INSIGHT_KEYS_BY_PAGE)) {
      for (const insightKey of rng.sample(keys, rng.int(2, keys.length))) {
        const surfacedCount = rng.int(1, 25);
        const acknowledgedAt = rng.chance(0.3) ? addDays(now, -rng.int(1, 15)) : null;
        const snoozedUntil = rng.chance(0.2) ? addDays(now, rng.int(1, 10)) : null;
        await db.assistant.insightState.create({
          data: {
            id: ids.next('insightState'),
            actorId: actor.id,
            pageKey,
            scopeFingerprint,
            insightKey,
            firstSeenAt: addDays(now, -rng.int(10, 60)),
            lastSurfacedAt: addDays(now, -rng.int(0, 9)),
            surfacedCount,
            acknowledgedAt,
            snoozedUntil,
            lastMaterialValue: rng.pick(MATERIAL_VALUES),
          },
        });
      }
    }
  }

  // ── 6. InsightDecision — why the panel showed (or hid) each candidate ──────
  // ~120 rows over the last 30 days as a compact ranking-log sample. entityKind
  // and entityId point at rows that actually exist so "why did this show" can be
  // followed from the panel to the lead or invoice it cites.
  const actors = [...admins, ...reps];
  const decisionPages = Object.entries(INSIGHT_KEYS_BY_PAGE);
  // The kind must match the pool the id came from, or the "why did this show"
  // link points at a row in the wrong table.
  const entityFor = (insightKey) => {
    const pickLead = () => (leadIds.length ? { entityKind: 'lead', entityId: rng.pick(leadIds) } : { entityKind: null, entityId: null });
    if (insightKey === 'package_without_bookings') {
      return packageIds.length ? { entityKind: 'package', entityId: rng.pick(packageIds) } : { entityKind: null, entityId: null };
    }
    if (insightKey === 'overdue_invoices' || insightKey === 'revenue_at_risk' || insightKey === 'quote_expiring') {
      return invoiceIds.length ? { entityKind: 'invoice', entityId: rng.pick(invoiceIds) } : pickLead();
    }
    return pickLead();
  };

  const decisions = [];
  for (let i = 0; i < 120; i += 1) {
    const actor = rng.pick(actors.length ? actors : admins);
    const [pageKey, keys] = rng.pick(decisionPages);
    const insightKey = rng.pick(keys);
    const decision = rng.weighted(DECISION_MIX);
    const entity = entityFor(insightKey);
    decisions.push({
      id: ids.next('insightDecision'),
      requestId: rng.chance(0.5) ? `req-${rng.int(10000, 99999)}` : null,
      actorId: actor.id,
      pageKey,
      scopeFingerprint: scopeFor(actor),
      insightKey,
      ruleId: `rule:${insightKey}`,
      entityKind: entity.entityKind,
      entityId: entity.entityId,
      severity: rng.pick(INSIGHT_SEVERITIES),
      rankScore: Math.round(rng.money(0.05, 0.99) * 100) / 100,
      decision,
      reason: rng.pick(REASONS_FOR_DECISION[decision]),
      rankingVersion: 'v3',
      createdAt: addMinutes(addDays(now, -rng.int(0, 30)), rng.int(0, 600)),
    });
  }

  await db.assistant.insightDecision.createMany({ data: decisions, skipDuplicates: true });

  const summary = `${sessions.length} sessions · ${messages.length} messages · ${events.length} events · ${decisions.length} decisions`;
  log(`    assistant: ${summary}`);
  return {
    summary,
    sessions: sessions.length,
    messages: messages.length,
    events: events.length,
    managementLastSeen: lastSeenRows,
    insightStates: stateRows,
    insightDecisions: decisions.length,
  };
}

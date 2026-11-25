import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import logger from '../config/logger.js';
import { generateStructured, isAIConfigured } from '../ai/aiClient.js';
import {
  buildAssistantTurnPrompt,
  buildAssistantTurnResponseJsonSchema,
  canonicalizeAssistantTurnResponse,
  assistantTurnResponseSchema,
} from '../ai/prompts/assistantTurn.v1.js';
import { ASSISTANT_FORM_SURFACES, ASSISTANT_PAGE_ACTIONS, ASSISTANT_VIEW_TOOL } from '@travel-crm/contracts';
import { generateGrounded, GROUNDING_TIMEOUT_MS } from '../ai/groundedSearch.js';
import { buildTravelSearchPrompt } from '../ai/prompts/travelSearch.v1.js';
import { isTravelDomainQuery, sanitizeSearchQuery, toSearchPhrase } from '../ai/travelDomain.js';
import { fetchPolicyDocuments, retrieveSnippets, FALLBACK_POLICY_MESSAGE } from '@travel-crm/policy-retrieval';
import { BAD_GATEWAY } from '../constants/httpStatus.js';
import { recordAssistantResolution } from '../telemetry/assistantEvents.js';
import { classifyAssistantIntent, confidenceBucket } from '../ai/assistantRouter.js';
import { buildRouteQuery, resolveRouteFilters, extractFilterArgs, matchDeclaredValue } from '../ai/routeParams.js';
import { unresolvedNumericTokens } from '../ai/groundingValidator.js';
import { loadSession, appendTurn, updateSession } from '../sessions/assistantSession.js';
import { submitWebsiteBooking } from '../booking/bookingRequest.js';
import {
  loadPackageCatalogue,
  loadPackageDetail,
  loadFilteredPackages,
  matchPackage,
  lastShownPackage,
  packageFactValues,
  countSentenceWithNames,
  BROWSE_PREVIEW_LIMIT,
} from '../catalogue/packageContext.js';

// The wire contract requires every assistant bubble to have non-empty
// content. Missing model-authored messages are legal in the flat generation
// schema, so deterministic fallbacks must prevent an empty response from
// poisoning every later turn's resent conversation window.
const ROUTE_DECLINED_MESSAGE =
  "I can't take you there directly — try asking for a specific page, like packages or destinations.";
const NO_MESSAGE_FALLBACK = "Sorry, I didn't quite catch that — could you rephrase?";
// The visitor named a place we do not cover. A destination is checked against the
// client's own list, and a value matching nothing used to be dropped silently —
// leaving the whole catalogue presented as the answer, which is what "do you
// have any tokyo packages" got, and what every rephrasing of it got again.
const NO_SUCH_PLACE_MESSAGE =
  "I don't have a trip for that place — this is everything we offer. Tell me and I can help you build a custom trip for it instead.";
// Matches content.max(2000) on both wire schemas (assistant.schema.js,
// assistantTurn.ts). Enforce the cap server-side as the single source of
// truth before a response enters the client's resent conversation window.
const MAX_MESSAGE_LENGTH = 2000;
const ASSISTANT_TURN_DEADLINE_MS = 27_000;
const ASSISTANT_RESOLVER_TIMEOUT_MS = 20_000;
const SOCIAL_MESSAGES = {
  greeting: 'Hi! I can help you explore destinations, find packages, build a custom trip with AI, or answer LushWare policy questions.',
  thanks: "You're welcome! If you need anything else for your trip, just ask.",
  farewell: 'Safe travels! Come back anytime you need help planning your trip.',
  repair: "No problem. Tell me what you're trying to do, and I'll help you find the right travel option or page.",
};
// Server-authored, so it can neither be invented by the model nor drift from
// what the assistant can actually do. A function of what this turn offered,
// because the answer to "what can you do" is false in both directions when it
// promises an ability the caller did not register.
function capabilitiesMessage({ pageActionsOffered, travelSearchEnabled, routesOffered }) {
  const base =
    'I can take you to any page on the site, find and filter packages by destination, budget, trip length and rating, and answer questions about LushWare policies.';
  // Said only when the client offered the planner this turn: the planner is where a
  // trip we do not list gets built with AI, and promising it to a caller that did
  // not register the route is the same falsehood as promising a page action.
  const custom = routesOffered.includes('planner')
    ? ' For a trip we do not have, I can take you to the planner, where AI drafts a day-by-day itinerary from your destination and dates, and you can shape it with me right there — our specialists review it before you book.'
    : '';
  const customize = routesOffered.includes('customize')
    ? ' Name a package and I can open its customization page, where you tailor that trip.'
    : '';
  const page = pageActionsOffered
    ? ' On this page I can also change your trip details, build or redo the day-by-day plan, and edit individual days for you.'
    : '';
  const search = travelSearchEnabled
    ? ' I can look up travel information for a destination — entry rules, timing, costs, getting around, safety notes — with its sources.'
    : '';
  return `${base}${custom}${customize}${page}${search} Try "build me a custom trip to Japan", "packages in Dubai under 1000" or "what is your cancellation policy".`;
}

/**
 * What the assistant says about the screen the visitor is looking at.
 *
 * Server-owned in full, and the only place a number about the screen is written:
 * the count is the page's own report relayed unchanged, never a rendered page
 * size and never a figure the model composed. A missing report is answered as a
 * missing report — "I can't see the page" — because a guess about something the
 * visitor is looking at is the one thing they can check in a second.
 */
function describeCurrentView(view) {
  if (!view?.path) {
    return "I can't see the page you're on right now. Tell me what you're looking for and I'll help you find it.";
  }

  const count = view.filteredCount;
  if (count === null || count === undefined) {
    return `You're on ${view.path}, but it hasn't told me how many results are showing. Ask me about the catalogue and I'll look it up.`;
  }

  const filtered = Boolean(view.params && Object.keys(view.params).length);
  const trips = count === 1 ? 'trip' : 'trips';
  const lead = `There ${count === 1 ? 'is' : 'are'} ${count} ${trips} ${
    filtered ? 'matching the filters on this page' : 'on this page'
  }.`;
  // Said only when the page drew fewer than it counted: the number above is still
  // the true one, and this is what keeps it from reading as "and that is all".
  const rendered = view.renderedCount;
  const qualifier =
    typeof rendered === 'number' && rendered < count
      ? ` ${rendered} ${rendered === 1 ? 'is' : 'are'} shown so far.`
      : '';
  return `${lead}${qualifier}`;
}

// A page action is one the browser executes, so an empty model-authored line
// would otherwise be replaced by NO_MESSAGE_FALLBACK — telling the visitor
// "Sorry, I didn't quite catch that" about an action that is about to run.
// One per name in ASSISTANT_PAGE_ACTIONS: a page action that runs still needs a
// sentence, and without one here the turn's finalisation answers a successful
// action with NO_MESSAGE_FALLBACK ("Sorry, I didn't quite catch that") — which
// reads as failure. Only the model's own line takes precedence.
const PAGE_ACTION_MESSAGE_DEFAULTS = {
  set_destination: 'Setting your destination on the page now.',
  set_travellers: 'Setting the traveller count on the page now.',
  set_preferences: 'Saving your preferences now.',
  set_contact_details: 'Saving that on the page now.',
  go_to_step: 'Taking you there.',
  generate_itinerary: 'Building your day-by-day plan.',
  regenerate_days: 'Redoing those days now.',
  edit_day: 'Updating that day now.',
  prefill_form: 'Filling that in on the page now.',
};

const SEARCH_DISABLED_MESSAGE =
  'I cannot search the web in this chat right now. Tell me the destination and I will help from what I know about your trip.';
const OFF_DOMAIN_SEARCH_MESSAGE =
  "I only look up travel information — a destination's entry rules, the best time to visit, costs, getting around, and safety notes. Ask me about a place and I will check.";
const SEARCH_FAILED_MESSAGE =
  "The web lookup did not go through just now. Ask me again in a moment, or check the destination's official travel advisory.";
// Appended to a grounded answer rather than baked into it, so it survives any
// wording the model chooses. The answer describes a condition that changes; a
// traveller acting on it needs the authority's own page, not our summary.
const SEARCH_ADVISORY_SUFFIX = "\n\nCheck your government's official travel advisory before you book.";
// Smallest slice of the turn's remaining budget worth starting a search on. The
// call itself needs a few seconds, and the turn still has to persist, record
// telemetry and respond inside its own deadline.
const MIN_SEARCH_BUDGET_MS = 3_000;
// Two attempts at most. Measured: a single grounded call searches on most travel
// questions but not all, so one retry is the difference between "usually works"
// and "works", and it cannot double the turn's cost because each attempt is
// bounded by what is left of the same deadline.
const SEARCH_ATTEMPTS = 2;
const OFF_TOPIC_MESSAGE =
  "I’m here to help with travel and LushWare trips. I can help you explore destinations, find packages, navigate the site, or answer a company-policy question.";
const SENSITIVE_MESSAGE =
  'I can’t provide guidance on visas, entry requirements, health, safety, legal, emergency, or financial matters. Please check the relevant official authority or contact the LushWare team.';
// Replaces the social "repair" copy when the visitor actually asked for
// something. "Tell me what you're trying to do" is the wrong thing to say to
// someone who just did — it was the dead end in the reported conversation.
const ACTIONABLE_UNSUPPORTED_MESSAGE =
  'I could not pick one for you from that. Tell me a destination, a budget or a trip length and I will show you what matches, or say "packages" to see them all.';
// The visitor asked for something only a person can do. Server-authored for the
// same reason as the rest of the copy here, and it names the channels rather
// than pointing at a page the visitor then has to read for themselves.
const HUMAN_HANDOFF_MESSAGE =
  'Our team can help with that. You can call, message on WhatsApp, or send the contact form — the contact page has all three.';
// The chip beside this message carries the package, so the sentence only has to
// say what is about to happen.
const BOOKING_HANDOFF_MESSAGE_PREFIX = 'I can take you to the booking form for ';
// The visitor asking to be shown the package itself, rather than told about it.
// Deliberately narrow: "more details" and "tell me more" are information
// requests, and treating them as requests for the card is what redrew a card on
// a plain follow-up. A false negative here costs one follow-up; a false
// positive is the noise this replaces.
const CARD_REQUEST_PATTERN = /\b(show|see|open|view|display|link|photo|picture|image)\b/i;
// The sensitive surface, as it appears in model-authored prose. The router is
// what normally keeps these claims off the public assistant — and the
// travel_general branch below now runs precisely when the router did not answer,
// so the claim is checked where it is made instead of only at intent level.
// Over-blocking is the safe direction: the replacement is reviewed copy, while a
// wrong visa or health claim cannot be walked back.
const SENSITIVE_CLAIM_PATTERN =
  /\b(visa|passport|vaccin\w*|immunis\w*|immuniz\w*|health|medical|hospital|clinic|safe|safety|danger\w*|legal|lawyer|attorney|lawsuit|emergency|insurance|financial)\b/i;

// ── Booking capture ──
// The assistant takes a booking request in the chat. Every guard here exists
// because a successful POST to booking-service is not a form submission: it
// creates a customer account, a lead and a booking, bumps the package's booking
// count and emails a sales rep. So the server owns the state machine — what is
// still missing, whether the visitor confirmed, and whether we already wrote —
// and the model only reports what it read.
//
// The confirmation must be the visitor's NEXT message after the summary, which
// is what `bookingAskedTurn` anchors. "Reply yes and I will send it" is a
// question about a specific summary, and a yes three turns later is a yes to
// something the visitor has since stopped reading.
const BOOKING_AFFIRM_PATTERN =
  /^\s*(yes|yeah|yep|yup|ok|okay|sure|correct|confirm|confirmed|go ahead|please do|send it|send the request|do it|proceed|try again)\b/i;
const BOOKING_ASK_PREFIX = 'I can send a booking request for ';
const BOOKING_NEEDS = {
  package: 'which package',
  email: 'the email address to confirm it to',
  travelDate: 'the travel date',
};
const BOOKING_CONFIRM_SUFFIX = ' Reply "yes" and I will send it.';
const BOOKING_SENT_PREFIX = 'Your booking request is in for ';
const BOOKING_SENT_SUFFIX = '. Our team will get back to you within 24 hours.';
const BOOKING_ALREADY_SENT = 'That booking request is already in';
const BOOKING_REJECTED_MESSAGE =
  'The booking service would not accept that request. Your details are still here, so tell me what to change, or use the booking form on the page.';
const BOOKING_UNAVAILABLE_MESSAGE =
  'I could not send that just now — nothing was booked. Say "try again" when you are ready, or use the booking form on the page.';
const BOOKING_NEEDS_STORE_MESSAGE =
  'I cannot take a booking in this chat at the moment. The booking form on the package page has everything I would ask for.';
// The draft fields the model may fill, in one list so the merge and the schema
// cannot disagree about what a draft holds.
const BOOKING_DRAFT_KEYS = ['packageId', 'email', 'travelDate', 'endDate', 'travelers', 'name', 'phone'];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The closed set of values a route offers for one filter, as `{ value, label }`
// pairs. Absent for a client that does not send one, which the navigate case
// treats as "nothing to verify against" rather than "nothing allowed".
function declaredValues(route, paramName) {
  const values = route?.paramValues?.[paramName];
  return Array.isArray(values) ? values : [];
}

function conversationalOutcomesEnabled() {
  return process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED === 'true';
}

// On by default, with an explicit opt-out: a deployment that wants no billed
// search sets the flag to 'false'. A missing API key disables it independently,
// so the tool is never offered when there is nothing to call it with.
function travelSearchEnabled() {
  return process.env.ASSISTANT_TRAVEL_SEARCH_ENABLED !== 'false' && isAIConfigured();
}

// The page actions the browser registered this turn, intersected with the closed
// list. Used for the schema enum, the prompt and the dispatch guard, so all three
// cannot disagree about what was offered.
function offeredPageActions(capabilities) {
  return (capabilities?.actions ?? []).filter((name) => ASSISTANT_PAGE_ACTIONS.includes(name));
}

function latestUserTurn(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i];
  }
  return null;
}


function resolutionFailureCategory(err) {
  if (err?.aiFailureCategory) return err.aiFailureCategory;
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (message.includes('deadline')) return 'server_deadline';
  if (message.includes('timeout') || err?.name === 'AbortError') return 'timeout';
  if (message.includes('schema') || message.includes('tool contract') || err?.name === 'ZodError') return 'schema';
  return 'provider';
}

function safeGeneratedMessage(message) {
  if (typeof message !== 'string') return '';
  const withoutHtml = message.replace(/<[^>]*>/g, '').trim();
  if (/(?:https?:\/\/|www\.|javascript:)/i.test(withoutHtml)) return '';
  return withoutHtml;
}

/**
 * Whether this address is one the VISITOR typed. Both a shape check and a
 * provenance check, in one place because they answer one question: may we send
 * this? Accepting an address the model produced would create a customer account
 * and email a sales rep for someone who never asked — the same reasoning that
 * makes the destination filter prefer the visitor's words over the model's
 * reading, with a much higher cost attached.
 */
function bookingEmailIsVisitorOwn(email, history) {
  if (typeof email !== 'string' || !EMAIL_SHAPE.test(email.trim())) return false;
  const needle = email.trim().toLowerCase();
  return (history || []).some(
    (message) =>
      message?.role === 'user' &&
      typeof message.content === 'string' &&
      message.content.toLowerCase().includes(needle),
  );
}

/** Today or later, as a real calendar date. `YYYY-MM-DD` or nothing. */
function isBookableDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return parsed.getTime() >= startOfToday;
}

/** "14 Mar 2027" — the date as the visitor will read it back before confirming. */
function formatBookingDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * The line the visitor confirms. It names every field that will be submitted,
 * because this is the only place a mis-readable date or address is visible
 * before the booking service acts on it.
 */
function bookingSummary(draft, title) {
  const travellers = draft.travelers ?? 1;
  const parts = [`${travellers} traveller${travellers === 1 ? '' : 's'}`];
  parts.push(`departing ${formatBookingDate(draft.travelDate)}`);
  if (draft.endDate) parts.push(`returning ${formatBookingDate(draft.endDate)}`);
  parts.push(`confirmation to ${draft.email}`);
  return `Ready to send a booking request: ${title}, ${parts.join(', ')}.`;
}

// ── Public: site-wide assistant turn ──
// The model selects one recognized outcome. This handler canonicalizes its
// flat generation payload, validates a strict per-tool union, and executes
// deterministic server-side behavior. Navigation resolves only routes the
// client offered in this request. Policy answers quote only server-retrieved
// snippets. Social and off-topic outcomes use reviewed server-owned copy.
//
// The conversation itself is read from and written to the session store. The
// request's own message window and `shownPackageIds` are the FALLBACK for a
// store that could not be read — an old client and an unreachable database both
// keep the pre-session behaviour rather than failing the turn.
export const assistantTurn = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { sessionId, messages, availableRoutes, shownPackageIds, capabilities, pageContext, currentView } = req.body;
  const outcomesEnabled = conversationalOutcomesEnabled();
  // What this turn may offer and execute. Resolved once, here, so the response
  // schema, the prompt and the dispatch guard all read the same pair.
  const offeredActions = offeredPageActions(capabilities);
  const searchEnabled = travelSearchEnabled();
  const latestTurn = latestUserTurn(messages);
  const turnId = latestTurn?.id;

  // Read before anything else, because history, the card list and the booking
  // draft all come from it. A failure here is not fatal: `stored.ok === false`
  // means "no session", and every use below has a fallback.
  const stored = await loadSession(sessionId);
  const thisTurn = stored.ok ? stored.thisTurn : null;
  const history = stored.ok && stored.messages.length
    ? [...stored.messages, { id: latestTurn.id, role: 'user', content: latestTurn.content }]
    : messages;
  // The server's own record of the cards it drew wins over the client's claim.
  // The request field survives only for a store that could not be read.
  const alreadyShown = new Set(
    stored.ok ? stored.session.shownPackageIds : Array.isArray(shownPackageIds) ? shownPackageIds : [],
  );
  let routerResult = null;
  let routerFailureCategory = null;

  try {
    const routerBudgetMs = ASSISTANT_TURN_DEADLINE_MS - (Date.now() - startedAt);
    if (routerBudgetMs <= 0) throw new AppError('Assistant request deadline exhausted', BAD_GATEWAY);

    if (outcomesEnabled) {
      try {
        routerResult = await classifyAssistantIntent(latestTurn?.content ?? '', routerBudgetMs);
      } catch (err) {
        routerFailureCategory = resolutionFailureCategory(err);
      }
    }

    if (outcomesEnabled && routerResult?.decision.committed) {
      const { classification } = routerResult;
      const isSocial = classification.intent === 'social';
      const tool = isSocial ? 'respond_conversationally' : 'redirect_off_topic';
      const args = isSocial
        ? { mode: 'social', socialSubtype: classification.socialSubtype === 'none' ? 'repair' : classification.socialSubtype }
        : {};
      const serverResult = isSocial
        ? { mode: 'social', source: 'router' }
        : { redirected: true, source: 'router' };
      const message = isSocial ? SOCIAL_MESSAGES[args.socialSubtype] : OFF_TOPIC_MESSAGE;

      if (turnId) {
        await recordAssistantResolution({
          sessionId,
          turnId,
          tool,
          route: null,
          metadata: {
            routerVersion: routerResult.version,
            routerModel: routerResult.model,
            predictedIntent: classification.intent,
            socialSubtype: classification.socialSubtype,
            confidenceBucket: confidenceBucket(classification.confidence),
            committed: true,
            abstainReason: routerResult.decision.reason,
            stageOneLatencyMs: Math.min(routerResult.latencyMs, ASSISTANT_TURN_DEADLINE_MS),
            fallbackUsed: false,
          },
        });
      }
      res.json({ success: true, data: { toolCall: { tool, args }, serverResult, message } });
      return;
    }

    const remainingBudgetMs = ASSISTANT_TURN_DEADLINE_MS - (Date.now() - startedAt);
    if (remainingBudgetMs <= 0) throw new AppError('Assistant request deadline exhausted', BAD_GATEWAY);

    // The catalogue is read before retrieval because whether this turn is about
    // a package decides whether policy retrieval happens at all. The signal
    // bounds both reads to what is left of the turn, so a slow package service
    // cannot push the turn past its own deadline; a failed read yields no
    // catalogue and the turn proceeds exactly as it did before this existed.
    const visitorText = latestTurn?.content ?? '';
    const catalogueSignal = AbortSignal.timeout(Math.max(1, remainingBudgetMs));
    const packages = await loadPackageCatalogue({ signal: catalogueSignal });
    const namedPackage = matchPackage(visitorText, packages);
    // A follow-up almost never repeats the title, so the conversation's subject
    // — the package last put in front of the visitor — stands in when the
    // message names nothing. Without this the detail was never fetched on the
    // turns that ask for it, and the assistant truthfully reported that it had
    // no day-by-day outline to give.
    const subjectPackage = namedPackage ?? lastShownPackage(packages, shownPackageIds);
    const packageDetail = subjectPackage
      ? await loadPackageDetail(subjectPackage.id, { signal: catalogueSignal })
      : null;

    // A turn about a named package is offered no policy snippets, so there is
    // nothing for the model to mis-quote. Retrieval is lexical — a baggage
    // section containing the word "package" qualifies for a question about a
    // package, which is precisely the answer the reported conversation got. No
    // fetch, no snippets block, nothing to select wrongly. Every other turn
    // retrieves exactly as before.
    const candidateSnippets = namedPackage
      ? []
      : retrieveSnippets(await fetchPolicyDocuments(), visitorText);

    const catalogueCurrency = packages[0]?.currency || 'USD';
    const routerIntent = routerResult?.classification.intent ?? null;
    // A form IS the surface this turn: the mounted form decides which fields may
    // be written, and the canonicalizer narrowed the fill to exactly those. A
    // planner surface has no form, so a fill there is refused below.
    const prefillForm = ASSISTANT_FORM_SURFACES.includes(capabilities?.surface) ? capabilities.surface : null;

    const prompt = buildAssistantTurnPrompt({
      messages: history,
      availableRoutes,
      candidateSnippets,
      conversationalOutcomesEnabled: outcomesEnabled,
      routerHint: routerIntent,
      packages,
      packageDetail,
      pageCapabilities: capabilities,
      pageContext,
      currentView,
      prefillForm,
      travelSearchEnabled: searchEnabled,
    });
    const stageTwoStartedAt = Date.now();
    const raw = await generateStructured({
      prompt,
      // The tool enum is per turn: the model cannot name a tool this turn did
      // not offer, which is what makes an unoffered page action a shape error
      // rather than something the dispatch guard has to catch.
      schema: buildAssistantTurnResponseJsonSchema({
        conversationalOutcomesEnabled: outcomesEnabled,
        capabilityActions: offeredActions,
        travelSearchEnabled: searchEnabled,
        prefillForm,
      }),
      // One tool call, and the arguments of one tool: 1024 was enough for the
      // seven-tool vocabulary, but the model occasionally enumerates synonyms
      // across the wider flat argument space, and a truncated response is a
      // failed turn rather than a partial action (see the AI clients' truncation
      // policy). The extra room covers the verbose case without changing what a
      // well-behaved turn costs.
      maxOutputTokens: 2048,
      timeoutMs: Math.min(ASSISTANT_RESOLVER_TIMEOUT_MS, remainingBudgetMs),
      // A partial answer that still parses is usable here, and far better than the
      // 502 it used to produce: the canonicalizer narrows it and the strict
      // per-tool union validates it, so a cut-off argument is dropped rather than
      // acted on, and everything it names (a route, a package id, a day) is
      // resolved against real records downstream.
      allowTruncated: true,
      // Two attempts, both inside the turn's own deadline. One was the original
      // setting — a resolver call is not worth retrying on the turn's clock — but
      // measured against the live provider, this model has a rare runaway mode
      // where it enumerates synonyms across the flat argument space (8k tokens and
      // still truncating, roughly one call in six) while the same prompt normally
      // answers in under 70. A truncation retry re-samples, and `deadlineMs` keeps
      // the second attempt — and its backoff — inside what is left of the turn.
      maxAttempts: 2,
      deadlineMs: remainingBudgetMs,
    });

    const canonical = canonicalizeAssistantTurnResponse(raw, {
      conversationalOutcomesEnabled: outcomesEnabled,
      routerIntent,
    });
    const parsed = assistantTurnResponseSchema.safeParse(canonical);
    if (!parsed.success) throw new AppError('AI response did not match the tool contract', BAD_GATEWAY);

    let { tool, args } = parsed.data;
    if (routerIntent === 'sensitive') {
      tool = 'answer_faq_policy';
      args = { question: '', selectedSnippetIds: [], message: '' };
    }

    // Belt and braces to the schema's per-turn enum, and the place a mismatch
    // between the two halves of the client's manifest is caught: the actions come
    // from `capabilities.actions`, but the page they describe comes from
    // `pageContext`. A turn that names a page action for a page the browser did
    // not report is answered with copy, never executed and never a 502 — the
    // browser is the only thing that knows what it mounted.
    const surfaceMismatch = Boolean(capabilities && pageContext && capabilities.surface !== pageContext.surface);
    // A fill must name the form that is actually on screen. The surface IS the
    // form, so filling another one is the same class of mistake as naming an
    // action the page never offered — and the page would refuse it anyway.
    const formMismatch = tool === 'prefill_form' && args.form !== prefillForm;
    if (ASSISTANT_PAGE_ACTIONS.includes(tool) && (surfaceMismatch || formMismatch || !offeredActions.includes(tool))) {
      logger.warn(
        { sessionId, tool, surfaceMismatch, formMismatch },
        'assistant named a page action this turn did not offer',
      );
      tool = 'respond_conversationally';
      args = { mode: 'capability' };
    }

    // The confirmation question is the server's, so the server makes sure it can
    // be answered. A bare "yes" carries nothing for the model to act on, and the
    // audit watched it answer a repeated confirmation with the social repair
    // line — once losing a booking the visitor had agreed to, once losing the
    // reference they had just been given.
    //
    // So there are two shapes of "the visitor is answering us": the question is
    // open and this is the very next message, or the booking was already sent and
    // this is another yes with no question left to anchor to. Both route to the
    // booking case whatever the model picked.
    const affirming = BOOKING_AFFIRM_PATTERN.test(visitorText);
    const bookingStatus = stored.ok ? stored.session.bookingStatus : null;
    const answeringConfirmation =
      affirming &&
      (bookingStatus === 'submitted' ||
        (bookingStatus === 'awaiting_confirmation' &&
          stored.session.bookingAskedTurn !== null &&
          thisTurn === stored.session.bookingAskedTurn + 1));

    if (answeringConfirmation && tool !== 'request_booking') {
      // Only when the model chose something else is there nothing to keep. When
      // it did choose request_booking its args stay, because "yes, make it 3
      // travellers" is a correction, and wiping it here would silently submit the
      // count the visitor just changed.
      tool = 'request_booking';
      args = { message: '' };
    }

    let serverResult = null;
    let message = 'message' in args ? args.message : '';
    switch (tool) {
      case 'navigate': {
        const routeName = typeof args.route === 'string' ? args.route : '';
        const offered = (availableRoutes || []).find((route) => route.name === routeName);
        if (offered) {
          // WHICH package is a server decision, never the model's. The customize
          // target is a path template the client owns ('/package/:id/customize'),
          // and the visitor is about to be sent to a real page for a real record,
          // so the id comes from a package the server loaded — an id the model
          // named cannot become a URL.
          if (offered.name === 'customize') {
            const subject = namedPackage ?? lastShownPackage(packages, shownPackageIds);
            if (subject) {
              serverResult = {
                route: 'customize',
                path: offered.path.replace(':id', encodeURIComponent(subject.id)),
              };
              message = `Opening the customization page for ${subject.title}.`;
            } else {
              const packagesRoute = (availableRoutes || []).find((route) => route.name === 'packages');
              serverResult = packagesRoute
                ? { route: 'packages', path: packagesRoute.path }
                : { route: null, path: null };
              message =
                'Which package would you like to customise? This is all of ours — open one and choose Customize Package.';
            }
            break;
          }
          // The client executes this path verbatim, so appending the query here
          // is the whole of "navigate to a filtered view". buildRouteQuery only
          // honours keys the offered route declared, and drops any value it
          // cannot validate — a bad filter degrades to the unfiltered page
          // rather than failing the turn.
          const allowedParams = Array.isArray(offered.params) ? offered.params : [];
          // Named apart from the reply `message` below, which this case still
          // has to set when the model supplied none.
          const visitorMessage = latestTurn?.content ?? '';
          const declared = declaredValues(offered, 'destination');
          const matched = matchDeclaredValue(visitorMessage, declared);

          // A destination is checked against the client's own list rather than
          // taken on trust. The package list does not reject a destination it
          // does not recognise — it ignores it and returns the entire
          // catalogue — so an invented slug is not an error the visitor can
          // see, it is an unfiltered page that looks filtered. The visitor's
          // own words beat the model's reading; the model's value survives only
          // when the client sent no list to check it against (an older client).
          const destination = matched
            ? matched.value
            : declared.length && !declared.some((entry) => entry.value === args.destination)
              ? undefined
              : args.destination;

          // Extraction wins for the keys it found, because those came from the
          // visitor's literal words where the model's came from inference.
          const filters = { ...args, ...extractFilterArgs(visitorMessage), destination };
          const query = buildRouteQuery(filters, allowedParams);
          serverResult = {
            route: offered.name,
            path: query ? `${offered.path}?${query}` : offered.path,
          };

          // One read against the same filters the link carries, so the sentence,
          // the names and the page cannot describe three different things. The
          // count and the names come from the SAME response, so they cannot
          // disagree about how many matched, and it is the service's own total —
          // the model is told never to compute one. This turns a navigation into
          // an answer rather than a redirect. Filters are read back off the query
          // rather than taken from `filters`: the raw object used to feed the
          // sentence, which let a value the URL dropped — an out-of-range budget,
          // an unknown slug — still be described in prose the link did not
          // contain. A read that fails leaves the model's own message in place.
          const routeFilters = resolveRouteFilters(filters, allowedParams);
          const countFilters = { ...routeFilters, destinationLabel: matched?.label };
          const preview = allowedParams.length
            ? await loadFilteredPackages(countFilters, { limit: BROWSE_PREVIEW_LIMIT, signal: catalogueSignal })
            : null;

          if (preview && preview.total !== null) {
            serverResult = { ...serverResult, total: preview.total };
            const intendedDestination = typeof args.destination === 'string' && args.destination;
            // The place the model read out of the visitor's words could not be
            // applied — it is not one of the destinations the page lists, so the
            // link is unfiltered and a count would describe the whole catalogue as
            // if it answered a question about that place. This is what returned the
            // same 25-package list for "do you have any tokyo packages" and for
            // every rephrasing of it. The test is the resolved filter and not
            // `matched`: when the model reads a city as its country ("tokyo" ->
            // "japan") the value survives, the count is the Japan count, and the
            // model's own "we have no Tokyo trip" clause is kept below.
            const droppedPlace = Boolean(intendedDestination) && !destination;
            const answer = countSentenceWithNames(
              preview.total,
              countFilters,
              catalogueCurrency,
              preview.packages.map((pkg) => pkg.title),
            );
            // The model's own clause is the only part of a navigate answer the
            // server did not write, so it is kept exactly as answer_packages keeps
            // its prose: only while every number in it resolves to a record. It
            // was being discarded outright, which threw away the one clause that
            // said "we have no Tokyo trip — these are our Japan trips".
            const authored = safeGeneratedMessage(args.message);
            const unsupported = authored
              ? unresolvedNumericTokens(authored, { factValues: packageFactValues(preview.packages, null) })
              : [];
            message = droppedPlace
              ? NO_SUCH_PLACE_MESSAGE
              : authored && !unsupported.length
                ? `${authored} ${answer}`
                : answer;
          }
          if (!message) message = 'Sure — heading there now.';
        } else {
          logger.warn({ sessionId, requestedRoute: routeName }, 'assistant model requested a route not offered by the client — ignoring');
          serverResult = { route: null, path: null };
          message = ROUTE_DECLINED_MESSAGE;
        }
        break;
      }
      case 'answer_faq_policy': {
        const selectedIds = new Set(Array.isArray(args.selectedSnippetIds) ? args.selectedSnippetIds : []);
        const chosen = candidateSnippets.filter((snippet) => selectedIds.has(snippet.id));
        if (routerIntent === 'sensitive') {
          serverResult = { answered: false, fallbackMessage: SENSITIVE_MESSAGE };
          message = SENSITIVE_MESSAGE;
        } else if (candidateSnippets.length === 0 || chosen.length === 0) {
          serverResult = { answered: false, fallbackMessage: FALLBACK_POLICY_MESSAGE };
          message = FALLBACK_POLICY_MESSAGE;
        } else {
          serverResult = {
            answered: true,
            snippets: chosen.map((snippet) => ({ docId: snippet.docId, title: snippet.title, quote: snippet.quote })),
          };
          if (!message) message = "Here's what I found:";
        }
        break;
      }
      case 'answer_packages': {
        const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
        const cited = (Array.isArray(args.packageIds) ? args.packageIds : [])
          .map((id) => byId.get(id))
          .filter(Boolean);
        const authored = safeGeneratedMessage(args.message);

        // Nothing to point at — the visitor named a package the catalogue does
        // not contain, or the model cited none. The reply is its own prose when
        // that prose states no unsupported number, and the honest fallback
        // otherwise. It is never the pointer below: "Here are the details." over
        // a card that will not be drawn is a sentence aimed at an empty panel,
        // which is what an ungrounded number about a non-existent package
        // produced.
        if (!cited.length) {
          const unsupported = authored
            ? unresolvedNumericTokens(authored, { factValues: packageFactValues(packages, null) })
            : [];
          serverResult = { packages: [], present: false };
          message = authored && !unsupported.length ? authored : FALLBACK_POLICY_MESSAGE;
          break;
        }

        // Every number the visitor reads must resolve to a real field. The
        // model's prose is kept only when all of its numbers do; otherwise the
        // server writes the sentence from the records themselves, so a wrong
        // price cannot reach the page by being plausible. `unresolvedNumericTokens`
        // is the standalone half of the grounding validator — the claims and
        // evidence-bundle entry point beside it expects a contract this turn
        // does not have.
        const unresolved = authored
          ? unresolvedNumericTokens(authored, { factValues: packageFactValues(cited, packageDetail) })
          : [];

        if (authored && unresolved.length) {
          logger.warn(
            { sessionId, tool, unresolved },
            'assistant package answer stated numbers that resolve to no record — replacing the prose with the records',
          );
        }

        // Whether a card is drawn is entirely the server's decision. "Has the
        // visitor seen this package yet?" is a question of state, answered from
        // the client's own list of drawn cards, and "did they ask to see it?" is
        // answered from their words. The model is asked for neither: it read the
        // prompt's "more details" as a request to see the card and redrew one on
        // a plain follow-up, which is the noise this replaces.
        const newlyCited = cited.filter((pkg) => !alreadyShown.has(pkg.id));
        let present = newlyCited.length > 0 || CARD_REQUEST_PATTERN.test(visitorText);

        // A number the records cannot support means the sentence cannot be
        // trusted, so the card carries the figures and the sentence only points
        // at it. The previous fallback recited a full summary here, which
        // re-told the visitor exactly what they had already been shown — the
        // repetition this change exists to remove.
        const groundedLine =
          cited.length === 1 ? `${cited[0].title} — the details are below.` : 'Here are the details.';
        if (unresolved.length) present = true;

        message = authored && !unresolved.length ? authored : groundedLine;

        serverResult = {
          packages: cited.map((pkg) => ({
            id: pkg.id,
            title: pkg.title,
            destination: pkg.destination,
            durationDays: pkg.durationDays,
            price: pkg.price,
            currency: pkg.currency,
            rating: pkg.rating,
            numReviews: pkg.numReviews,
          })),
          present,
        };
        break;
      }
      case 'hand_off': {
        // Booking resolves against what the visitor can actually book: the id
        // the model cited when it named one, otherwise the package the
        // conversation is already about — "book it" almost never repeats the
        // title, and refusing on that would be a dead end at the one point the
        // visitor has clearly decided.
        const target =
          args.kind === 'booking'
            ? (packages.find((pkg) => pkg.id === args.packageId) ?? subjectPackage)
            : null;
        if (!target) {
          // A person was asked for, or a booking was asked for with nothing to
          // book. Either way the honest answer is the channels, not an error.
          serverResult = { handoff: { kind: 'human' } };
          message = HUMAN_HANDOFF_MESSAGE;
          break;
        }
        serverResult = { handoff: { kind: 'booking', packageId: target.id, title: target.title } };
        message = `${BOOKING_HANDOFF_MESSAGE_PREFIX}${target.title}.`;
        break;
      }
      case 'request_booking': {
        const supplied = {};
        for (const key of BOOKING_DRAFT_KEYS) {
          if (args[key] !== undefined) supplied[key] = args[key];
        }
        // The draft accumulates across turns: a value the model did not supply
        // this turn never overwrites one an earlier turn established.
        const previousDraft = stored.ok ? stored.session.bookingDraft : {};
        const draft = { ...previousDraft, ...supplied };
        const packageRecord = packages.find((pkg) => pkg.id === draft.packageId) ?? null;
        if (packageRecord) draft.packageTitle = packageRecord.title;
        const title = draft.packageTitle || 'that package';

        // Without the session there is no draft to confirm and no record of a
        // write, so a booking is the one thing this turn cannot do. The form is
        // the honest answer rather than a guess at what the visitor wanted.
        if (!stored.ok) {
          serverResult = { booking: { status: 'unavailable' } };
          message = BOOKING_NEEDS_STORE_MESSAGE;
          break;
        }

        // One write per session. A second "yes" is answered with what already
        // happened, not resubmitted — the visitor has no way to undo a booking,
        // and the sales rep has already been emailed.
        if (stored.session.bookingStatus === 'submitted') {
          const reference = stored.session.bookingId;
          serverResult = { booking: { status: 'submitted', bookingId: reference ?? null } };
          message = reference
            ? `${BOOKING_ALREADY_SENT} — reference ${reference}.`
            : `${BOOKING_ALREADY_SENT}.`;
          break;
        }

        const missing = [];
        if (!packageRecord) missing.push('package');
        if (!bookingEmailIsVisitorOwn(draft.email, history)) missing.push('email');
        if (!isBookableDate(draft.travelDate)) missing.push('travelDate');

        if (missing.length) {
          // A confirmation is only ever a confirmation of the current draft, so
          // any change to what is still needed discards it.
          await updateSession(sessionId, { bookingDraft: draft, bookingStatus: null, bookingAskedTurn: null });
          serverResult = { booking: { status: 'needs_details', missing } };
          message = `${BOOKING_ASK_PREFIX}${title}. I still need ${missing
            .map((key) => BOOKING_NEEDS[key])
            .join(' and ')}.`;
          break;
        }

        // Confirmable only when this turn is the visitor's next message after the
        // question, that message is an affirmative, and the turn does not change
        // the draft. A confirmation is a confirmation of the summary the visitor
        // read, so "yes, make it 3 travellers" is a NEW draft: it gets a new
        // summary to confirm rather than a booking nobody has seen.
        const immediate =
          stored.session.bookingStatus === 'awaiting_confirmation' &&
          stored.session.bookingAskedTurn !== null &&
          thisTurn === stored.session.bookingAskedTurn + 1;
        // Only a value that is DIFFERENT counts. The model re-states the package
        // id on every booking turn because the prompt tells it to, and treating
        // that as a change would turn every confirmation into another question.
        const draftChanged = BOOKING_DRAFT_KEYS.some(
          (key) => supplied[key] !== undefined && supplied[key] !== previousDraft[key],
        );

        if (immediate && !draftChanged && BOOKING_AFFIRM_PATTERN.test(visitorText)) {
          const bookingBudgetMs = ASSISTANT_TURN_DEADLINE_MS - (Date.now() - startedAt) - 500;
          const booking = await submitWebsiteBooking(
            {
              packageId: draft.packageId,
              email: draft.email,
              travelDate: draft.travelDate,
              travelers: draft.travelers ?? 1,
              ...(draft.endDate && { endDate: draft.endDate }),
              ...(draft.name && { name: draft.name }),
              ...(draft.phone && { phone: draft.phone }),
            },
            { signal: AbortSignal.timeout(Math.max(1, bookingBudgetMs)) },
          );

          if (booking.ok) {
            await updateSession(sessionId, {
              bookingDraft: draft,
              bookingStatus: 'submitted',
              bookingId: booking.bookingId,
              bookingAskedTurn: null,
            });
            serverResult = { booking: { status: 'submitted', bookingId: booking.bookingId } };
            message = `${BOOKING_SENT_PREFIX}${title}${BOOKING_SENT_SUFFIX}${
              booking.bookingId ? ` Reference ${booking.bookingId}.` : ''
            }`;
          } else if (booking.reason === 'rejected') {
            // The service refused the payload, so the details are the problem:
            // clear the confirmation and keep the draft for the visitor to fix.
            await updateSession(sessionId, { bookingDraft: draft, bookingStatus: null, bookingAskedTurn: null });
            serverResult = { booking: { status: 'rejected' } };
            message = BOOKING_REJECTED_MESSAGE;
          } else {
            // Nothing was written. The draft is kept and the anchor moves to this
            // turn, so the reply's "say try again" is a single turn away rather
            // than another round of confirmation.
            await updateSession(sessionId, {
              bookingDraft: draft,
              bookingStatus: 'awaiting_confirmation',
              bookingAskedTurn: thisTurn,
            });
            serverResult = { booking: { status: 'unavailable' } };
            message = BOOKING_UNAVAILABLE_MESSAGE;
          }
          break;
        }

        // Everything else re-asks with the summary. The anchor moves to this turn
        // every time, because every re-ask IS a fresh question — whether the
        // draft was corrected or the visitor said something else in between, the
        // line they are reading now is the one a "yes" would confirm. Leaving the
        // anchor behind would make that "yes" arrive one turn too late and ask
        // again, forever.
        await updateSession(sessionId, {
          bookingDraft: draft,
          bookingStatus: 'awaiting_confirmation',
          bookingAskedTurn: thisTurn,
        });
        serverResult = {
          booking: {
            status: 'awaiting_confirmation',
            draft: {
              title,
              email: draft.email,
              travelDate: draft.travelDate,
              endDate: draft.endDate ?? null,
              travelers: draft.travelers ?? 1,
            },
          },
        };
        message = `${bookingSummary(draft, title)}${BOOKING_CONFIRM_SUFFIX}`;
        break;
      }
      case 'respond_conversationally':
        if (args.mode === 'capability') {
          // Entirely server-authored copy, so unlike travel_general there is
          // nothing here for the router hint to qualify.
          serverResult = { mode: 'capability', source: 'resolver' };
          message = capabilitiesMessage({
            pageActionsOffered: offeredActions.length > 0,
            travelSearchEnabled: searchEnabled,
            routesOffered: (availableRoutes ?? []).map((route) => route.name),
          });
        } else if (args.mode === 'travel_general' && (routerIntent === 'travel_general' || routerIntent === null)) {
          // The canonicalizer lets this mode through unchanged when the router
          // did not run, so this gate has to agree with it: `null` is a router
          // that was off or rate-limited, not a router that disagreed. Without
          // this the turn kept falling through to the social repair copy.
          const prose = safeGeneratedMessage(args.message);
          if (SENSITIVE_CLAIM_PATTERN.test(prose)) {
            logger.warn(
              { sessionId, tool },
              'assistant travel answer cited the sensitive surface — replaced with the reviewed copy',
            );
            serverResult = { mode: 'social', source: 'resolver' };
            message = SENSITIVE_MESSAGE;
          } else {
            serverResult = { mode: 'travel_general', source: 'resolver' };
            message = prose;
          }
        } else if (args.socialSubtype === 'repair' && routerResult?.classification?.hasActionableClause) {
          // The visitor asked for something and the reply was "tell me what
          // you're trying to do". A repair reply is honest only when there was
          // nothing to act on; when the router saw an actionable clause, say
          // what could not be done and what can.
          serverResult = { mode: 'social', source: 'resolver' };
          message = ACTIONABLE_UNSUPPORTED_MESSAGE;
        } else {
          serverResult = { mode: 'social', source: 'resolver' };
          message = SOCIAL_MESSAGES[args.socialSubtype];
        }
        break;
      case 'redirect_off_topic':
        serverResult = { redirected: true, source: 'resolver' };
        message = OFF_TOPIC_MESSAGE;
        break;
      // ── Client-executed page actions ────────────────────────────────────
      // The server's part is to name the action, hand over the arguments it
      // validated, and stamp which page they belong to. Execution, and every
      // judgement about whether the named thing exists, belongs to the page.
      case 'set_destination':
      case 'set_travellers':
      case 'set_preferences':
      case 'set_contact_details':
      case 'go_to_step':
      case 'generate_itinerary':
      case 'regenerate_days':
      case 'edit_day':
      case 'prefill_form': {
        const { message: actionMessage, ...actionArgs } = args;
        serverResult = {
          action: { tool, ...actionArgs },
          revision: typeof pageContext?.revision === 'string' ? pageContext.revision : null,
          surface: typeof capabilities?.surface === 'string' ? capabilities.surface : null,
        };
        // An empty line here would be replaced by the "I didn't quite catch
        // that" fallback about an action that is about to run.
        if (!actionMessage) message = PAGE_ACTION_MESSAGE_DEFAULTS[tool];
        break;
      }
      // ── Server-composed answer about the screen ─────────────────────────
      case ASSISTANT_VIEW_TOOL: {
        // The model chose the outcome and authored nothing: no arguments, no
        // numbers. Everything the visitor reads here comes from the page's own
        // report, relayed.
        serverResult = { view: currentView ?? null };
        message = describeCurrentView(currentView);
        break;
      }
      // ── Server-executed grounded travel answer ──────────────────────────
      case 'search_travel_info': {
        if (!searchEnabled) {
          message = SEARCH_DISABLED_MESSAGE;
          break;
        }
        const query = sanitizeSearchQuery(args.query);
        if (!isTravelDomainQuery(query)) {
          logger.info({ sessionId, query }, 'assistant search refused: outside the travel domain');
          message = OFF_DOMAIN_SEARCH_MESSAGE;
          break;
        }
        // The gate reads the visitor's words; the provider gets them as a search
        // phrase. The model often words its query as a question, and a question
        // in that slot makes the grounded call answer from memory instead of
        // searching — measured, not assumed.
        const searchPhrase = toSearchPhrase(query);
        // Up to two attempts, each bounded by what is left of the turn. Whether
        // the provider searches is the model's decision and there is no setting to
        // force it, so a call can come back as prose with no sources; asking once
        // more is the only lever, and it stays inside the same deadline.
        let grounded = null;
        for (let attempt = 1; attempt <= SEARCH_ATTEMPTS && !grounded; attempt += 1) {
          const searchBudgetMs = remainingBudgetMs - 1_000;
          if (searchBudgetMs < MIN_SEARCH_BUDGET_MS) break;
          try {
            grounded = await generateGrounded({
              prompt: buildTravelSearchPrompt(searchPhrase),
              timeoutMs: Math.min(GROUNDING_TIMEOUT_MS, searchBudgetMs),
            });
          } catch (err) {
            logger.warn({ err, sessionId, attempt }, 'Grounded travel search failed');
            // Only a source-less answer is worth asking again for: a provider
            // error or a timeout will not turn into a search on the retry.
            if (err?.groundingMissing !== true) break;
          }
        }

        if (grounded) {
          serverResult = { searched: true, query, citations: grounded.citations };
          // The model's own line is discarded: prose about current conditions is
          // exactly the failure this tool replaces.
          message = `${grounded.text}${SEARCH_ADVISORY_SUFFIX}`;
        } else {
          message = SEARCH_FAILED_MESSAGE;
        }
        break;
      }
      default:
        throw new AppError('AI returned an unrecognized tool', BAD_GATEWAY);
    }

    if (!message) message = NO_MESSAGE_FALLBACK;
    else if (message.length > MAX_MESSAGE_LENGTH) message = message.slice(0, MAX_MESSAGE_LENGTH);

    // Persist the turn here, after the message is final and only on a path that
    // is about to answer. A turn that throws stores nothing, so a failed turn
    // never becomes the conversation.
    //
    // The assistant message id is derived from the turn, not generated: a retry
    // of the same turn produces the same id, and the store's duplicate skip
    // turns that into a no-op rather than a second copy in the transcript.
    const appended = await appendTurn(sessionId, [
      { id: latestTurn.id, role: 'user', content: latestTurn.content },
      { id: `${turnId ?? latestTurn.id}-a`, role: 'assistant', content: message },
    ]);
    if (appended.ok) {
      const presentation = Array.isArray(serverResult?.packages) && serverResult.present === true
        ? serverResult.packages.map((pkg) => pkg.id).filter((id) => typeof id === 'string')
        : [];
      await updateSession(sessionId, {
        shownPackageIds: [...new Set([...alreadyShown, ...presentation])],
        turnCount: thisTurn,
      });
    }

    if (turnId) {
      const classification = routerResult?.classification;
      await recordAssistantResolution({
        sessionId,
        turnId,
        tool,
        route: tool === 'navigate' && typeof serverResult?.route === 'string' ? serverResult.route : null,
        metadata: {
          ...(routerResult && {
            routerVersion: routerResult.version,
            routerModel: routerResult.model,
            predictedIntent: classification.intent,
            socialSubtype: classification.socialSubtype,
            confidenceBucket: confidenceBucket(classification.confidence),
            committed: false,
            abstainReason: routerResult.decision.reason,
            stageOneLatencyMs: Math.min(routerResult.latencyMs, ASSISTANT_TURN_DEADLINE_MS),
          }),
          finalStageTwoTool: tool,
          stageTwoLatencyMs: Math.min(Date.now() - stageTwoStartedAt, ASSISTANT_TURN_DEADLINE_MS),
          // How far the booking got, which no other field records: `tool` says
          // the model asked to book, and this says whether anyone was asked to
          // confirm, refused, or written.
          ...(tool === 'request_booking' && { bookingStatus: serverResult?.booking?.status ?? null }),
          fallbackUsed:
            routerIntent === 'sensitive' ||
            (tool === 'navigate' && serverResult?.route === null) ||
            (tool === 'answer_faq_policy' && serverResult?.answered === false) ||
            // Asked to book, answered with a person: the handoff happened, but
            // not the one that was asked for.
            (tool === 'hand_off' && args.kind === 'booking' && serverResult?.handoff?.kind === 'human') ||
            // Asked to book, and the booking did not happen: the visitor was
            // asked for something, refused, or told to try again.
            (tool === 'request_booking' && serverResult?.booking?.status !== 'submitted'),
          ...(routerFailureCategory && { failureCategory: routerFailureCategory }),
        },
      });
    }
    res.json({ success: true, data: { toolCall: { tool, args }, serverResult, message } });
  } catch (err) {
    if (turnId) {
      await recordAssistantResolution({
        sessionId,
        turnId,
        tool: null,
        route: null,
        metadata: {
          ...(routerResult && {
            routerVersion: routerResult.version,
            routerModel: routerResult.model,
            predictedIntent: routerResult.classification.intent,
            socialSubtype: routerResult.classification.socialSubtype,
            confidenceBucket: confidenceBucket(routerResult.classification.confidence),
            committed: false,
            abstainReason: routerResult.decision.reason,
            stageOneLatencyMs: Math.min(routerResult.latencyMs, ASSISTANT_TURN_DEADLINE_MS),
          }),
          stageTwoLatencyMs: Math.min(Date.now() - startedAt, ASSISTANT_TURN_DEADLINE_MS),
          fallbackUsed: false,
          failureCategory: resolutionFailureCategory(err),
        },
      });
    }
    throw err;
  }
});

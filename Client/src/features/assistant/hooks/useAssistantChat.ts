import { useState } from 'react';
import { sendAssistantTurn } from '../../../services/api/assistantTurn';
import type { AssistantTurnMessageT, AssistantTurnResultT } from '../../../services/api/assistantTurn';
import { sendAssistantEvent } from '../../../services/api/assistantEvents';
import type { AssistantEventPayload } from '../../../services/api/assistantEvents';
import { getEnabledAssistantRoutes } from '../../../config/assistantRoutes';
import { ASSISTANT_PAGE_ACTIONS } from '@travel-crm/contracts';
import { loadAssistantParamValues } from '../assistantParamValues';
import { useAssistantCapabilities, useAssistantCurrentView } from '../capabilities/AssistantCapabilityProvider';
import type { AssistantCurrentViewValue } from '../capabilities/AssistantCapabilityProvider';
import type { AssistantPageRegistration } from '../capabilities/AssistantCapabilityProvider';
import { resolveHeldPrefill, runAssistantAction } from '../actions/runAssistantAction';
import type { PendingPrefill } from '../actions/runAssistantAction';
import { apiErrorMessage } from '../../../services/http/apiErrorMessage';

// Sliding window resent to the stateless assistant-service each turn — same
// reasoning as useTripWizard's MAX_SENT_MESSAGES. Older turns still show in
// the widget transcript; only the most recent 20 go as model context.
const MAX_SENT_MESSAGES = 20;
// Matches the server's content.max(2000) on both wire schemas (assistant.schema.js,
// assistantTurn.ts) — clamped here (not just via the input's maxLength) so a
// paste that bypasses the input attribute can never enter React state as a
// message that would fail validation on every later resend (/ship red-team:
// an unsendable message stuck in the sliding window bricks the session).
const MAX_MESSAGE_LENGTH = 2000;
const ASSISTANT_SESSION_KEY = 'travel-crm.assistantSessionId';

// Distinct from the trip-planning assistant's fallback — this widget talks to
// the phase-1 site-wide assistant-service, not the planner wizard.
export interface AssistantSnippet {
  docId: string;
  title: string;
  quote: string;
}

/**
 * Where a handoff sends the visitor. The server resolves the kind — and, for a
 * booking, which package — and the client builds the URL from it, because URL
 * shape is the client's to own. That is the same split as the package card
 * below, which builds `/package/<id>` here rather than being handed one.
 */
export type AssistantHandoff =
  | { kind: 'booking'; packageId: string; title: string }
  | { kind: 'human' };

/**
 * How far a booking request got. The server owns this entirely — the model
 * reports what it read and nothing else — so the widget only decides whether to
 * offer the one-tap confirmation. `needs_details` deliberately renders nothing:
 * a status the client did not recognise must never look like a confirmation.
 */
export interface AssistantBooking {
  status: 'needs_details' | 'awaiting_confirmation' | 'submitted';
  missing?: string[];
}

// Server-resolved, deterministic per-turn data the widget renders under the
// assistant bubble. Never derived from raw model args: a navigate chip only
// exists when the server resolved the requested route against the allowlist
// the client sent (serverResult.route/path non-null); the model never authors
// policy text, so a no-match FAQ turn carries the server's fallback message.
export type AssistantTurnData =
  | { tool: 'navigate'; route: string; path: string }
  | { tool: 'navigate'; route: null; path: null }
  | { tool: 'answer_faq_policy'; answered: true; snippets: AssistantSnippet[] }
  | { tool: 'answer_faq_policy'; answered: false; fallbackMessage: string }
  | { tool: 'answer_packages'; packages: AssistantPackageCard[] }
  | { tool: 'hand_off'; handoff: AssistantHandoff }
  | { tool: 'request_booking'; booking: AssistantBooking }
  | { tool: 'respond_conversationally'; mode: 'social' | 'travel_general' | 'capability' }
  | { tool: 'redirect_off_topic'; redirected: true }
  // A page action the client is about to run (or has just run). `announcement`
  // starts empty and is filled in with what the page reported, so the bubble
  // never claims a change before the page has made one. `pending` is a form fill
  // held back because the visitor's own text is in the way.
  | { tool: 'page_action'; revision: string | null; announcement: string; pending?: PendingPrefill | null }
  // A web-grounded travel answer. The reply text is the message; these are the
  // sources the server extracted from the provider's grounding metadata.
  | { tool: 'search_travel_info'; citations: AssistantCitation[] }
  // An answer about the screen. The sentence is the server's; these are the
  // page's own numbers, relayed, for the summary block under the bubble.
  | { tool: 'answer_current_view'; view: AssistantViewSummary };

/** The page's own numbers, as the view-summary block renders them. */
export interface AssistantViewSummary {
  count: number | null;
  renderedCount: number | null;
  params: { key: string; value: string }[];
}

/** One source under a grounded answer. Validated again here: the widget turns it into a link. */
export interface AssistantCitation {
  title: string;
  uri: string;
}

/**
 * One package the assistant answered about, rendered under the reply as a card
 * with a link. The `id` is only ever used to build that link — it is a uuid and
 * is never shown to the visitor.
 */
export interface AssistantPackageCard {
  id: string;
  title: string;
  destination: string;
  durationDays: number;
  price: number;
  currency: string;
  rating: number;
  numReviews: number;
}

export interface AssistantTurnView {
  assistantMessageId: string;
  data: AssistantTurnData;
}

// A stable per-browser session id, persisted so a page reload resumes the
// same session instead of forking a brand-new anonymous identity on the
// telemetry side. Falls back to a fresh id if localStorage is unavailable
// (privacy mode / opaque origin) — the widget still works, just without
// cross-reload identity. Mirrors useTripWizard's loadOrCreateSessionId.
function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(ASSISTANT_SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(ASSISTANT_SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// Every message gets a stable id (assigned once, never regenerated on a
// resent sliding-window slice) and an `at` timestamp, so the server can diff
// a resent window against what the client already showed.
function createMessage(role: 'user' | 'assistant', content: string): AssistantTurnMessageT {
  return { id: crypto.randomUUID(), role, content, at: new Date().toISOString() };
}

function fireEvent(
  sessionId: string,
  turnId: string | null,
  eventType: AssistantEventPayload['eventType'],
  tool: AssistantEventPayload['tool'],
  route: string | null,
) {
  const payload: AssistantEventPayload = { sessionId, turnId, eventType, tool, route };
  void sendAssistantEvent(payload);
}

// A citation is renderable only as a real link. The server already dropped
// anything that was not http(s); this repeats the check where the anchor is
// actually built, because a javascript: URL in an href is a script execution,
// not a bad link.
const CITATION_SCHEME = /^https?:\/\//i;

function deriveCitations(serverResult: Record<string, unknown> | null | undefined): AssistantCitation[] {
  const raw = serverResult?.citations;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      title: typeof entry.title === 'string' ? entry.title : '',
      uri: typeof entry.uri === 'string' ? entry.uri : '',
    }))
    .filter((citation) => CITATION_SCHEME.test(citation.uri))
    .slice(0, 5)
    .map((citation) => ({ ...citation, title: citation.title || citation.uri }));
}

// The view the page reports, sanitised to what the shared schema accepts BEFORE
// it leaves the browser. This is a request field, so a value the schema rejects
// fails the whole turn's parse rather than dropping one entry — an out-of-bounds
// count or a newline in a query parameter would cost the visitor the assistant,
// not one number.
const VIEW_PARAM_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const MAX_VIEW_PARAMS = 20;
const MAX_VIEW_COUNT = 100_000;

const sanitiseViewParams = (source: Record<string, unknown> | undefined): Record<string, string> => {
  const params: Record<string, string> = {};
  if (!source) return params;
  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(params).length >= MAX_VIEW_PARAMS) break;
    if (!VIEW_PARAM_KEY.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 200) continue;
    params[key] = value;
  }
  return params;
};

const sanitiseCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_VIEW_COUNT, Math.trunc(value)))
    : undefined;

/**
 * The page state a turn carries, from the mounted page's own report when there is
 * one and from the browser's own location otherwise. The baseline is deliberate:
 * every page can say where it is, and only a page that can count says how many.
 */
function buildCurrentView(reported: AssistantCurrentViewValue | null): AssistantCurrentViewValue {
  const raw = reported ?? {
    path: window.location.pathname,
    params: Object.fromEntries(new URLSearchParams(window.location.search)),
  };
  const params = sanitiseViewParams(raw.params);
  const path = `${raw.path ?? ''}`.startsWith('/') ? `${raw.path}` : `/${raw.path ?? ''}`;
  const filteredCount = sanitiseCount(raw.filteredCount);
  const renderedCount = sanitiseCount(raw.renderedCount);
  const catalogueTotal = sanitiseCount(raw.catalogueTotal);

  return {
    path: (path || '/').slice(0, 200),
    ...(Object.keys(params).length ? { params } : {}),
    ...(filteredCount !== undefined ? { filteredCount } : {}),
    ...(renderedCount !== undefined ? { renderedCount } : {}),
    ...(catalogueTotal !== undefined ? { catalogueTotal } : {}),
  };
}

function deriveTurnData(result: AssistantTurnResultT): AssistantTurnData {
  const serverResult = result.serverResult as
    | {
        answered?: unknown;
        snippets?: unknown;
        fallbackMessage?: unknown;
        route?: unknown;
        path?: unknown;
        mode?: unknown;
        redirected?: unknown;
        packages?: unknown;
        present?: unknown;
        handoff?: unknown;
        booking?: unknown;
        // The view answer's payload: the page's own report, relayed by the server.
        view?: unknown;
      }
    | null
    | undefined;

  if (result.toolCall.tool === 'navigate') {
    const route = typeof serverResult?.route === 'string' ? serverResult.route : null;
    const path = typeof serverResult?.path === 'string' ? serverResult.path : null;
    if (route && path) return { tool: 'navigate', route, path };
    // Model picked a route the client never offered (or the server declined
    // it) — nothing executable to render, the bubble text carries the reply.
    return { tool: 'navigate', route: null, path: null };
  }

  if (result.toolCall.tool === 'respond_conversationally') {
    // Preserved rather than collapsed: the server distinguishes the two
    // self-authored modes, and narrowing either to social here would throw
    // away the only signal the widget has about which one it answered with.
    const raw = serverResult?.mode;
    const mode = raw === 'travel_general' || raw === 'capability' ? raw : 'social';
    return { tool: 'respond_conversationally', mode };
  }

  if (result.toolCall.tool === 'redirect_off_topic') {
    return { tool: 'redirect_off_topic', redirected: true };
  }

  if (result.toolCall.tool === 'answer_current_view') {
    const raw = serverResult?.view;
    const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const params =
      entry && entry.params && typeof entry.params === 'object'
        ? Object.entries(entry.params as Record<string, unknown>)
            .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
            .slice(0, MAX_VIEW_PARAMS)
            .map(([key, value]) => ({ key, value: value as string }))
        : [];

    return {
      tool: 'answer_current_view',
      view: {
        count: typeof entry?.filteredCount === 'number' ? entry.filteredCount : null,
        renderedCount: typeof entry?.renderedCount === 'number' ? entry.renderedCount : null,
        params,
      },
    };
  }

  if (result.toolCall.tool === 'search_travel_info') {
    return { tool: 'search_travel_info', citations: deriveCitations(result.serverResult) };
  }

  if (ASSISTANT_PAGE_ACTIONS.includes(result.toolCall.tool)) {
    // The arguments themselves are read from serverResult by the runner, which
    // re-validates them against the shared action contract before the page sees
    // anything. What is carried here is only what the widget renders.
    const revision = result.serverResult?.revision;
    return { tool: 'page_action', revision: typeof revision === 'string' ? revision : null, announcement: '' };
  }

  if (result.toolCall.tool === 'answer_packages') {
    const packages = (Array.isArray(serverResult?.packages) ? serverResult.packages : [])
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .filter((entry) => typeof entry.id === 'string' && entry.id && typeof entry.title === 'string' && entry.title)
      .map((entry) => ({
        id: entry.id as string,
        title: entry.title as string,
        destination: typeof entry.destination === 'string' ? entry.destination : '',
        durationDays: Number(entry.durationDays) || 0,
        price: Number(entry.price) || 0,
        currency: typeof entry.currency === 'string' && entry.currency ? entry.currency : 'USD',
        rating: Number(entry.rating) || 0,
        numReviews: Number(entry.numReviews) || 0,
      }));

    // Every package answer carries the records it was about; whether a card is
    // drawn is the server's call, made from what the visitor has already been
    // shown. So an empty card list is the ordinary "nothing to draw this turn"
    // outcome and must not render a panel — only the first introduction of a
    // package, or an explicit request to see one, draws a card.
    if (serverResult?.present !== true) return { tool: 'answer_packages', packages: [] };

    if (packages.length) return { tool: 'answer_packages', packages };

    // Presenting with nothing renderable is a malformed payload rather than a
    // deliberate empty, so it degrades to the server's own fallback line.
    return {
      tool: 'answer_faq_policy',
      answered: false,
      fallbackMessage: typeof serverResult?.fallbackMessage === 'string' ? serverResult.fallbackMessage : '',
    };
  }

  if (result.toolCall.tool === 'hand_off') {
    const raw = serverResult?.handoff;
    const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    if (entry?.kind === 'booking' && typeof entry.packageId === 'string' && entry.packageId) {
      return {
        tool: 'hand_off',
        handoff: {
          kind: 'booking',
          packageId: entry.packageId,
          title: typeof entry.title === 'string' ? entry.title : '',
        },
      };
    }
    // Everything else is a handoff to a person. `human` is what the server
    // falls back to whenever it cannot book, so an unrecognised payload still
    // renders the one chip that always works rather than nothing at all.
    return { tool: 'hand_off', handoff: { kind: 'human' } };
  }

  if (result.toolCall.tool === 'request_booking') {
    const raw = serverResult?.booking;
    const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const status = entry?.status;
    if (status === 'awaiting_confirmation' || status === 'submitted') {
      return { tool: 'request_booking', booking: { status } };
    }
    // Everything else means the server still needs something. That renders no
    // chip, so an unrecognised status is inert rather than an invitation to
    // send a booking.
    return {
      tool: 'request_booking',
      booking: {
        status: 'needs_details',
        missing: Array.isArray(entry?.missing) ? entry.missing.filter((key) => typeof key === 'string') : undefined,
      },
    };
  }

  if (serverResult?.answered === true) {
    const snippets = (Array.isArray(serverResult.snippets) ? serverResult.snippets : []) as AssistantSnippet[];
    return { tool: 'answer_faq_policy', answered: true, snippets };
  }

  const fallbackMessage = typeof serverResult?.fallbackMessage === 'string' ? serverResult.fallbackMessage : '';
  return { tool: 'answer_faq_policy', answered: false, fallbackMessage };
}

export function useAssistantChat() {
  const [sessionId, setSessionId] = useState(loadOrCreateSessionId);
  // The mounted page's registration, READ AT SEND TIME: the store holds a ref,
  // not state, so capturing it here during render would miss a page that mounted
  // after this component last rendered.
  const getRegistration = useAssistantCapabilities();
  const getView = useAssistantCurrentView();
  const [messages, setMessages] = useState<AssistantTurnMessageT[]>([]);
  // One view per successful assistant reply, joined to the assistant message
  // by id — nav chips/FAQ text from earlier turns stay rendered even after a
  // later turn errors (they are static client-side data by then).
  const [turns, setTurns] = useState<AssistantTurnView[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  const clearChat = () => {
    setMessages([]);
    setTurns([]);
    setError('');
  };

  const startNewChat = () => {
    clearChat();
    const nextSessionId = crypto.randomUUID();
    setSessionId(nextSessionId);
    try {
      localStorage.setItem(ASSISTANT_SESSION_KEY, nextSessionId);
    } catch {
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed || isSending) return;
    const userMessage = createMessage('user', trimmed);
    const nextMessages = [...messages, userMessage].slice(-MAX_SENT_MESSAGES);
    const registration: AssistantPageRegistration | null = getRegistration();

    setMessages((prev) => [...prev, userMessage]);
    setError('');
    setIsSending(true);
    fireEvent(sessionId, userMessage.id, 'turn', null, null);

    try {
      // Loaded before the turn because the server checks the destination the
      // model chose against it. Never throws and is memoized for the visit, so
      // this is one request per visit rather than one per message.
      const paramValues = await loadAssistantParamValues();
      const availableRoutes = getEnabledAssistantRoutes().map((route) =>
        paramValues[route.name] ? { ...route, paramValues: paramValues[route.name] } : route,
      );
      // Which cards this session has already drawn. Read from `turns` rather
      // than tracked separately: an entry carries packages exactly when a card
      // was drawn for it, so the two cannot disagree. The server needs it
      // because a package the visitor has already seen is not re-presented.
      const shownPackageIds = turns.flatMap((turn) =>
        turn.data.tool === 'answer_packages' ? turn.data.packages.map((pkg) => pkg.id) : [],
      );
      const result = await sendAssistantTurn({
        sessionId,
        messages: nextMessages,
        availableRoutes,
        shownPackageIds,
        capabilities: registration
          ? { version: 1, surface: registration.surface, actions: registration.actions }
          : undefined,
        pageContext: registration?.pageContext,
        // Sent every turn: the server is stateless, the report is bounded, and
        // "only when it changes" would need the client to hold state the server
        // must still tolerate missing.
        currentView: buildCurrentView(getView()),
      });
      // Defense-in-depth: the server now guarantees a non-empty,
      // length-capped message (never-empty + MAX_MESSAGE_LENGTH guard in
      // assistant.controller.js), but never store an empty or oversized
      // bubble here either — content.min(1)/.max(2000) would otherwise
      // reject it on every later resend and brick the session (/ship
      // red-team + Claude adversarial review).
      const assistantMessage = createMessage('assistant', (result.message || '...').slice(0, MAX_MESSAGE_LENGTH));
      const turnData = deriveTurnData(result);
      setMessages((prev) => [...prev, assistantMessage]);
      setTurns((prev) => [...prev, { assistantMessageId: assistantMessage.id, data: turnData }]);
      const route = result.toolCall.tool === 'navigate' ? ((result.toolCall.args.route as string | undefined) ?? null) : null;
      fireEvent(sessionId, userMessage.id, 'response', result.toolCall.tool, route);

      // The page executes what the server named. Awaited inside the try, so
      // `isSending` stays true for the whole action: a second message must not
      // start while the itinerary is being rebuilt underneath it.
      if (turnData.tool === 'page_action') {
        const actionArgs = result.serverResult?.action;
        const outcome = await runAssistantAction({
          registration,
          tool: result.toolCall.tool,
          args: actionArgs && typeof actionArgs === 'object' ? (actionArgs as Record<string, unknown>) : {},
          revision: turnData.revision,
        });
        if (outcome.announcement || outcome.pending) {
          setTurns((prev) =>
            prev.map((turn) =>
              turn.assistantMessageId === assistantMessage.id && turn.data.tool === 'page_action'
                ? {
                    ...turn,
                    data: {
                      ...turn.data,
                      announcement: outcome.announcement || turn.data.announcement,
                      pending: outcome.pending ?? null,
                    },
                  }
                : turn,
            ),
          );
        }
      }
    } catch (err) {
      setError(apiErrorMessage(err));
      fireEvent(sessionId, userMessage.id, 'error', null, null);
    } finally {
      setIsSending(false);
    }
  };

  // The confirm chip's own action. Deliberately not a turn: the values it applies
  // are already in the browser, and "keep mine" is a decision to do nothing.
  const resolvePrefill = (assistantMessageId: string, choice: 'replace' | 'keep') => {
    const turn = turns.find((entry) => entry.assistantMessageId === assistantMessageId);
    const pending = turn?.data.tool === 'page_action' ? turn.data.pending : null;
    if (!pending) return;

    const outcome = resolveHeldPrefill({ registration: getRegistration(), pending, choice });
    setTurns((prev) =>
      prev.map((entry) =>
        entry.assistantMessageId === assistantMessageId && entry.data.tool === 'page_action'
          ? { ...entry, data: { ...entry.data, announcement: outcome.announcement, pending: null } }
          : entry,
      ),
    );
  };

  return { messages, turns, sessionId, isSending, error, sendMessage, resolvePrefill, clearChat, startNewChat };
}

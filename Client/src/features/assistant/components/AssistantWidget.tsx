import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, Loader2, Plus, Send, Trash2, User, X } from 'lucide-react';
import { useAssistantChat } from '../hooks/useAssistantChat';
import type { AssistantTurnData } from '../hooks/useAssistantChat';
import type { AssistantTurnMessageT } from '../../../services/api/assistantTurn';
import { sendAssistantEvent } from '../../../services/api/assistantEvents';
import { ASSISTANT_PANEL_BOTTOM_OFFSET_PX } from '../../../config/floatingActions';
import { isAssistantExcludedPath } from '../../../config/assistantRoutes';
import { Badge } from '../../../components/ui/badge';
import { formatCurrency } from '../../../lib/currency';
import useLenisScrollContainment from '../../../lib/useLenisScrollContainment';
import { setAssistantLauncherOpen, useAssistantLauncherOpen } from '../../../components/shared/floating-actions/assistantLauncherState';
import { useAssistantDialogHost } from '../capabilities/AssistantCapabilityProvider';

const routeLabel = (route: string): string => route.charAt(0).toUpperCase() + route.slice(1);

// The filter chips under a count answer. The map exists so a chip reads like the
// page's own control rather than like a query parameter; a key it does not know
// is humanised from its own name, and the value is always shown as the page
// reported it — the one thing this block must not do is paraphrase a number or a
// filter into something the page did not say.
const FILTER_LABELS: Record<string, string> = {
  destination: 'Destination',
  category: 'Category',
  priceMax: 'Under',
  priceMin: 'From',
  durationMax: 'Up to',
  durationMin: 'At least',
  rating: 'Rating',
  sort: 'Sorted by',
  view: 'View',
  page: 'Page',
};

const filterLabel = (key: string, value: string): string => {
  const name = FILTER_LABELS[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  if (/^\d+$/.test(value) && (key === 'priceMin' || key === 'priceMax')) {
    return `${name} ${formatCurrency(Number(value))}`;
  }
  if (key === 'durationMin' || key === 'durationMax') return `${name} ${value} days`;
  return `${name}: ${value}`;
};

const GREETING =
  "Hi! I can help you find a package, build a custom trip with AI, or answer questions about LushWare. What are you planning?";

const PANEL_CLASS =
  'pointer-events-auto flex h-[min(28rem,calc(100dvh-8rem))] w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-floating';
const CHIP_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50';
const SEND_BUTTON_CLASS =
  'w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center transition-colors hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600';
const INPUT_CLASS =
  'flex-1 px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50';

interface AssistantTurnExtrasProps {
  data: AssistantTurnData;
  onNavigate: (route: string, path: string) => void;
  onSendMessage: (text: string) => void;
  onResolvePrefill: (choice: 'replace' | 'keep') => void;
}

function AssistantTurnExtras({ data, onNavigate, onSendMessage, onResolvePrefill }: AssistantTurnExtrasProps) {
  if (data.tool === 'navigate') {
    if (!data.path) return null;
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onNavigate(data.route, data.path)} className={CHIP_CLASS}>
          <ArrowRight className="w-3 h-3" />
          Go to {routeLabel(data.route)}
        </button>
      </div>
    );
  }

  if (data.tool === 'page_action' && data.pending && Object.keys(data.pending.fields).length > 0) {
    // The collision confirm: a control inside the bubble, not a turn. Two buttons
    // at the button radius, each a 44px target, keyboard operable, and "keep mine"
    // leaves the visitor's own text exactly as it was.
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => onResolvePrefill('replace')}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-brand-200 bg-white px-3 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
        >
          Replace it
        </button>
        <button
          type="button"
          onClick={() => onResolvePrefill('keep')}
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Keep mine
        </button>
      </div>
    );
  }

  if (data.tool === 'answer_current_view') {
    const { count, renderedCount, params } = data.view;
    // Nothing to summarise: the page could not count and named no filters, so the
    // reply text is the whole answer.
    if (count === null && params.length === 0) return null;

    return (
      <div className="mt-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
        {count !== null && (
          <p className="font-display text-display-md leading-none text-brand-600">{count.toLocaleString('en-US')}</p>
        )}
        {params.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {params.map(({ key, value }) => (
              <Badge key={`${key}:${value}`} variant="outline">
                {filterLabel(key, value)}
              </Badge>
            ))}
          </div>
        )}
        {count !== null && typeof renderedCount === 'number' && renderedCount < count && (
          <p className="mt-1 text-sm text-gray-600">{renderedCount.toLocaleString('en-US')} shown so far</p>
        )}
      </div>
    );
  }

  if (data.tool === 'answer_packages') {
    if (!data.packages.length) return null;
    return (
      <div className="space-y-2 pt-1">
        {data.packages.map((pkg) => {
          // Matches the server's own formatting, so a card and the reply beside
          // it cannot show the same price two different ways.
          let price = '';
          if (pkg.price > 0) {
            try {
              price = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: /^[A-Za-z]{3}$/.test(pkg.currency) ? pkg.currency.toUpperCase() : 'USD',
                maximumFractionDigits: 0,
              }).format(pkg.price);
            } catch {
              price = String(Math.round(pkg.price));
            }
          }

          return (
            <div key={pkg.id} className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
              <p className="text-sm font-semibold text-gray-900">{pkg.title}</p>
              <p className="text-xs text-gray-600">
                {[
                  pkg.destination,
                  pkg.durationDays > 0 ? `${pkg.durationDays} days` : '',
                  price,
                  pkg.numReviews > 0 ? `${pkg.rating} from ${pkg.numReviews} reviews` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2 pt-1.5">
                <button
                  type="button"
                  onClick={() => onNavigate('package', `/package/${pkg.id}`)}
                  className={CHIP_CLASS}
                >
                  <ArrowRight className="w-3 h-3" />
                  View
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (data.tool === 'request_booking') {
    // One tap instead of typing "yes". The text is the literal the server's
    // affirmation pattern matches, and it travels as a normal user message, so
    // the confirmation is still something the visitor said.
    if (data.booking.status !== 'awaiting_confirmation') return null;
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onSendMessage('Yes, send it')} className={CHIP_CLASS}>
          <ArrowRight className="w-3 h-3" />
          Send booking request
        </button>
      </div>
    );
  }

  if (data.tool === 'respond_conversationally' || data.tool === 'redirect_off_topic') {
    return null;
  }

  if (data.tool === 'page_action') {
    // The page executed this, so the sentence is the page's own report of what
    // it did — or of why it did not. Nothing is rendered while the action is
    // still running: the page's own spinner is the pending signal, and a
    // "working on it" line here would be the second place a change is claimed.
    if (!data.announcement) return null;
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
        <p className="text-sm text-gray-700">{data.announcement}</p>
      </div>
    );
  }

  if (data.tool === 'search_travel_info') {
    if (data.citations.length === 0) return null;
    return (
      <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Sources</p>
        <ul className="mt-1 space-y-1">
          {data.citations.map((citation) => (
            <li key={citation.uri}>
              <a
                href={citation.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-brand-700 underline break-all"
              >
                {citation.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (data.tool === 'hand_off') {
    const { handoff } = data;
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() =>
            onNavigate(
              handoff.kind === 'booking' ? 'package' : 'contact',
              handoff.kind === 'booking' ? `/package/${handoff.packageId}?book=1` : '/contact',
            )
          }
          className={CHIP_CLASS}
        >
          <ArrowRight className="w-3 h-3" />
          {handoff.kind === 'booking' ? 'Book this package' : 'Contact us'}
        </button>
      </div>
    );
  }

  if (data.answered) {
    return (
      <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
        {data.snippets.map((snippet) => (
          <blockquote key={snippet.docId} className="border-l-4 border-brand-400 pl-3">
            <p className="text-sm text-gray-800">{snippet.quote}</p>
            <cite className="text-xs text-gray-500 not-italic">— {snippet.title}</cite>
          </blockquote>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
      <p className="text-sm text-gray-700">{data.fallbackMessage}</p>
    </div>
  );
}

interface MessageRowProps {
  message: AssistantTurnMessageT;
  turnData: AssistantTurnData | undefined;
  onNavigate: (route: string, path: string) => void;
  onSendMessage: (text: string) => void;
  onResolvePrefill: (assistantMessageId: string, choice: 'replace' | 'keep') => void;
}

const MessageRow = memo(function MessageRow({
  message,
  turnData,
  onNavigate,
  onSendMessage,
  onResolvePrefill,
}: MessageRowProps) {
  if (message.role === 'user') {
    return (
      <div className="flex items-start gap-2 flex-row-reverse">
        <User className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
        <p className="text-sm bg-brand-600 text-white rounded-xl px-3 py-2 shadow-sm">{message.content}</p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm bg-white rounded-xl px-3 py-2 shadow-sm">{message.content}</p>
        {turnData && (
          <AssistantTurnExtras
            data={turnData}
            onNavigate={onNavigate}
            onSendMessage={onSendMessage}
            onResolvePrefill={(choice) => onResolvePrefill(message.id, choice)}
          />
        )}
      </div>
    </div>
  );
});

/**
 * Site-wide floating assistant chat PANEL (Phase 1: navigation + FAQ/policy
 * answers). Mounted once in AppContent — deliberately OUTSIDE the route
 * Suspense boundary so lazy page loads never unmount/remount it and re-fire
 * impression telemetry.
 *
 * Phase 1 collapse: the widget no longer renders its own launcher button.
 * The single bottom-right launcher (FloatingActionStack, rendered by
 * MainLayout) owns that anchor and opens this panel through the shared
 * assistantLauncherState store; this component only renders the chat panel,
 * floating just above the launcher anchor (ASSISTANT_PANEL_BOTTOM_OFFSET_PX),
 * while the store is open on a route where the assistant is not excluded.
 * Self-exclusion and close-on-excluded-route are unchanged.
 */
export default function AssistantWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const chat = useAssistantChat();
  const isOpen = useAssistantLauncherOpen();
  const dialogHost = useAssistantDialogHost();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { scrollRef: transcriptRef, handleWheelCapture: handleTranscriptWheelCapture } = useLenisScrollContainment();
  const returnFocusTo = useRef<Element | null>(null);
  const [input, setInput] = useState('');
  const openedEventFired = useRef(false);
  const mountPathname = useRef(location.pathname);

  const turnByMessageId = useMemo(() => new Map(chat.turns.map((turn) => [turn.assistantMessageId, turn.data])), [chat.turns]);

  // Impression fires exactly once per widget mount, and only when that mount
  // actually renders the widget (mounting on an excluded route renders null).
  useEffect(() => {
    if (!isAssistantExcludedPath(mountPathname.current)) {
      void sendAssistantEvent({ sessionId: chat.sessionId, turnId: null, eventType: 'impression', tool: null, route: null });
    }
  }, [chat.sessionId]);

  // The component never unmounts on an excluded route (it just renders null
  // below, since it's mounted unconditionally in App.tsx), so the store's
  // open state would otherwise survive a visit to /planner or /login and
  // silently pop the panel back open on return (found in /ship's Claude
  // adversarial review). Close it the moment the route becomes excluded.
  useEffect(() => {
    if (isAssistantExcludedPath(location.pathname)) {
      setAssistantLauncherOpen(false);
    }
  }, [location.pathname]);

  // The launcher no longer lives here (Phase 1), so "user opened the
  // assistant" is now the store's false→true transition instead of a local
  // button click — but the telemetry contract is unchanged: one `opened`
  // event per widget mount, however many times the panel is later
  // closed/reopened. Guarded on the excluded route too: a panel that cannot
  // render (it returns null there) must not fire the event either.
  useEffect(() => {
    if (isOpen && !openedEventFired.current && !isAssistantExcludedPath(location.pathname)) {
      openedEventFired.current = true;
      void sendAssistantEvent({ sessionId: chat.sessionId, turnId: null, eventType: 'opened', tool: null, route: null });
    }
  }, [isOpen, location.pathname, chat.sessionId]);

  // Client-side navigation only: the widget's own router executes the
  // resolved path, and the route name the server validated goes as
  // telemetry. Declared before the early returns below — every hook call
  // must run unconditionally on every render, or a live transition into an
  // excluded route (this callback would otherwise be skipped) throws
  // "Rendered fewer hooks than expected" (caught by this file's own test
  // suite when it started exercising that transition).
  const handleChipClick = useCallback(
    (route: string, path: string) => {
      void sendAssistantEvent({ sessionId: chat.sessionId, turnId: null, eventType: 'nav_click', tool: 'navigate', route });
      navigate(path);
    },
    [chat.sessionId, navigate],
  );

  // A chip that sends a message rather than navigating (the booking
  // confirmation). Reached through a ref so the callback keeps one identity: it
  // is a prop of the memoized MessageRow, and a new one per keystroke would
  // re-render the whole transcript on every character typed.
  const sendMessageRef = useRef(chat.sendMessage);
  sendMessageRef.current = chat.sendMessage;
  const handleChipSend = useCallback((text: string) => {
    void sendMessageRef.current(text);
  }, []);
  // Same reason as the send ref above: the chip is a prop of the memoized row, and
  // a fresh closure per keystroke would re-render the whole transcript.
  const resolvePrefillRef = useRef(chat.resolvePrefill);
  resolvePrefillRef.current = chat.resolvePrefill;
  const handleResolvePrefill = useCallback((assistantMessageId: string, choice: 'replace' | 'keep') => {
    resolvePrefillRef.current(assistantMessageId, choice);
  }, []);

  // Opening moves focus into the panel; closing gives it back to whatever had it.
  // Both are what makes the assistant usable from inside a dialog without the
  // dialog's own focus trap swallowing it. Declared before the early returns
  // below, like every other hook here.
  useEffect(() => {
    if (isOpen) {
      returnFocusTo.current = document.activeElement;
      return;
    }
    const target = returnFocusTo.current;
    if (target instanceof HTMLElement) target.focus();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !chat.isSending) inputRef.current?.focus();
  }, [isOpen, chat.isSending]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setAssistantLauncherOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  if (isAssistantExcludedPath(location.pathname)) return null;
  if (!isOpen) return null;

  const handleClose = () => setAssistantLauncherOpen(false);

  const handleClearChat = () => {
    chat.clearChat();
    setInput('');
    inputRef.current?.focus();
  };

  const handleNewChat = () => {
    chat.startNewChat();
    setInput('');
    inputRef.current?.focus();
  };

  const handleSend = () => {
    const text = input;
    setInput('');
    void chat.sendMessage(text);
  };

  return (
    <div
      className={`fixed right-3 pointer-events-none ${dialogHost ? 'z-floating-assistant' : 'z-floating-action'}`}
      style={{ bottom: `${ASSISTANT_PANEL_BOTTOM_OFFSET_PX}px` }}
      // Escape closes the assistant FIRST, and only the assistant: the capture
      // phase stops the dialog underneath from seeing the same key.
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        handleClose();
      }}
      tabIndex={-1}
      ref={panelRef}
    >
      <div role="dialog" aria-label="Travel assistant panel" className={PANEL_CLASS}>
        <div className="flex items-center justify-between gap-2 bg-brand-800 px-4 py-3 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Travel Assistant</p>
              <p className="text-xs text-white/80 leading-tight">Travel help & planning</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            disabled={chat.isSending}
            aria-label="Start a new chat"
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors hover:bg-white/15 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>New chat</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close assistant panel"
            className="rounded-full p-1.5 transition-colors hover:bg-white/20 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={transcriptRef}
          onWheelCapture={handleTranscriptWheelCapture}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4"
        >
          <div className="flex items-start gap-2">
            <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
            <p className="text-sm bg-white rounded-xl px-3 py-2 shadow-sm">{GREETING}</p>
          </div>
          {chat.messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              turnData={turnByMessageId.get(message.id)}
              onNavigate={handleChipClick}
              onSendMessage={handleChipSend}
              onResolvePrefill={handleResolvePrefill}
            />
          ))}
          {chat.isSending && (
            <div className="flex items-center gap-2 text-sm text-gray-600" role="status" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
              <span>Thinking…</span>
            </div>
          )}
        </div>

        {chat.error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-200">
            <p className="text-xs text-red-700">{chat.error}</p>
          </div>
        )}

        <div className="flex gap-2 border-t border-gray-200 bg-white p-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about travel, pages, or policies…"
            maxLength={2000}
            disabled={chat.isSending}
            className={INPUT_CLASS}
          />
          <button type="button" onClick={handleSend} disabled={chat.isSending || !input.trim()} aria-label="Send message" className={SEND_BUTTON_CLASS}>
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="flex justify-end border-t border-gray-100 bg-white px-3 py-2">
          <button
            type="button"
            onClick={handleClearChat}
            disabled={chat.isSending}
            aria-label="Clear chat"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear chat</span>
          </button>
        </div>
      </div>
    </div>
  );
}

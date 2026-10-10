import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Loader2, Send, User } from 'lucide-react';
import Swal from 'sweetalert2';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../../services/http/apiErrorMessage';
import { formatCurrency } from '../../lib/currency';
import {
  generateItineraryPreview,
  type AIItineraryDay,
} from '../../services/api/aiItinerary';
import {
  generateDayPreview,
  generateDaysRangePreview,
  type AIGeneratedDay,
} from '../../services/api/aiDayGeneration';
import {
  sendItineraryChatMessage,
  type ItineraryChatSlots,
} from '../../services/api/itineraryChat';
import {
  sendWizardTurn,
  type WizardState,
  type WizardTurnMessageT,
} from '../../services/api/wizardTurn';
// ── PlanYourTripContainer day shape ──────────────────────────────

export interface DayAccommodation {
  name: string;
  type: string;
  rating: number;
  address: string;
  contactNumber: string;
}

export interface DayMeals {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  locations: string[];
  activities: string[];
  accommodation: DayAccommodation;
  meals: DayMeals;
  transport: string;
  places: string[];
  notes: string;
}

/** An AI-generated day, shaped like the shared ManualItineraryDay contract. */
interface RawAIDay {
  dayNumber?: number;
  title?: string | null;
  description?: string | null;
  locations?: string[];
  activities?: string[];
  accommodation?: {
    name?: string;
    type?: string;
    rating?: number;
    address?: string;
    contactNumber?: string;
  } | null;
  meals?: {
    breakfast?: boolean;
    lunch?: boolean;
    dinner?: boolean;
  } | null;
  transport?: string | null;
}

/** Normalizes an AI-generated day into PlanYourTripContainer's editable ItineraryDay state. */
export const buildItineraryDayFromAIDay = (aiDay: RawAIDay, index: number): ItineraryDay => ({
  dayNumber: aiDay?.dayNumber || index + 1,
  title: aiDay?.title || `Day ${index + 1}`,
  locations: aiDay?.locations || [],
  activities: aiDay?.activities || [],
  accommodation: {
    name: aiDay?.accommodation?.name || '',
    type: aiDay?.accommodation?.type || 'hotel',
    rating: aiDay?.accommodation?.rating ?? 4,
    address: aiDay?.accommodation?.address || '',
    contactNumber: aiDay?.accommodation?.contactNumber || '',
  },
  meals: {
    breakfast: aiDay?.meals?.breakfast ?? false,
    lunch: aiDay?.meals?.lunch ?? false,
    dinner: aiDay?.meals?.dinner ?? false,
  },
  transport: aiDay?.transport || '',
  places: [], // Never populated from AI (or manual entry) — locations is the only user/AI-editable place field.
  notes: aiDay?.description || '',
});

// ── Date helpers shared by the manual duration calc and the chat panel ──

/** Inclusive day count of a whole-day range — both endpoints are trip days,
 * 0 when either date is missing or the end precedes the start.
 *
 * A start/end pair one day apart is a 2-day/1-night trip and must yield 2:
 * this value is the itinerary's day count everywhere downstream (the
 * "N Days / N-1 Nights" label, the `duration` sent to the N-day AI preview,
 * the per-day/bulk-fill day-number ceiling), and ItineraryChatPanel's default
 * end date (addDaysISO(start, duration - 1)) already assumes an inclusive
 * range. */
export const computeDurationDays = (start: string, end: string): number => {
  if (!start || !end) return 0;
  const diffDays = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24));
  return diffDays < 0 ? 0 : diffDays + 1;
};

/** Today as a local YYYY-MM-DD. Local, not UTC: the date fields and the
 * "cannot be in the past" rule are about the visitor's own calendar day.
 * Shared by both containers' date validation and the assistant's
 * set_trip_details action. */
export const localTodayISO = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Adds `days` whole days to an ISO date string, returning an ISO date string. */
export const addDaysISO = (isoDate: string, days: number): string => {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

// ── Assistant day edits (add / remove entries on one day) ──
// A day's lists are plain strings the visitor can also type by hand, so a match
// has to survive how a person phrases a removal: "remove the temple visit" has
// to find an entry called "Temple of the Tooth". Equality is tried first, then a
// shared significant word.

/** Words that carry no identity in a day entry, so they never make a match. */
const DAY_ENTRY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'plus',
  'my', 'our', 'your', 'this', 'that', 'it', 'its', 'day', 'days', 'night', 'nights',
  'add', 'remove', 'delete', 'drop', 'change', 'please', 'also', 'then', 'visit', 'trip',
]);

/** The words in a wanted phrase that could identify a day entry (4+ chars, not a stopword). */
const significantWords = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !DAY_ENTRY_STOPWORDS.has(word));

/** The first wanted phrase that identifies `entry`, or null. */
const matchingWanted = (entry: string, wanted: string[]): string | null => {
  const lowerEntry = entry.toLowerCase();
  for (const phrase of wanted) {
    const lowerPhrase = phrase.toLowerCase().trim();
    if (!lowerPhrase) continue;
    if (lowerEntry === lowerPhrase || lowerEntry.includes(lowerPhrase) || lowerPhrase.includes(lowerEntry)) {
      return phrase;
    }
    if (significantWords(phrase).some((word) => lowerEntry.includes(word))) return phrase;
  }
  return null;
};

/**
 * `entries` with every wanted phrase appended that is not already there,
 * compared without case. Returns the same array identity when nothing is added,
 * so a caller can tell "no change" from "changed".
 */
export const withAddedEntries = (entries: string[], wanted: string[]): string[] => {
  const added = wanted.filter((phrase) => phrase.trim() && !matchingWanted(phrase, entries));
  return added.length ? [...entries, ...added.map((phrase) => phrase.trim())] : entries;
};

/**
 * `entries` with every one removed that a wanted phrase identifies. Returns the
 * same array identity when nothing matched, so an unmatched removal ("day 2 has
 * no temple visit") is distinguishable from a removal that happened.
 */
export const withoutMatchingEntries = (entries: string[], wanted: string[]): string[] => {
  const kept = entries.filter((entry) => matchingWanted(entry, wanted) === null);
  return kept.length === entries.length ? entries : kept;
};

// ── Per-day AI generation helpers (regenerate one day / fill remaining) ──

/** A minimal day shape carrying only what the per-day AI endpoints need for
 * prompt context — reduces PlanYourTripContainer's ItineraryDay and
 * CustomizePackageContainer's DayOverrideState to one common wire shape. */
export interface ExistingDayContext {
  dayNumber: number;
  title?: string;
  locations?: string[];
  activities?: string[];
}

/** Projects a container's day-state shape (ItineraryDay or DayOverrideState —
 * anything with at least these fields) down to the wire shape the per-day
 * AI endpoints expect as prompt context. Shared so both containers' existingDays
 * mapping stays aligned with ExistingDayContext in one place. */
export const toExistingDayContext = (day: { dayNumber: number; title?: string | null; locations?: string[]; activities?: string[] }): ExistingDayContext => ({
  dayNumber: day.dayNumber,
  title: day.title ?? undefined,
  locations: day.locations,
  activities: day.activities,
});

/** Replaces the entry whose dayNumber matches `day`, or appends it (sorted)
 * if no existing day has that number. The shared merge used by per-day and
 * bulk AI regeneration so unrelated days are never touched, and so it works
 * correctly even when dayNumbers aren't contiguous (see
 * CustomizePackageContainer's handleRemoveDay, which doesn't renumber). */
export const mergeDayByNumber = <T extends { dayNumber: number }>(days: T[], day: T): T[] => {
  const index = days.findIndex((d) => d.dayNumber === day.dayNumber);
  if (index === -1) return [...days, day].sort((a, b) => a.dayNumber - b.dayNumber);
  const next = [...days];
  next[index] = day;
  return next;
};

/** Folds `mergeDayByNumber` over a batch of newly-generated days. */
export const mergeDaysByNumber = <T extends { dayNumber: number }>(days: T[], newDays: T[]): T[] =>
  newDays.reduce((acc, day) => mergeDayByNumber(acc, day), days);

/** The per-day/range AI endpoints reject dayNumber/totalDuration above 30
 * (Services/shared/contracts) — a trip longer than this can't use per-day
 * or bulk AI generation at all. Shared here so both containers cap what
 * they offer instead of rendering a CTA that fails validation client-side. */
export const AI_DAY_GENERATION_MAX_DAY = 30;

/** Day numbers in `1..totalDuration` not present in `existingDayNumbers` —
 * a real set difference, not a naive tail computation, because
 * CustomizePackageContainer's day list can have gaps in the middle. Capped
 * at AI_DAY_GENERATION_MAX_DAY so bulk-fill never requests a day number the
 * server would reject. */
export const computeMissingDayNumbers = (totalDuration: number, existingDayNumbers: number[]): number[] => {
  const existing = new Set(existingDayNumbers);
  const missing: number[] = [];
  for (let n = 1; n <= Math.min(totalDuration, AI_DAY_GENERATION_MAX_DAY); n += 1) {
    if (!existing.has(n)) missing.push(n);
  }
  return missing;
};

interface GenerateParams {
  destination: string;
  duration: number;
  travelers?: number;
  preferences?: string;
}

interface UseAIItineraryGeneratorOptions<TDay> {
  hasExistingDays: () => boolean;
  mapDay: (aiDay: AIItineraryDay, index: number) => TDay;
  onGenerated: (days: TDay[]) => void;
}

export function useAIItineraryGenerator<TDay>({ hasExistingDays, mapDay, onGenerated }: UseAIItineraryGeneratorOptions<TDay>) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  /** Resolves to what happened, so a caller that is not a button — the
   * assistant's page action — can say which of the three it was. `error` still
   * carries the message for the page's own banner. */
  const generate = async (params: GenerateParams): Promise<'generated' | 'cancelled' | 'failed'> => {
    if (hasExistingDays()) {
      const confirmed = await Swal.fire({
        icon: 'warning',
        title: 'Replace itinerary?',
        text: 'Generating a new AI itinerary will replace all planned days. Continue?',
        showCancelButton: true,
        confirmButtonText: 'Replace',
        cancelButtonText: 'Cancel',
      });
      if (!confirmed.isConfirmed) return 'cancelled';
    }
    setError('');
    setIsGenerating(true);
    try {
      const { days } = await generateItineraryPreview(params);
      onGenerated(days.map(mapDay));
      return 'generated';
    } catch (err) {
      setError(apiErrorMessage(err));
      return 'failed';
    } finally {
      setIsGenerating(false);
    }
  };

  return { isGenerating, error, generate };
}

interface DayGenerationContext {
  destination: string;
  totalDuration: number;
  travelers?: number;
  preferences?: string;
  existingDays: ExistingDayContext[];
}

interface UseAIDayGeneratorOptions<TDay> {
  /** Trip-level params + the other days, read fresh at call time (mirrors
   * useAIItineraryGenerator's hasExistingDays()) so a stale closure never
   * ships outdated form state. */
  getContext: () => DayGenerationContext;
  /** Maps an AI day onto the container's day-state shape. `dayNumber` is
   * always the requested slot (already forced server-side), so containers
   * reuse their existing buildItineraryDayFromAIDay/buildDayState mappers by
   * passing `dayNumber - 1` as the index argument. */
  mapDay: (aiDay: AIGeneratedDay, dayNumber: number) => TDay;
  onDayGenerated: (day: TDay, dayNumber: number) => void;
  onDaysGenerated: (days: TDay[], requestedDayNumbers: number[]) => void;
}

/** Per-day / bulk-range counterpart to useAIItineraryGenerator: regenerates
 * or fills specific days in place instead of replacing the whole trip. */
export function useAIDayGenerator<TDay>({ getContext, mapDay, onDayGenerated, onDaysGenerated }: UseAIDayGeneratorOptions<TDay>) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingDayNumber, setGeneratingDayNumber] = useState<number | null>(null);
  const [error, setError] = useState('');

  /** Resolves to what happened, for the assistant's page action; `error` still
   * carries the message the page renders. */
  const generateDay = async (dayNumber: number): Promise<'generated' | 'failed'> => {
    const context = getContext();
    setError('');
    setIsGenerating(true);
    setGeneratingDayNumber(dayNumber);
    try {
      const { day } = await generateDayPreview({
        destination: context.destination,
        dayNumber,
        totalDuration: context.totalDuration,
        travelers: context.travelers,
        preferences: context.preferences,
        existingDays: context.existingDays,
      });
      onDayGenerated(mapDay(day, dayNumber), dayNumber);
      return 'generated';
    } catch (err) {
      setError(apiErrorMessage(err));
      return 'failed';
    } finally {
      setIsGenerating(false);
      setGeneratingDayNumber(null);
    }
  };

  /** `partial` is the existing shortfall outcome — some days came back, the rest
   * are named in `error`. */
  const generateDays = async (dayNumbers: number[]): Promise<'generated' | 'partial' | 'failed'> => {
    if (dayNumbers.length === 0) return 'generated';
    const context = getContext();
    setError('');
    setIsGenerating(true);
    try {
      const { days } = await generateDaysRangePreview({
        destination: context.destination,
        dayNumbers,
        totalDuration: context.totalDuration,
        travelers: context.travelers,
        preferences: context.preferences,
        existingDays: context.existingDays,
      });
      const returnedByDayNumber = new Map(days.map((d) => [d.dayNumber, d]));
      const mapped = dayNumbers
        .filter((n) => returnedByDayNumber.has(n))
        .map((n) => mapDay(returnedByDayNumber.get(n) as AIGeneratedDay, n));
      if (mapped.length > 0) onDaysGenerated(mapped, dayNumbers);
      if (mapped.length < dayNumbers.length) {
        setError(`${mapped.length} of ${dayNumbers.length} days generated. Click again to fill the rest.`);
        return 'partial';
      }
      return 'generated';
    } catch (err) {
      setError(apiErrorMessage(err));
      return 'failed';
    } finally {
      setIsGenerating(false);
    }
  };

  return { isGenerating, generatingDayNumber, error, generateDay, generateDays };
}

export interface ItineraryChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Sliding window sent to the backend each turn — matches the contract's
// ItineraryChatRequest.messages.max(20). Older turns still show in the
// visible transcript; only the most recent 20 are sent as model context.
const MAX_CHAT_MESSAGES = 20;

export function useItineraryChat() {
  const [messages, setMessages] = useState<ItineraryChatMessage[]>([]);
  const [slots, setSlots] = useState<ItineraryChatSlots>({});
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedMessages, setLastFailedMessages] = useState<ItineraryChatMessage[] | null>(null);

  const attempt = async (nextMessages: ItineraryChatMessage[]) => {
    setError('');
    setIsSending(true);
    try {
      const result = await sendItineraryChatMessage({ messages: nextMessages, slots });
      setMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
      setSlots(result.slots);
      setReadyToGenerate(result.readyToGenerate);
      setLastFailedMessages(null);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLastFailedMessages(nextMessages);
    } finally {
      setIsSending(false);
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    const userMessage: ItineraryChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    await attempt([...messages, userMessage].slice(-MAX_CHAT_MESSAGES));
  };

  const retry = () => {
    if (lastFailedMessages) attempt(lastFailedMessages);
  };

  return { messages, slots, readyToGenerate, isSending, error, send, retry };
}

export interface WizardPackage {
  id: string;
  title: string;
  destination: string;
  durationDays: number;
  sellPrice: number;
  currency: string;
  coverImage?: string | null;
  rating: number;
  images?: Array<{ url: string }>;
}

export interface PolicyAnswer {
  answered: boolean;
  fallbackMessage?: string;
  supportEmail?: string;
  whatsappNumber?: string;
  snippets?: Array<{ docId: string; title: string; quote: string }>;
}

// Sliding window sent to the backend each turn, same reasoning as
// useItineraryChat's MAX_WIZARD_MESSAGES.
const MAX_WIZARD_MESSAGES = 20;
const WIZARD_SESSION_KEY = 'travel-crm.wizardSessionId';

// A stable per-browser-wizard session id, persisted so a page reload resumes
// the same session instead of forking a brand-new lead on the intake side.
// Falls back to a fresh id if localStorage is unavailable (privacy mode /
// opaque origin) — the wizard still works, just without cross-reload identity.
function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(WIZARD_SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(WIZARD_SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

// Every message gets a stable id (assigned once here, never regenerated on a
// resent sliding-window slice) and an `at` timestamp, so package-service can
// diff a resent window and lead-service's intake transcript dedupes per-message.
function createMessage(role: 'user' | 'assistant', content: string): WizardTurnMessageT {
  return { id: crypto.randomUUID(), role, content, at: new Date().toISOString() };
}

export function useTripWizard() {
  const [sessionId] = useState(loadOrCreateSessionId);
  const [messages, setMessages] = useState<WizardTurnMessageT[]>([]);
  const [wizardState, setWizardState] = useState<WizardState>({});
  const [packages, setPackages] = useState<WizardPackage[] | null>(null);
  const [policyAnswer, setPolicyAnswer] = useState<PolicyAnswer | null>(null);
  const [contactPrompt, setContactPrompt] = useState(false);
  const [completedPackage, setCompletedPackage] = useState<WizardPackage | null>(null);
  const [wizardError, setWizardError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [lastFailedMessages, setLastFailedMessages] = useState<WizardTurnMessageT[] | null>(null);

  const attempt = async (nextMessages: WizardTurnMessageT[], nextWizardState: WizardState) => {
    setError('');
    setIsSending(true);
    try {
      const result = await sendWizardTurn({ sessionId, wizardState: nextWizardState, messages: nextMessages });
      setMessages((prev) => [...prev, createMessage('assistant', result.message || '...')]);
      setWizardState(result.updatedWizardState);

      setPackages(null);
      setPolicyAnswer(null);
      setCompletedPackage(null);
      setContactPrompt(false);
      setWizardError('');

      if (result.uiComponent === 'packageCards') {
        setPackages((result.serverResult?.packages as WizardPackage[] | undefined) || []);
      } else if (result.uiComponent === 'policyAnswer') {
        setPolicyAnswer(result.serverResult as unknown as PolicyAnswer);
      } else if (result.uiComponent === 'contactPrompt') {
        setContactPrompt(true);
      } else if (result.uiComponent === 'complete') {
        setCompletedPackage((result.serverResult?.package as WizardPackage | undefined) || null);
      } else if (result.uiComponent === 'error') {
        setWizardError('That package is no longer available — please choose another.');
      }

      setLastFailedMessages(null);
    } catch (err) {
      setError(apiErrorMessage(err));
      setLastFailedMessages(nextMessages);
    } finally {
      setIsSending(false);
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    const userMessage = createMessage('user', trimmed);
    setMessages((prev) => [...prev, userMessage]);
    await attempt([...messages, userMessage].slice(-MAX_WIZARD_MESSAGES), wizardState);
  };

  const selectPackage = async (pkg: WizardPackage) => {
    if (isSending) return;
    const nextWizardState: WizardState = { ...wizardState, selectedPackageId: pkg.id };
    setWizardState(nextWizardState);
    const userMessage = createMessage('user', `I'd like to book "${pkg.title}".`);
    setMessages((prev) => [...prev, userMessage]);
    await attempt([...messages, userMessage].slice(-MAX_WIZARD_MESSAGES), nextWizardState);
  };

  const retry = () => {
    if (lastFailedMessages) attempt(lastFailedMessages, wizardState);
  };

  return { messages, wizardState, packages, policyAnswer, contactPrompt, completedPackage, wizardError, isSending, error, send, selectPackage, retry };
}

export interface ChatTranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatTranscriptProps {
  greeting: string;
  messages: ChatTranscriptMessage[];
  isSending: boolean;
}

/**
 * Shared chat-bubble rendering for the itinerary chat panel (Phase 1) and the
 * trip-planning wizard panel (Phase 2) — both are simple role-tagged message
 * lists with the same bubble styling, so the transcript markup lives here
 * once rather than being copy-pasted into each panel.
 */
export function ChatTranscript({ greeting, messages, isSending }: ChatTranscriptProps) {
  return (
    <div className="max-h-80 overflow-y-auto p-4 space-y-3 bg-gray-50">
      <div className="flex items-start gap-2">
        <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
        <p className="text-sm bg-white rounded-xl px-3 py-2 shadow-sm">{greeting}</p>
      </div>
      {messages.map((m, i) => (
        <div key={i} className={`flex items-start gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
          {m.role === 'user' ? (
            <User className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" />
          ) : (
            <Bot className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
          )}
          <p className={`text-sm rounded-xl px-3 py-2 shadow-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white'}`}>
            {m.content}
          </p>
        </div>
      ))}
      {isSending && <Loader2 className="w-4 h-4 animate-spin text-brand-600" />}
    </div>
  );
}

interface DateRangeCalendarProps {
  initialStart?: string;
  initialEnd?: string;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
}

export function DateRangeCalendar({ initialStart, initialEnd, onChange, onClose }: DateRangeCalendarProps) {
  const calRef = useRef<HTMLDivElement>(null);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = initialStart ? new Date(initialStart) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rangeStart, setRangeStart] = useState<Date | null>(initialStart ? new Date(initialStart) : null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(initialEnd ? new Date(initialEnd) : null);
  const [selecting, setSelecting] = useState(false);
  const [awaitingEnd, setAwaitingEnd] = useState(false);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

  const formatISO = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  function buildCalendar(month: Date): (Date | null)[] {
    const first = startOfMonth(month);
    const startWeekDay = first.getDay();
    const total = daysInMonth(month.getFullYear(), month.getMonth());
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekDay; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    return cells;
  }

  function inRange(date: Date): boolean {
    if (!rangeStart || !rangeEnd) return false;
    const a = rangeStart < rangeEnd ? rangeStart : rangeEnd;
    const b = rangeStart < rangeEnd ? rangeEnd : rangeStart;
    return date >= startOfDay(a) && date <= startOfDay(b);
  }

  function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function handleDayDown(d: Date) {
    if (awaitingEnd && rangeStart) {
      setRangeEnd(d);
      setAwaitingEnd(false);
      const a = rangeStart < d ? rangeStart : d;
      const b = rangeStart < d ? d : rangeStart;
      onChange(formatISO(a), formatISO(b));
      return;
    }

    setSelecting(true);
    setRangeStart(d);
    setRangeEnd(d);
    setAwaitingEnd(false);
  }

  function handleDayEnter(d: Date) {
    if (!selecting && !awaitingEnd) return;
    setRangeEnd(d);
  }

  function handleDayUp() {
    setSelecting(false);
    if (rangeStart && rangeEnd) {
      if (startOfDay(rangeStart).getTime() === startOfDay(rangeEnd).getTime()) {
        setAwaitingEnd(true);
        return;
      }
      const a = rangeStart < rangeEnd ? rangeStart : rangeEnd;
      const b = rangeStart < rangeEnd ? rangeEnd : rangeStart;
      onChange(formatISO(a), formatISO(b));
    }
  }

  // Keyboard-only equivalent of the mouse down->up two-click range
  // selection above. Deliberately independent of handleDayDown/handleDayEnter/
  // handleDayUp (which model a mouse drag gesture with a separate down/move/up
  // phase that has no keyboard analogue) so this is purely additive: it
  // cannot change or regress the existing, already-tested mouse behavior.
  function handleDaySelect(d: Date) {
    const day = startOfDay(d);
    if (awaitingEnd && rangeStart) {
      setRangeEnd(day);
      setAwaitingEnd(false);
      const a = rangeStart < day ? rangeStart : day;
      const b = rangeStart < day ? day : rangeStart;
      onChange(formatISO(a), formatISO(b));
      return;
    }
    setRangeStart(day);
    setRangeEnd(day);
    setAwaitingEnd(true);
  }

  const cells = buildCalendar(viewMonth);

  return (
    <div ref={calRef} className="bg-white rounded-xl shadow-lg p-4 w-[320px]" role="group" aria-label="Choose travel dates">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          className="px-2 py-1"
          aria-label="Previous month"
        >
          ◀
        </button>
        <div className="font-semibold">{viewMonth.toLocaleString(undefined, { month: 'long' })} {viewMonth.getFullYear()}</div>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          className="px-2 py-1"
          aria-label="Next month"
        >
          ▶
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs text-center text-gray-500 mb-2">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div onMouseUp={handleDayUp} className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const isNull = c === null;
          const isSelected = !isNull && inRange(startOfDay(c));
          return (
            <div key={i} className={`h-8 flex items-center justify-center ${isNull ? '' : 'cursor-pointer'}`}>
              {isNull ? <div /> : (
                <div
                  onMouseDown={() => handleDayDown(startOfDay(c))}
                  onMouseEnter={() => handleDayEnter(startOfDay(c))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleDaySelect(c);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={c.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  className={`w-8 h-8 rounded-md flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${isSelected ? 'bg-brand-100 text-brand-700' : 'hover:bg-gray-100'}`}
                >
                  {c.getDate()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end mt-3">
        <button type="button" onClick={() => { onClose(); }} className="px-3 py-1 text-sm text-gray-600">Close</button>
      </div>
    </div>
  );
}

interface RegenerationToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}

/** Auto-dismissing success toast with an Undo action, shown after per-day or
 * bulk AI itinerary regeneration (docs/designs/granular-ai-itinerary-generation.md
 * UI/UX Specifications: "toast with Undo" on success; storyboard step 3:
 * toast "Day 3 regenerated — Undo"). */
export function RegenerationToast({ message, onUndo, onDismiss }: RegenerationToastProps) {
  // onDismiss is a fresh inline closure on every parent render (both call
  // sites pass `() => setRegenToast(null)`), so it can't be a dependency —
  // that would restart the 6s timer on every keystroke elsewhere in the
  // form. Keep the latest callback in a ref and key the effect on `message`
  // (identity changes only when a new toast actually appears) instead.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="font-semibold text-brand-300 underline hover:text-brand-200"
      >
        Undo
      </button>
    </div>
  );
}

interface ItineraryChatPanelProps {
  onReady: (params: { destination: string; startDate: string; endDate: string; travelers?: number; preferences?: string }) => void;
}

const ITINERARY_CHAT_GREETING = "Hi! Tell me about the trip you're dreaming of — where, how long, how many travelers, and any preferences?";

export function ItineraryChatPanel({ onReady }: ItineraryChatPanelProps) {
  const chat = useItineraryChat();
  const [input, setInput] = useState('');
  const [datesConfirmed, setDatesConfirmed] = useState(false);

  const handleSend = () => {
    const text = input;
    setInput('');
    void chat.send(text);
  };

  const handleDatesChosen = (start: string, end: string) => {
    setDatesConfirmed(true);
    onReady({
      destination: chat.slots.destination as string,
      startDate: start,
      endDate: end,
      travelers: chat.slots.travelers,
      preferences: chat.slots.preferences,
    });
  };

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <ChatTranscript greeting={ITINERARY_CHAT_GREETING} messages={chat.messages} isSending={chat.isSending} />

      {chat.error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center justify-between gap-2">
          <p className="text-xs text-red-700">{chat.error}</p>
          <button type="button" onClick={chat.retry} className="text-xs font-semibold text-red-700 underline shrink-0">Retry</button>
        </div>
      )}

      {chat.readyToGenerate && !datesConfirmed && (
        <div className="p-4 border-t border-gray-200 bg-brand-50">
          <p className="text-sm font-semibold text-gray-800 mb-3">
            Sounds like a {chat.slots.duration}-day trip to {chat.slots.destination}! Confirm your travel dates:
          </p>
          <DateRangeCalendar
            initialStart={todayISO}
            initialEnd={addDaysISO(todayISO, Math.max((chat.slots.duration ?? 1) - 1, 0))}
            onChange={handleDatesChosen}
            onClose={() => {}}
          />
        </div>
      )}

      <div className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
          placeholder="Tell us about your trip..."
          disabled={chat.isSending}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={chat.isSending || !input.trim()}
          className="w-10 h-10 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white flex items-center justify-center transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const TRIP_WIZARD_GREETING =
  "Hi! Tell me about the trip you're dreaming of and I'll find real packages that match — where, how long, how many travelers, and any budget or preferences?";

export function TripWizardPanel() {
  const wizard = useTripWizard();
  const [input, setInput] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const navigate = useNavigate();

  // complete_wizard always terminates on a real, server-validated package —
  // navigate straight into the existing customize flow, pre-filled with
  // whatever slots the wizard gathered along the way.
  useEffect(() => {
    if (!wizard.completedPackage) return;
    navigate(`/package/${wizard.completedPackage.id}/customize`, {
      state: {
        travelers: wizard.wizardState.slots?.travelers,
        preferences: wizard.wizardState.slots?.preferences,
      },
    });
  }, [wizard.completedPackage, navigate, wizard.wizardState.slots]);

  const handleSend = () => {
    const text = input;
    setInput('');
    void wizard.send(text);
  };

  const hasContactMethod = Boolean(contactEmail.trim() || contactPhone.trim() || contactWhatsapp.trim());

  const handleContactSubmit = () => {
    const parts: string[] = [];
    if (contactName.trim()) parts.push(`my name is ${contactName.trim()}`);
    if (contactEmail.trim()) parts.push(`my email is ${contactEmail.trim()}`);
    if (contactPhone.trim()) parts.push(`my phone number is ${contactPhone.trim()}`);
    if (contactWhatsapp.trim()) parts.push(`my WhatsApp is ${contactWhatsapp.trim()}`);
    if (parts.length === 0) return;
    void wizard.send(`Here's my contact info: ${parts.join(', ')}.`);
    setContactName('');
    setContactEmail('');
    setContactPhone('');
    setContactWhatsapp('');
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <ChatTranscript greeting={TRIP_WIZARD_GREETING} messages={wizard.messages} isSending={wizard.isSending} />

      {wizard.error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 flex items-center justify-between gap-2">
          <p className="text-xs text-red-700">{wizard.error}</p>
          <button type="button" onClick={wizard.retry} className="text-xs font-semibold text-red-700 underline shrink-0">
            Retry
          </button>
        </div>
      )}

      {wizard.wizardError && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200">
          <p className="text-xs text-amber-800">{wizard.wizardError}</p>
        </div>
      )}

      {wizard.policyAnswer && (
        <div className="p-4 border-t border-gray-200 bg-blue-50">
          {wizard.policyAnswer.answered ? (
            <div className="space-y-2">
              {wizard.policyAnswer.snippets?.map((s) => (
                <blockquote key={s.docId} className="text-sm text-gray-800 border-l-4 border-brand-400 pl-3">
                  <p>{s.quote}</p>
                  <cite className="text-xs text-gray-500 not-italic">— {s.title}</cite>
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-700">
              {wizard.policyAnswer.fallbackMessage}
              {wizard.policyAnswer.supportEmail && (
                <>
                  {' '}
                  Contact us at{' '}
                  <a className="underline" href={`mailto:${wizard.policyAnswer.supportEmail}`}>
                    {wizard.policyAnswer.supportEmail}
                  </a>
                  .
                </>
              )}
            </p>
          )}
        </div>
      )}

      {wizard.packages && (
        <div className="p-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {wizard.packages.length === 0 ? (
            <p className="text-sm text-gray-600 col-span-2">No matching packages yet — try adjusting your budget or destination.</p>
          ) : (
            wizard.packages.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => wizard.selectPackage(pkg)}
                disabled={wizard.isSending}
                className="text-left border border-gray-200 rounded-xl p-3 hover:border-brand-400 hover:shadow-md transition-all disabled:opacity-50"
              >
                <p className="font-semibold text-sm text-gray-900">{pkg.title}</p>
                <p className="text-xs text-gray-600">{pkg.destination} · {pkg.durationDays} days</p>
                <p className="text-sm font-bold text-brand-600 mt-1">{formatCurrency(pkg.sellPrice)}</p>
              </button>
            ))
          )}
        </div>
      )}

      {wizard.contactPrompt && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleContactSubmit();
          }}
          className="p-4 border-t border-gray-200 bg-blue-50 space-y-2"
        >
          <p className="text-sm font-medium text-gray-800">How should we reach you with the best options?</p>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="Phone"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <input
              type="text"
              value={contactWhatsapp}
              onChange={(e) => setContactWhatsapp(e.target.value)}
              placeholder="WhatsApp"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!hasContactMethod || wizard.isSending}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white transition-colors disabled:opacity-50"
            >
              Send contact info
            </button>
          </div>
        </form>
      )}

      <div className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
          placeholder="Tell us about your trip..."
          disabled={wizard.isSending}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={wizard.isSending || !input.trim()}
          className="w-10 h-10 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white flex items-center justify-center transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
import { useRef, useState, useEffect } from "react";
import { useAssistantPageRegistration } from "../assistant/capabilities/AssistantCapabilityProvider";
import type { AssistantActionPayload, AssistantPageAction, AssistantPageRegistration } from "../assistant/capabilities/AssistantCapabilityProvider";
import {
  MapPin,
  Calendar,
  Users,
  Zap,
  ChevronRight,
  ChevronLeft,
  Check,
  Clock,
  Plus,
  Trash2,
  Plane,
  Car,
  Ship,
  Train,
  Coffee,
  UtensilsCrossed,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { submitManualItineraryRequest } from "../../services/api/manualItinerary";
import {
  buildItineraryDayFromAIDay,
  computeDurationDays,
  computeMissingDayNumbers,
  DateRangeCalendar,
  ItineraryChatPanel,
  localTodayISO,
  mergeDayByNumber,
  mergeDaysByNumber,
  RegenerationToast,
  toExistingDayContext,
  TripWizardPanel,
  useAIDayGenerator,
  useAIItineraryGenerator,
  withoutMatchingEntries,
  withAddedEntries,
} from "./PlannerSupport";
import type { DayAccommodation, DayMeals, ItineraryDay } from "./PlannerSupport";
import { pluralize } from "../../lib/pluralize";
import DestinationSelector from "../../components/shared/DestinationSelector";
import Stepper from "../../components/Stepper";
import LocationSelector from "../../components/shared/LocationSelector";
import ActivitySelector from "../../components/shared/ActivitySelector";
import { useAuth } from "../../contexts/AuthContext";
import { fetchUserBookings } from "../../services/api/booking.ts";
import { ALL_DESTINATIONS } from "../../config/domainData/destinations";

const transportOptions: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: "flight", label: "Flight", icon: Plane },
  { value: "train", label: "Train", icon: Train },
  { value: "bus", label: "Bus", icon: Car },
  { value: "car", label: "Car", icon: Car },
  { value: "boat", label: "Boat", icon: Ship },
  { value: "walk", label: "Walk", icon: Car },
  { value: "other", label: "Other", icon: Car },
];

const accommodationTypes: Array<{ value: string; label: string }> = [
  { value: "hotel", label: "Hotel" },
  { value: "resort", label: "Resort" },
  { value: "guesthouse", label: "Guesthouse" },
  { value: "homestay", label: "Homestay" },
  { value: "camp", label: "Camp" },
  { value: "other", label: "Other" },
];

/** A destination option as emitted by DestinationSelector, or a bare label string. */
type DestinationLike = { value: string; label: string } | string | null;

/** Projects the display label from a destination option or bare string. */
const destLabel = (dest: DestinationLike): string => {
  if (dest && typeof dest === 'object') return dest.label;
  return typeof dest === 'string' ? dest : '';
};

/** Projects the option value from a destination option or bare string. */
const destValue = (dest: DestinationLike): string => {
  if (dest && typeof dest === 'object') return dest.value;
  return typeof dest === 'string' ? dest : '';
};

/** Longest trip window the wizard accepts — the Dates & Travelers
 * "window too long" rule. 90 days keeps a sane planning horizon for the
 * manual itinerary flow. */
const MAX_TRIP_DAYS = 90;

/** The page actions this page executes, sent to the assistant every turn. It is
 * the whole list: each one writes state this container owns. */
const ASSISTANT_ACTIONS: AssistantPageAction[] = [
  'set_destination',
  'set_travellers',
  'set_preferences',
  'set_contact_details',
  'go_to_step',
  'generate_itinerary',
  'regenerate_days',
  'edit_day',
];

/** Contact details are only written when they look like contact details. The
 * assistant is not a validation layer, so a half-typed address is dropped (and
 * said so) rather than saved into the form where the submit path would reject
 * it later with a worse message. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** User-facing copy shown for any submit rejection. Deliberately generic —
 * booking-service has no availability check today, so the UI must never
 * claim a specific "sold out"/"conflict" state. */
const SUBMIT_FAILURE_MESSAGE = "Couldn't complete your booking — please try again or contact us.";

/** Parses a raw `?step=` value into the 1..4 wizard range (1 when absent or
 * not a finite number, clamped when out of range). */
const parseStepParam = (value: string | null): number => {
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(4, Math.max(1, Math.trunc(parsed)));
};

/** Normalizes a booking date value to a YYYY-MM-DD day (raw DB rows may
 * carry a full timestamp); '' when absent or unparseable. */
const isoDateOnly = (value: string | null | undefined): string => {
  if (!value) return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : '';
};

/** Subset of the UserBooking contract row the returning-visitor pre-fill
 * reads. Structural so the container never depends on the wire type. */
interface BookingPrefillSource {
  createdAt?: string | null;
  updatedAt?: string | null;
  travelDate?: string | null;
  endDate?: string | null;
  numberOfTravelers?: number;
  packageDestination?: string | null;
  packageName?: string | null;
}

/** Maps a destination name onto a DestinationSelector option — an exact match
 * on the value or label first, then an embedded value ("5-Day Bali Escape" →
 * Bali). null when nothing matches, which callers treat as "leave it alone"
 * rather than guessing: an invented destination would filter pages to nothing
 * and write a place the catalogue does not have. Shared by the returning-visitor
 * pre-fill and the assistant's set_trip_details action. */
const findDestination = (name: string): DestinationLike => {
  const raw = name.trim().toLowerCase();
  if (!raw) return null;
  const exact = ALL_DESTINATIONS.find(
    (d) => d.value.toLowerCase() === raw || d.label.toLowerCase() === raw,
  );
  if (exact) return exact;
  return ALL_DESTINATIONS.find((d) => d.value.length >= 3 && raw.includes(d.value.toLowerCase())) ?? null;
};

/** Projects a past booking's destination fields onto the extracted lookup. */
const matchDestinationOption = (booking: BookingPrefillSource): DestinationLike => {
  for (const candidate of [booking.packageDestination, booking.packageName]) {
    if (!(candidate ?? '').trim()) continue;
    const match = findDestination(candidate as string);
    if (match) return match;
  }
  return null;
};

/** Most-recent-first ordering key for bookings (createdAt, else updatedAt). */
const bookingRecencyKey = (booking: BookingPrefillSource): number => {
  const parsed = Date.parse(booking.createdAt ?? booking.updatedAt ?? '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** The day object serialized into the manual-itinerary request payload. */
interface ItineraryDayPayload {
  dayNumber: number;
  title: string;
  locations: string[];
  activities: string[];
  accommodation: DayAccommodation;
  meals: DayMeals;
  places: string[];
  notes: string;
  transport?: string;
}

export default function PlanYourTripContainer() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [step, setStepState] = useState<number>(() => parseStepParam(searchParams.get('step')));
  const [selectedDest, setSelectedDest] = useState<DestinationLike>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [travelers, setTravelers] = useState(2);
  // Default preferences (not shown in UI, but used for generating default values)
  const defaultAccommodation = "4-star" as string;
  const defaultMealPlan = "breakfast" as string;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [validationMsg, setValidationMsg] = useState('');
  const [itineraryDays, setItineraryDays] = useState<ItineraryDay[]>([]);
  const [currentDayIndex, setCurrentDayIndex] = useState(0); // Index of currently visible day (0-based)
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preferences, setPreferences] = useState('');
  const [entryMode, setEntryMode] = useState<'manual' | 'chat' | 'wizard'>('manual');
  const aiGenerator = useAIItineraryGenerator<ItineraryDay>({
    hasExistingDays: () => itineraryDays.length > 0,
    mapDay: buildItineraryDayFromAIDay,
    onGenerated: (days) => {
      setItineraryDays(days);
      setCurrentDayIndex(0);
    },
  });
  const [regenToast, setRegenToast] = useState<{ message: string; undo: () => void } | null>(null);
  const aiDayGenerator = useAIDayGenerator<ItineraryDay>({
    getContext: () => ({
      destination: destLabel(selectedDest),
      totalDuration: duration,
      travelers,
      preferences: preferences || undefined,
      existingDays: itineraryDays.map(toExistingDayContext),
    }),
    mapDay: (aiDay, dayNumber) => buildItineraryDayFromAIDay(aiDay, dayNumber - 1),
    onDayGenerated: (day, dayNumber) => {
      setItineraryDays((prev) => {
        // Snapshot-based, not dayNumber-keyed: handleRemoveDay renumbers
        // every later day, and remove/add stay enabled during the 6s toast
        // window, so "restore whatever day now holds this number" can
        // silently delete a different, unrelated manual day. Restoring the
        // exact pre-merge array is correct regardless of what happened to
        // day numbers afterward.
        const snapshot = prev;
        setRegenToast({ message: `Day ${dayNumber} regenerated`, undo: () => setItineraryDays(snapshot) });
        return mergeDayByNumber(prev, day);
      });
    },
    onDaysGenerated: (days, requestedDayNumbers) => {
      setItineraryDays((prev) => {
        const snapshot = prev;
        if (days.length === requestedDayNumbers.length) {
          setRegenToast({ message: `${pluralize(days.length, 'day')} generated`, undo: () => setItineraryDays(snapshot) });
        }
        return mergeDaysByNumber(prev, days);
      });
    },
  });

  // Prefill contact details for logged-in users
  useEffect(() => {
    if (user) {
      setName((prev) => prev || user.name || "");
      setEmail((prev) => prev || user.email || "");
      setPhone((prev) => prev || user.phone || "");
    }
  }, [user]);
  // Returning-visitor pre-fill (CLIENT-REWAMP-PLAN: most-recent-booking
  // defaults, zero new backend work): when a logged-in user has bookings,
  // seed destination/dates/travelers from the most recent one. Purely an
  // initial convenience — every set below keeps a value the visitor has
  // already chosen, and fetch errors / empty results fall back silently to
  // the empty defaults (no error banner; this is not a required flow).
  const prefillUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const userId = user.id ?? user.email ?? 'anonymous';
    if (prefillUserIdRef.current === userId) return;
    prefillUserIdRef.current = userId;
    let cancelled = false;
    (async () => {
      try {
        const bookings = await fetchUserBookings();
        if (cancelled || bookings.length === 0) return;
        const latest = [...bookings].sort(
          (a, b) => bookingRecencyKey(b as BookingPrefillSource) - bookingRecencyKey(a as BookingPrefillSource),
        )[0] as BookingPrefillSource;
        const destination = matchDestinationOption(latest);
        if (destination) {
          setSelectedDest((prev) => (prev === null ? destination : prev));
        }
        const start = isoDateOnly(latest.travelDate);
        const end = isoDateOnly(latest.endDate);
        if (start && end && end >= start) {
          setStartDate((prev) => (prev === '' ? start : prev));
          setEndDate((prev) => (prev === '' ? end : prev));
        }
        const travelerCount = latest.numberOfTravelers;
        if (typeof travelerCount === 'number' && Number.isInteger(travelerCount) && travelerCount >= 1) {
          setTravelers((prev) => (prev === 2 ? travelerCount : prev));
        }
      } catch {
        // Silent: pre-fill is a convenience, not a required flow.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const duration = computeDurationDays(startDate, endDate);
  // Days not yet planned — always a contiguous tail here since handleAddDay
  // only appends and handleRemoveDay renumbers, but computed via the same
  // set-difference helper CustomizePackageContainer needs (its days can
  // have gaps), so both containers share one implementation.
  const missingDayNumbers = computeMissingDayNumbers(duration, itineraryDays.map((d) => d.dayNumber));
  // Dates & Travelers field-level validation (state table: invalid range /
  // past date / window too long, inline under the specific field). The
  // date-range calendar sorts any picked pair, so an end-before-start value
  // can only arrive via pre-fill or a programmatic set — it is validated
  // here all the same.
  const dateFieldErrors = (() => {
    const errors: { start?: string; end?: string } = {};
    if (startDate && endDate) {
      const todayISO = localTodayISO();
      if (startDate < todayISO) errors.start = 'Start date cannot be in the past.';
      if (endDate < todayISO) errors.end = 'End date cannot be in the past.';
      else if (endDate < startDate) errors.end = 'End date must be on or after the start date.';
      if (computeDurationDays(startDate, endDate) > MAX_TRIP_DAYS) {
        errors.end = `Trip length cannot exceed ${MAX_TRIP_DAYS} days.`;
      }
    }
    return errors;
  })();
  const hasDateErrors = Boolean(dateFieldErrors.start || dateFieldErrors.end);

  const nextDisabled =
    isSubmitting ||
    (step === 1 && !selectedDest) ||
    (step === 2 && (!startDate || !endDate || hasDateErrors)) ||
    (step === 3 && duration === 0) ||
    (step === 4 && !email);

  // Clear itinerary days when duration becomes 0 or decreases
  useEffect(() => {
    if (duration === 0) {
      setItineraryDays([]);
      setCurrentDayIndex(0);
    } else {
      // If duration decreases, remove extra days
      setItineraryDays(prev => {
        if (prev.length > duration) {
          const trimmed = prev.slice(0, duration);
          // Adjust current day index if needed
          setCurrentDayIndex(currentIdx => {
            const maxIndex = Math.max(0, trimmed.length - 1);
            return currentIdx > maxIndex ? maxIndex : currentIdx;
          });
          return trimmed;
        }
        return prev;
      });
    }
  }, [duration]);

  // Handle adding a new day
  const handleAddDay = () => {
    const nextDayNumber = itineraryDays.length + 1;
    if (nextDayNumber <= duration) {
      const newDay: ItineraryDay = {
        dayNumber: nextDayNumber,
        title: `Day ${nextDayNumber}`,
        locations: [],
        activities: [],
        accommodation: {
          name: '',
          type: defaultAccommodation === '3-star' ? 'hotel' : defaultAccommodation === '4-star' ? 'hotel' : defaultAccommodation === '5-star' ? 'resort' : defaultAccommodation === 'boutique' ? 'guesthouse' : defaultAccommodation === 'villa' ? 'other' : 'hotel',
          rating: defaultAccommodation === '3-star' ? 3 : defaultAccommodation === '4-star' ? 4 : defaultAccommodation === '5-star' ? 5 : 0,
          address: '',
          contactNumber: '',
        },
        meals: {
          breakfast: defaultMealPlan === 'breakfast' || defaultMealPlan === 'half-board' || defaultMealPlan === 'full-board' || defaultMealPlan === 'all-inclusive',
          lunch: defaultMealPlan === 'half-board' || defaultMealPlan === 'full-board' || defaultMealPlan === 'all-inclusive',
          dinner: defaultMealPlan === 'full-board' || defaultMealPlan === 'all-inclusive',
        },
        transport: '',
        places: [],
        notes: '',
      };
      setItineraryDays([...itineraryDays, newDay]);
      setCurrentDayIndex(itineraryDays.length); // Show the newly added day
      // Scroll to top of the form section
      setTimeout(() => {
        const formElement = document.querySelector('[data-itinerary-form]');
        if (formElement) {
          formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  };

  // Handle removing a day
  const handleRemoveDay = (dayNumber: number) => {
    const filteredDays = itineraryDays.filter(day => day.dayNumber !== dayNumber);
    // Renumber remaining days
    const renumberedDays = filteredDays.map((day, index) => ({
      ...day,
      dayNumber: index + 1,
    }));
    setItineraryDays(renumberedDays);
    // Adjust current day index if needed
    if (currentDayIndex >= renumberedDays.length) {
      setCurrentDayIndex(Math.max(0, renumberedDays.length - 1));
    }
  };

  const handleDayChange = (dayNumber: number, field: string, value: unknown) => {
    setItineraryDays(prev =>
      prev.map(day =>
        day.dayNumber === dayNumber
          ? { ...day, [field]: value } as ItineraryDay
          : day
      )
    );
  };

  const handleDayNestedChange = (dayNumber: number, parentField: string, childField: string, value: unknown) => {
    setItineraryDays(prev =>
      prev.map(day =>
        day.dayNumber === dayNumber
          ? {
              ...day,
              [parentField]: {
                ...day[parentField as keyof ItineraryDay] as object,
                [childField]: value,
              },
            } as ItineraryDay
          : day
      )
    );
  };

  const handleDestinationChange = (destination: { value: string; label: string }) => {
    setSelectedDest(destination);
    setValidationMsg('');
  };
  /** Moves the wizard onto the given step and mirrors it to `?step=` so the
   * transition is history-addressable (browser back/forward restore the
   * step; see the sync effect below). The only sanctioned step setter. */
  const goToStep = (next: number) => {
    const clamped = Math.min(4, Math.max(1, next));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('step', String(clamped));
    setSearchParams(nextParams);
    setStepState(clamped);
  };

  // Keep the displayed step in sync when the URL changes underneath the
  // wizard — history back/forward, a manual ?step= edit, or a deep link —
  // so the URL is the source of truth, not just an initial hint.
  useEffect(() => {
    setStepState(parseStepParam(searchParams.get('step')));
  }, [searchParams]);

  const next = () => {
    // validations
    if (step === 1 && !selectedDest) {
      setValidationMsg('Please choose a destination before continuing.');
      return;
    }
    if (step === 2 && (!startDate || !endDate)) {
      setValidationMsg('Please select travel dates before continuing.');
      return;
    }
    if (step === 2 && hasDateErrors) {
      setValidationMsg('Please fix the highlighted dates before continuing.');
      return;
    }
    if (step === 3 && duration === 0) {
      setValidationMsg('Please select valid travel dates first.');
      return;
    }
    if (step === 4 && !email) {
      setValidationMsg('Please fill in your email address to submit.');
      return;
    }
    setValidationMsg('');
    if (step < 4) goToStep(step + 1);
    else {
      handleSubmit();
    }
  };

  const back = () => step > 1 && goToStep(step - 1);

  const handleSubmit = async () => {
    // Double-submit guard: an early return (not just `disabled` on the
    // button) so a second Enter/click before the first response resolves
    // can never fire a duplicate request.
    if (isSubmitting) return;
    if (!email) {
      setValidationMsg('Please fill in your email address to submit.');
      return;
    }

    if (duration === 0 || itineraryDays.length === 0) {
      setValidationMsg('Please complete the itinerary planning first.');
      return;
    }

    setIsSubmitting(true);
    setValidationMsg('');

    try {
      // Extract destination info
      const destinationName = destLabel(selectedDest);
      const destinationValue = destValue(selectedDest);

      const payload = {
        name: name.trim(),
        email: email.trim(),
        phone: phone ? phone.trim() : '',
        destination: destinationName,
        destinationCountry: destinationValue,
        region: '',
        travelDate: startDate,
        endDate: endDate,
        numberOfTravelers: travelers,
        budget: '',
        message: preferences.trim(),
        days: itineraryDays.map(day => {
          const dayData: ItineraryDayPayload = {
            dayNumber: day.dayNumber,
            title: day.title || `Day ${day.dayNumber}`,
            locations: day.locations || [],
            activities: day.activities || [],
            accommodation: day.accommodation || {
              name: '',
              type: 'hotel',
              rating: 0,
              address: '',
              contactNumber: '',
            },
            meals: day.meals || {
              breakfast: false,
              lunch: false,
              dinner: false,
            },
            places: day.places || [],
            notes: day.notes || '',
          };

          // Only include transport if it has a valid value (not empty string)
          if (day.transport && day.transport.trim() !== '') {
            dayData.transport = day.transport;
          }

          return dayData;
        }),
      };

      await submitManualItineraryRequest(payload as Parameters<typeof submitManualItineraryRequest>[0]);
      setShowSuccess(true);
    } catch (error) {
      console.error('Failed to submit manual itinerary:', error);
      // Generic copy only — booking-service has no availability check, so
      // the UI never claims a specific "sold out"/"conflict" state.
      setValidationMsg(SUBMIT_FAILURE_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChatReady = async (params: { destination: string; startDate: string; endDate: string; travelers?: number; preferences?: string }) => {
    setSelectedDest({ value: params.destination, label: params.destination });
    setStartDate(params.startDate);
    setEndDate(params.endDate);
    if (params.travelers) setTravelers(params.travelers);
    if (params.preferences) setPreferences(params.preferences);
    const chatDuration = computeDurationDays(params.startDate, params.endDate);
    await aiGenerator.generate({ destination: params.destination, duration: chatDuration, travelers: params.travelers, preferences: params.preferences || undefined });
    goToStep(3);
  };

  /** Runs one assistant page action against this page's own state.
   *
   * Every judgement about whether the named thing exists is made HERE, not by
   * the model: a destination must be one the catalogue has, a date pair must be
   * a usable range, a day must be one of this trip's. What fails returns a
   * sentence for the transcript instead of throwing — the visitor asked for
   * something, and the reply has to say what happened either way.
   *
   * The assistant never submits: this page's actions write form state, generate
   * days, and nothing else.
   */
  const runAssistantAction = async (action: AssistantActionPayload): Promise<string> => {
    switch (action.tool) {
      case 'set_destination': {
        const match = findDestination(action.destination);
        if (!match) return `I don't have "${action.destination}" as a destination — pick one on the destination step.`;
        setSelectedDest(match);
        return `Set your destination to ${destLabel(match)}.`;
      }

      case 'set_travellers':
        setTravelers(action.travelers);
        return `Set ${pluralize(action.travelers, 'traveller')}.`;

      case 'set_preferences':
        setPreferences(action.preferences);
        return 'Saved your preferences.';

      case 'set_contact_details': {
        if (action.field === 'email') {
          if (!EMAIL_SHAPE.test(action.value)) return 'That email address does not look complete — say it again?';
          setEmail(action.value);
          return 'Saved your email address.';
        }
        if (action.field === 'phone') {
          if (action.value.replace(/\D/g, '').length < 6) return 'That phone number does not look complete — say it again?';
          setPhone(action.value);
          return 'Saved your phone number.';
        }
        setName(action.value);
        return 'Saved your name.';
      }

      case 'go_to_step':
        goToStep(Math.min(4, Math.max(1, action.step)));
        return '';

      case 'generate_itinerary': {
        const destination = destLabel(selectedDest);
        if (!destination || duration === 0) {
          return 'I need the destination and the dates before I can build the plan.';
        }
        const outcome = await aiGenerator.generate({
          destination,
          duration,
          travelers,
          preferences: preferences || undefined,
        });
        if (outcome === 'generated') {
          goToStep(3);
          return 'Generated your day-by-day plan.';
        }
        if (outcome === 'cancelled') return 'Left the plan as it was.';
        return 'The plan did not generate — the page shows the error.';
      }

      case 'regenerate_days': {
        const kept = action.dayNumbers.filter((dayNumber) => dayNumber >= 1 && dayNumber <= duration);
        if (kept.length === 0) return 'None of those days are in this plan.';
        const outcome = await aiDayGenerator.generateDays(kept);
        if (outcome === 'generated') return `Regenerated ${pluralize(kept.length, 'day')}.`;
        // The hook's own banner names the days that are still missing, so this
        // line points at it rather than inventing a count of its own.
        if (outcome === 'partial') return 'Regenerated some of those days — the page names what is still missing.';
        return 'Regenerating those days failed — the page shows the error.';
      }

      case 'edit_day': {
        const day = itineraryDays.find((entry) => entry.dayNumber === action.dayNumber);
        if (!day) return `There is no Day ${action.dayNumber} in this plan.`;

        const next: ItineraryDay = { ...day };
        let changed = false;
        let unmatchedRemoval = false;

        switch (action.operation) {
          case 'set_title':
          case 'set_notes': {
            const text = action.values.join(' ').trim();
            const field = action.operation === 'set_title' ? 'title' : 'notes';
            if (text && text !== day[field]) {
              next[field] = text;
              changed = true;
            }
            break;
          }
          case 'add_activities':
          case 'remove_activities':
          case 'add_locations':
          case 'remove_locations': {
            const field = action.operation.endsWith('activities') ? 'activities' : 'locations';
            const entries =
              action.operation.startsWith('add')
                ? withAddedEntries(day[field], action.values)
                : withoutMatchingEntries(day[field], action.values);
            if (entries === day[field]) {
              unmatchedRemoval = action.operation.startsWith('remove');
              break;
            }
            next[field] = entries;
            changed = true;
            break;
          }
        }

        if (unmatchedRemoval) return `Day ${action.dayNumber} does not list that, so I left it alone.`;
        if (!changed) return `Day ${action.dayNumber} already says that.`;

        const snapshot = itineraryDays;
        setItineraryDays((prev) => prev.map((entry) => (entry.dayNumber === day.dayNumber ? next : entry)));
        setRegenToast({
          message: `Day ${day.dayNumber} updated`,
          undo: () => setItineraryDays(snapshot),
        });
        return `Updated Day ${day.dayNumber}.`;
      }

      default:
        // search_travel_info is server-executed, so it can never be registered
        // here; anything else is an action this page does not implement.
        return 'That is not something I can change on this page.';
    }
  };

  // Registered on every render on purpose: the store behind this keeps a ref, not
  // state, so a fresh registration costs one ref assignment and gives the
  // assistant the live state it is about to change. Memoising it would hand the
  // runner a closure over stale days and dates.
  const assistantRegistration: AssistantPageRegistration = {
    surface: 'planner',
    // Identity, not content: this page is the planner whichever step it is on.
    revision: 'planner',
    pageContext: {
      surface: 'planner',
      revision: 'planner',
      step,
      destination: destLabel(selectedDest) || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      duration: duration || undefined,
      travelers,
      preferences: preferences || undefined,
      days: itineraryDays.map((day) => ({ dayNumber: day.dayNumber, title: day.title || undefined })),
    },
    actions: ASSISTANT_ACTIONS,
    runAction: runAssistantAction,
  };

  useAssistantPageRegistration(assistantRegistration);

  return (
    <div className="min-h-screen bg-white font-body">
      {regenToast && (
        <RegenerationToast
          message={regenToast.message}
          onUndo={() => {
            regenToast.undo();
            setRegenToast(null);
          }}
          onDismiss={() => setRegenToast(null)}
        />
      )}
      <div className="w-full mx-auto px-3 sm:px-4 md:px-6 lg:px-8 pt-24 pb-6 sm:pt-28 sm:pb-8 md:pt-32 md:pb-12 max-w-5xl">
        <form onSubmit={(e) => { e.preventDefault(); next(); }}>
          <div className="bg-white rounded-2xl sm:rounded-3xl border-2 border-gray-300 p-4 sm:p-5 md:p-6 mb-4 sm:mb-5 md:mb-6 shadow-sm">
            <div className="max-w-5xl mx-auto px-3 sm:px-4 md:px-8">
              <Stepper
                steps={[
                  { label: 'Destination' },
                  { label: 'Dates & Travelers' },
                  { label: 'Plan Itinerary' },
                  { label: 'Contact Info' },
                ]}
                currentStep={step}
              />
            </div>
          </div>
          {/* ==== STEP 1 : Destination ==== */}
          {step === 1 && (
            <div className="bg-white rounded-2xl sm:rounded-3xl border-2 border-brand-200 p-4 sm:p-6 md:p-8 shadow-sm">
              <div className="flex items-center space-x-3 mb-4 sm:mb-6">
                <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gradient-to-br from-brand-500 to-brand-accent-500 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 sm:w-7 h-5 sm:h-7 text-white" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-display">
                  Where do you want to go?
                </h2>
              </div>

              <div className="flex flex-wrap gap-2 mb-4 sm:mb-6">
                <button type="button" onClick={() => setEntryMode('manual')} className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${entryMode === 'manual' ? 'bg-gradient-to-r from-brand-600 to-brand-accent-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  Enter manually
                </button>
                <button type="button" onClick={() => setEntryMode('chat')} className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${entryMode === 'chat' ? 'bg-gradient-to-r from-brand-600 to-brand-accent-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <Zap className="w-3.5 h-3.5" /> Chat with AI
                </button>
                <button type="button" onClick={() => setEntryMode('wizard')} className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 ${entryMode === 'wizard' ? 'bg-gradient-to-r from-brand-600 to-brand-accent-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  <Sparkles className="w-3.5 h-3.5" /> Find a Package with AI
                </button>
              </div>
              {entryMode === 'chat' ? (
                <ItineraryChatPanel onReady={handleChatReady} />
              ) : entryMode === 'wizard' ? (
                <TripWizardPanel />
              ) : (
                <>
                  <div className="mb-4">
                    <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Select or type your destination
                    </label>
                    <DestinationSelector
                      value={selectedDest}
                      onChange={handleDestinationChange}
                      placeholder="Choose your destination..."
                    />
                  </div>

                  {selectedDest && (
                    <div className="mt-4 p-3 sm:p-4 bg-gradient-to-br from-brand-50 to-brand-accent-50 border border-brand-200 rounded-xl">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 sm:w-10 h-8 sm:h-10 bg-gradient-to-r from-brand-500 to-brand-accent-500 rounded-full flex items-center justify-center">
                          <Check className="w-4 sm:w-6 h-4 sm:h-6 text-white" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 text-sm sm:text-lg">{destLabel(selectedDest)}</p>
                          <p className="text-xs sm:text-sm text-gray-600">Destination selected</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ==== STEP 2 : Dates & Travelers ==== */}
          {step === 2 && (
            <div className="bg-white rounded-2xl sm:rounded-3xl border-2 border-gray-300 p-4 sm:p-6 md:p-8 shadow-sm">
              <div className="flex items-center space-x-3 mb-4 sm:mb-6">
                <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                  <Calendar className="w-5 sm:w-7 h-5 sm:h-7 text-white" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 font-display">
                  When & How Many?
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
                <div className="relative">
                  <label className="block text-xs sm:text-sm font-semibold mb-2">Start Date</label>
                  <input
                    readOnly
                    type="text"
                    value={startDate || ""}
                    onClick={() => setShowCal(true)}
                    placeholder="Select start date"
                    aria-invalid={Boolean(dateFieldErrors.start)}
                    aria-describedby={dateFieldErrors.start ? 'start-date-error' : undefined}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white cursor-pointer"
                    required
                  />
                  {dateFieldErrors.start && (
                    <p id="start-date-error" className="mt-1.5 text-xs font-medium text-red-600">
                      {dateFieldErrors.start}
                    </p>
                  )}
                </div>
                <div className="relative">
                  <label className="block text-xs sm:text-sm font-semibold mb-2">End Date</label>
                  <input
                    readOnly
                    type="text"
                    value={endDate || ""}
                    onClick={() => setShowCal(true)}
                    placeholder="Select end date"
                    aria-invalid={Boolean(dateFieldErrors.end)}
                    aria-describedby={dateFieldErrors.end ? 'end-date-error' : undefined}
                    className="w-full px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white cursor-pointer"
                    required
                  />
                  {dateFieldErrors.end && (
                    <p id="end-date-error" className="mt-1.5 text-xs font-medium text-red-600">
                      {dateFieldErrors.end}
                    </p>
                  )}
                </div>
                {showCal && (
                  <div className="absolute left-1/2 transform -translate-x-1/2 mt-4 z-dropdown">
                    <DateRangeCalendar
                      initialStart={startDate}
                      initialEnd={endDate}
                      onChange={(s, e) => { setStartDate(s); setEndDate(e); setShowCal(false); }}
                      onClose={() => setShowCal(false)}
                    />
                  </div>
                )}
              </div>

              {duration > 0 && (
                <div className="mt-4 p-3 sm:p-4 bg-brand-50 border border-brand-200 rounded-xl flex items-center space-x-2">
                  <Clock className="w-4 sm:w-5 h-4 sm:h-5 text-brand-600" />
                  <p className="text-xs sm:text-sm text-brand-800 font-semibold">
                    {pluralize(duration, 'Day')} / {pluralize(Math.max(duration - 1, 0), 'Night')}
                  </p>
                </div>
              )}

              <div className="mt-4 sm:mt-6">
                <label className="block text-xs sm:text-sm font-semibold mb-2 sm:mb-3">Travelers</label>
                <div className="flex items-center space-x-3 sm:space-x-6 bg-gray-50 rounded-xl p-3 sm:p-5">
                  <button
                    type="button"
                    onClick={() => setTravelers(Math.max(1, travelers - 1))}
                    aria-label="Decrease travelers"
                    className="flex size-11 items-center justify-center rounded-full bg-white shadow-md hover:shadow-lg sm:size-12"
                  >
                    <ChevronLeft className="w-4 sm:w-5 h-4 sm:h-5" aria-hidden="true" />
                  </button>
                  <div className="flex-1 text-center" role="status" aria-label="Traveler count" aria-live="polite">
                    <div className="text-2xl sm:text-3xl font-bold text-gray-900 font-display">{travelers}</div>
                    <div className="text-xs sm:text-sm text-gray-600">Person(s)</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTravelers(travelers + 1)}
                    aria-label="Increase travelers"
                    className="flex size-11 items-center justify-center rounded-full bg-white shadow-md hover:shadow-lg sm:size-12"
                  >
                    <ChevronRight className="w-4 sm:w-5 h-4 sm:h-5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="mt-4 sm:mt-6">
                <label className="block text-xs sm:text-sm font-semibold mb-2 sm:mb-3">Trip preferences (optional)</label>
                <textarea
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  placeholder="e.g., Include water sports, prefer beachside hotels, need vegetarian food options..."
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white"
                />
              </div>
            </div>
          )}

          {/* ==== STEP 3 : Day-by-Day Itinerary ==== */}
          {step === 3 && (
            <div className="bg-white rounded-2xl sm:rounded-3xl border-2 border-gray-300 p-4 sm:p-6 md:p-8 shadow-sm space-y-4 sm:space-y-6">
              <div className="flex items-start sm:items-center justify-between mb-4 sm:mb-6 gap-2">
                <div className="flex items-center space-x-2 sm:space-x-3">
                  <div className="w-10 sm:w-12 h-10 sm:h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                    <Zap className="w-5 sm:w-7 h-5 sm:h-7 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg sm:text-2xl font-bold text-gray-900 font-display">
                      Plan Your Itinerary
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1">
                      {pluralize(duration, 'Day')} / {pluralize(Math.max(duration - 1, 0), 'Night')} in {destLabel(selectedDest) || 'destination'}
                    </p>
                  </div>
                </div>
              </div>

              {aiGenerator.error && (
                <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-700 text-xs sm:text-sm font-medium">{aiGenerator.error}</p>
                  {itineraryDays.length === 0 && (
                    <button
                      type="button"
                      onClick={handleAddDay}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[#16a34a] hover:bg-[#15803d] text-white text-xs sm:text-sm rounded-xl font-semibold transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Continue with manual entry
                    </button>
                  )}
                </div>
              )}

              {aiDayGenerator.error && (
                <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-700 text-xs sm:text-sm font-medium">{aiDayGenerator.error}</p>
                </div>
              )}

              {duration === 0 ? (
                <div className="text-center py-8 sm:py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                  <p className="text-xs sm:text-sm text-gray-600 mb-2">Please select travel dates first</p>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="text-sm sm:text-base text-brand-600 hover:text-brand-700 font-semibold"
                  >
                    Go to Dates & Travelers →
                  </button>
                </div>
              ) : itineraryDays.length === 0 ? (
                <div className="text-center py-8 sm:py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                  <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4">Start planning your itinerary</p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleAddDay}
                      className="px-4 sm:px-6 py-2 sm:py-3 bg-[#16a34a] text-white text-xs sm:text-sm rounded-xl hover:bg-[#15803d] transition-colors font-semibold shadow-md flex items-center gap-2"
                    >
                      <Plus className="w-4 sm:w-5 h-4 sm:h-5" />
                      Add Day 1
                    </button>
                    <button
                      type="button"
                      onClick={() => aiGenerator.generate({ destination: destLabel(selectedDest), duration, travelers, preferences: preferences || undefined })}
                      disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                      className="px-4 sm:px-6 py-2 sm:py-3 bg-white border-2 border-brand-500 text-brand-600 text-xs sm:text-sm rounded-xl hover:bg-brand-50 transition-all font-semibold shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiGenerator.isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
                          Generate itinerary with AI
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 sm:space-y-6" data-itinerary-form>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => aiGenerator.generate({ destination: destLabel(selectedDest), duration, travelers, preferences: preferences || undefined })}
                      disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                      className="px-3 sm:px-4 py-2 bg-white border-2 border-brand-500 text-brand-600 text-xs sm:text-sm rounded-xl hover:bg-brand-50 transition-all font-semibold shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiGenerator.isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Regenerate with AI
                        </>
                      )}
                    </button>
                  </div>

                  {/* Navigation and Progress - Only show if more than one day */}
                  {itineraryDays.length > 1 && (
                    <div className="flex items-center justify-between flex-wrap gap-2 sm:gap-4 p-3 sm:p-4 bg-gradient-to-r from-brand-50 to-brand-accent-50 rounded-xl border border-brand-200">
                      <button
                        type="button"
                        onClick={() => setCurrentDayIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentDayIndex === 0}
                        className="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
                      >
                        <ChevronLeft className="w-3 sm:w-4 h-3 sm:h-4" />
                        <span className="hidden sm:inline">Previous</span>
                      </button>
                      <p className="text-xs sm:text-sm font-medium text-gray-700">
                        Day {itineraryDays[currentDayIndex].dayNumber} of {itineraryDays.length} ({duration} total)
                      </p>
                      <button
                        type="button"
                        onClick={() => setCurrentDayIndex(prev => Math.min(itineraryDays.length - 1, prev + 1))}
                        disabled={currentDayIndex === itineraryDays.length - 1}
                        className="px-3 sm:px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
                      >
                        <span className="hidden sm:inline">Next</span>
                        <ChevronRight className="w-3 sm:w-4 h-3 sm:h-4" />
                      </button>
                    </div>
                  )}

                  {/* Progress Indicator - Show when only one day */}
                  {itineraryDays.length === 1 && (
                    <div className="mb-3 sm:mb-4 p-2 sm:p-3 bg-gradient-to-r from-brand-50 to-brand-accent-50 rounded-xl border border-brand-200">
                      <p className="text-xs sm:text-sm font-medium text-gray-700 text-center">
                        Day 1 of {duration} {duration > 1 && '(Click "Add Day 2" below to add more days)'}
                      </p>
                    </div>
                  )}

                  {/* Current Day Form - Only show one day at a time */}
                  {itineraryDays[currentDayIndex] && (
                    <div className="border-2 border-gray-300 rounded-xl bg-gray-50">
                      {/* Day Header — rounds its own top corners (instead of
                          the card wrapper clipping via overflow-hidden) so
                          the Locations field's LocationSelector dropdown,
                          further down this same card, is never clipped. */}
                      <div className="bg-gradient-to-r from-brand-500 to-brand-accent-500 text-white px-6 py-4 rounded-t-xl flex items-center justify-between">
                        <h3 className="font-bold text-lg font-display">
                          Day {itineraryDays[currentDayIndex].dayNumber}
                        </h3>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => aiDayGenerator.generateDay(itineraryDays[currentDayIndex].dayNumber)}
                            disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                            aria-label={`Regenerate day ${itineraryDays[currentDayIndex].dayNumber}`}
                            title={`Regenerate day ${itineraryDays[currentDayIndex].dayNumber}`}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Sparkles className="w-5 h-5 text-white" />
                          </button>
                          {itineraryDays.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveDay(itineraryDays[currentDayIndex].dayNumber)}
                              disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                              className="p-2 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Remove this day"
                            >
                              <Trash2 className="w-5 h-5 text-white" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Day Content */}
                      <div
                        className={`relative p-6 space-y-4 bg-white rounded-b-xl ${
                          aiGenerator.isGenerating || aiDayGenerator.generatingDayNumber === itineraryDays[currentDayIndex].dayNumber
                            ? 'opacity-50 pointer-events-none'
                            : ''
                        }`}
                        aria-busy={aiDayGenerator.generatingDayNumber === itineraryDays[currentDayIndex].dayNumber}
                      >
                        {aiDayGenerator.generatingDayNumber === itineraryDays[currentDayIndex].dayNumber && (
                          <div
                            className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-b-xl"
                            role="status"
                            aria-live="polite"
                          >
                            <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
                            <span className="sr-only">Regenerating day {itineraryDays[currentDayIndex].dayNumber}…</span>
                          </div>
                        )}
                        {/* Title */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Day Title *
                          </label>
                          <input
                            type="text"
                            value={itineraryDays[currentDayIndex].title || ''}
                            onChange={(e) => handleDayChange(itineraryDays[currentDayIndex].dayNumber, 'title', e.target.value)}
                            placeholder={`e.g., Arrival in ${destLabel(selectedDest) || 'destination'}`}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                            required
                          />
                        </div>

                        {/* Locations */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Locations to Visit
                          </label>
                          <LocationSelector
                            locations={itineraryDays[currentDayIndex].locations || []}
                            onChange={(locations) => handleDayChange(itineraryDays[currentDayIndex].dayNumber, 'locations', locations)}
                            destination={selectedDest}
                          />
                        </div>

                        {/* Activities */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Activities
                          </label>
                          <ActivitySelector
                            activities={itineraryDays[currentDayIndex].activities || []}
                            onChange={(activities) => handleDayChange(itineraryDays[currentDayIndex].dayNumber, 'activities', activities)}
                          />
                        </div>

                        {/* Accommodation */}
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Accommodation Name
                            </label>
                            <input
                              type="text"
                              value={itineraryDays[currentDayIndex].accommodation?.name || ''}
                              onChange={(e) => handleDayNestedChange(itineraryDays[currentDayIndex].dayNumber, 'accommodation', 'name', e.target.value)}
                              placeholder="e.g., Grand Hotel"
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                              Accommodation Type
                            </label>
                            <select
                              value={itineraryDays[currentDayIndex].accommodation?.type || 'hotel'}
                              onChange={(e) => handleDayNestedChange(itineraryDays[currentDayIndex].dayNumber, 'accommodation', 'type', e.target.value)}
                              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                            >
                              {accommodationTypes.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Meals */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Meals Included
                          </label>
                          <div className="flex gap-4">
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={itineraryDays[currentDayIndex].meals?.breakfast || false}
                                onChange={(e) => handleDayNestedChange(itineraryDays[currentDayIndex].dayNumber, 'meals', 'breakfast', e.target.checked)}
                                className="w-5 h-5 text-brand-600 border-gray-300 rounded focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-700 flex items-center gap-1">
                                <Coffee className="w-4 h-4" /> Breakfast
                              </span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={itineraryDays[currentDayIndex].meals?.lunch || false}
                                onChange={(e) => handleDayNestedChange(itineraryDays[currentDayIndex].dayNumber, 'meals', 'lunch', e.target.checked)}
                                className="w-5 h-5 text-brand-600 border-gray-300 rounded focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-700 flex items-center gap-1">
                                <UtensilsCrossed className="w-4 h-4" /> Lunch
                              </span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={itineraryDays[currentDayIndex].meals?.dinner || false}
                                onChange={(e) => handleDayNestedChange(itineraryDays[currentDayIndex].dayNumber, 'meals', 'dinner', e.target.checked)}
                                className="w-5 h-5 text-brand-600 border-gray-300 rounded focus:ring-brand-500"
                              />
                              <span className="text-sm text-gray-700 flex items-center gap-1">
                                <UtensilsCrossed className="w-4 h-4" /> Dinner
                              </span>
                            </label>
                          </div>
                        </div>

                        {/* Transport */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Transport
                          </label>
                          <select
                            value={itineraryDays[currentDayIndex].transport || ''}
                            onChange={(e) => handleDayChange(itineraryDays[currentDayIndex].dayNumber, 'transport', e.target.value)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                          >
                            <option value="">Select transport</option>
                            {transportOptions.map(opt => {
                              const Icon = opt.icon;
                              return (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              );
                            })}
                          </select>
                        </div>

                        {/* Day Notes */}
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">
                            Day Notes
                          </label>
                          <textarea
                            rows={2}
                            value={itineraryDays[currentDayIndex].notes || ''}
                            onChange={(e) => handleDayChange(itineraryDays[currentDayIndex].dayNumber, 'notes', e.target.value)}
                            placeholder="Any special requests or notes for this day..."
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Add Day Button */}
                  {itineraryDays.length < duration && (
                    <div className="flex justify-center pt-4">
                      <button
                        type="button"
                        onClick={handleAddDay}
                        disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                        className="px-6 py-3 bg-[#16a34a] text-white rounded-xl hover:bg-[#15803d] transition-colors font-semibold shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-5 h-5" />
                        Add Day {itineraryDays.length + 1}
                      </button>
                    </div>
                  )}

                  {/* Fill remaining days with AI — subtle secondary action, shown whenever unfilled slots exist */}
                  {missingDayNumbers.length > 0 && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => aiDayGenerator.generateDays(missingDayNumbers)}
                        disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                        className="min-h-[44px] px-4 py-2 text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors text-xs sm:text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {aiDayGenerator.isGenerating && aiDayGenerator.generatingDayNumber === null ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating {pluralize(missingDayNumbers.length, 'day')}...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            Generate remaining {pluralize(missingDayNumbers.length, 'day')} with AI
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Info message when all days are added */}
                  {itineraryDays.length === duration && duration > 0 && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                      <p className="text-green-700 text-sm font-medium text-center">
                        ✓ All {duration} days have been added to your itinerary
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}

          {/* ==== STEP 4 : Contact ==== */}
          {step === 4 && (
            <div className="bg-white rounded-3xl border-2 border-gray-300 p-8 shadow-sm">
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                  <Users className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 font-display">Your Contact Details</h2>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-sm font-semibold text-gray-700">Full Name</label>
                      <span className="text-xs text-gray-500">(Optional)</span>
                    </div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-sm font-semibold text-gray-700">Email Address</label>
                      <span className="px-2 py-0.5 text-xs font-bold text-brand-600 bg-brand-100 rounded-full">Required</span>
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-brand-500/30 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                      required
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label className="block text-sm font-semibold text-gray-700">Phone Number</label>
                      <span className="text-xs text-gray-500">(Optional)</span>
                    </div>
                    <PhoneInput
                      international
                      defaultCountry="LK"
                      value={phone}
                      onChange={(value) => setPhone(value || '')}
                      className="phone-input-wrapper"
                      placeholder="Enter phone number"
                    />
                  </div>
                </div>

                {/* full trip summary */}
                <div>
                  <div className="bg-gradient-to-br from-brand-50 to-brand-accent-50 rounded-2xl p-6 border border-brand-200 h-full">
                    <h3 className="font-bold mb-4 flex items-center text-lg">
                      <Check className="w-5 h-5 mr-2 text-brand-600" /> Trip Summary
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                      <div>
                        <div className="text-xs text-gray-500">Destination</div>
                        <div className="font-semibold">{destLabel(selectedDest) || '—'}</div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500">Dates</div>
                        <div className="font-semibold">{startDate ? startDate : '—'} {startDate && endDate ? `→ ${endDate}` : ''}</div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500">Duration</div>
                        <div className="font-semibold">{duration} days</div>
                      </div>

                      <div>
                        <div className="text-xs text-gray-500">Travelers</div>
                        <div className="font-semibold">{travelers}</div>
                      </div>

                      <div className="sm:col-span-2">
                        <div className="text-xs text-gray-500">Itinerary Days</div>
                        <div className="font-semibold">{itineraryDays.length} days planned</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==== Validation Message ==== */}
          {validationMsg && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-red-700 text-sm font-medium">{validationMsg}</p>
            </div>
          )}

          {/* ==== Navigation Buttons ==== */}
          <div className="flex gap-4 mt-10">
            {step > 1 && (
              <button
                type="button"
                onClick={back}
                disabled={isSubmitting}
                className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
                <span>Back</span>
              </button>
            )}
            <button
              type="button"
              onClick={next}
              disabled={nextDisabled}
              aria-busy={isSubmitting}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold flex items-center justify-center space-x-2 transition-colors ${
                nextDisabled
                  ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  : 'bg-[#16a34a] hover:bg-[#15803d] text-white'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  <span aria-live="polite">Submitting...</span>
                </>
              ) : (
                <>
                  <span>{step === 4 ? "Submit Itinerary" : "Next"}</span>
                  {step < 4 && <ChevronRight className="w-5 h-5" />}
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* SUCCESS MODAL */}
      {showSuccess && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-modal flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Successfully Submitted!
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                Your manual itinerary request has been submitted successfully! Our travel experts will review your itinerary and contact you soon at {email}.
              </p>
              <button
                onClick={() => {
                  setShowSuccess(false);
                  goToStep(1);
                  setSelectedDest(null);
                  setStartDate('');
                  setEndDate('');
                  setTravelers(2);
                  setName('');
                  setEmail('');
                  setPhone('');
                  setItineraryDays([]);
                  setValidationMsg('');
                }}
                className="w-full px-4 py-2 bg-[#16a34a] text-white rounded-md hover:bg-[#15803d]"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Sparkles, MessageCircle, Phone } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { fetchPackageById } from '../../services/api/packages';
import type { NormalizedPackage } from '../../services/api/packages.transform';
import { submitCustomizationRequest } from '../../services/api/customization';
import { apiErrorMessage } from '@/services/http/apiErrorMessage';
import { formatCurrency } from '../../lib/currency';
import { pluralize } from '../../lib/pluralize';
import { categoryImage } from '../../config/media';
import { useAuth } from '../../contexts/AuthContext';
import BRANDING, { getWhatsAppUrl } from '../../config/branding';
import { FLOATING_ACTIONS_CONFIG } from '../../config/floatingActions';
import ActivitySelector from '../../components/shared/ActivitySelector';
import LocationSelector from '../../components/shared/LocationSelector';
import Stepper from '../../components/shared/Stepper';
import { buildDayState, computeMissingDayNumbers, mergeDayByNumber, mergeDaysByNumber, splitTextToList, toExistingDayContext, withAddedEntries, withoutMatchingEntries } from './utils/formHelpers';
import type { DayOverrideState } from './utils/formHelpers';
import { useAIItineraryGenerator } from './hooks/useAIItineraryGenerator';
import { useAIDayGenerator } from './hooks/useAIDayGenerator';
import RegenerationToast from './components/RegenerationToast';
import { useAssistantPageRegistration } from '../assistant/capabilities/AssistantCapabilityProvider';
import type { AssistantActionPayload, AssistantPageAction, AssistantPageRegistration } from '../assistant/capabilities/AssistantCapabilityProvider';

/** Step labels for the shared Stepper — must match the five per-step titles below. */
const CUSTOMIZE_STEPS = [
  { label: 'Contact' },
  { label: 'Travel' },
  { label: 'Itinerary' },
  { label: 'Notes' },
  { label: 'Review' },
];

const WHATSAPP_HELP_MESSAGE =
  "Hello! I'm customizing a trip and have a question before submitting my request.";

/** The page actions this page executes, sent to the assistant every turn. */
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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const callEnabled = FLOATING_ACTIONS_CONFIG.call.enabled;
const whatsappEnabled = FLOATING_ACTIONS_CONFIG.whatsapp.enabled;

interface ContactState {
  name: string;
  email: string;
  phone: string;
}

interface TravelPrefsState {
  // The travelers input is a number field; its raw value arrives as a string.
  travelers: number | string;
  travelDate: string;
}

/** Optional prefill carried via navigate() state — set by TripWizardPanel's
 * complete_wizard exit path. Absent for every other entry point (e.g. the
 * package details page's "Customize" link), which keeps existing defaults. */
interface WizardPrefillState {
  travelers?: number;
  preferences?: string;
}

export default function CustomizePackageContainer() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const wizardPrefill = (location.state as WizardPrefillState | null) || null;
  const [pkg, setPkg] = useState<NormalizedPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [contact, setContact] = useState<ContactState>({
    name: '',
    email: '',
    phone: '',
  });

  const [travelPrefs, setTravelPrefs] = useState<TravelPrefsState>({
    travelers: wizardPrefill?.travelers ?? 2,
    travelDate: '',
  });

  const [message, setMessage] = useState(wizardPrefill?.preferences ?? '');
  const [dayOverrides, setDayOverrides] = useState<DayOverrideState[]>([]);
  const aiGenerator = useAIItineraryGenerator<DayOverrideState>({
    hasExistingDays: () => dayOverrides.length > 0,
    mapDay: buildDayState,
    onGenerated: setDayOverrides,
  });
  const totalDurationDays = pkg?.duration_days ?? 0;
  const missingDayNumbers = computeMissingDayNumbers(totalDurationDays, dayOverrides.map((d) => d.dayNumber));
  const [regenToast, setRegenToast] = useState<{ message: string; undo: () => void } | null>(null);
  const aiDayGenerator = useAIDayGenerator<DayOverrideState>({
    getContext: () => ({
      destination: pkg?.destination?.name || pkg?.destinationRaw || '',
      totalDuration: totalDurationDays,
      travelers: Number(travelPrefs.travelers) || undefined,
      preferences: message || undefined,
      existingDays: dayOverrides.map(toExistingDayContext),
    }),
    mapDay: (aiDay, dayNumber) => buildDayState(aiDay, dayNumber - 1),
    onDayGenerated: (day, dayNumber) => {
      setDayOverrides((prev) => {
        // Snapshot-based, not dayNumber-keyed: restoring "whatever day now
        // holds this number" is unsound if the day list changes shape
        // between generation and Undo (see PlanYourTripContainer, which
        // hits this directly via handleRemoveDay's renumbering). Restoring
        // the exact pre-merge array is correct regardless.
        const snapshot = prev;
        setRegenToast({ message: `Day ${dayNumber} regenerated`, undo: () => setDayOverrides(snapshot) });
        return mergeDayByNumber(prev, day);
      });
    },
    onDaysGenerated: (days, requestedDayNumbers) => {
      setDayOverrides((prev) => {
        const snapshot = prev;
        if (days.length === requestedDayNumbers.length) {
          setRegenToast({ message: `${pluralize(days.length, 'day')} generated`, undo: () => setDayOverrides(snapshot) });
        }
        return mergeDaysByNumber(prev, days);
      });
    },
  });
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;

  // Prefill contact details for logged-in users
  useEffect(() => {
    if (user) {
      setContact((prev) => ({
        ...prev,
        name: prev.name || user.name || '',
        email: prev.email || user.email || '',
        phone: prev.phone || user.phone || '',
      }));
    }
  }, [user]);

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchPackageById(id)
      .then((data) => {
        if (!isMounted) return;
        setPkg(data);

        // Get itinerary days (activities/locations flattened by packages.transform.ts)
        const itineraryDays = data?.itinerary || [];

        const initialDays = Array.isArray(itineraryDays)
          ? itineraryDays.map((day, index) => buildDayState(day, index))
          : [];
        setDayOverrides(initialDays);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(apiErrorMessage(err));
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  const heroImage = useMemo(
    () => pkg?.image_url || pkg?.images?.[0] || categoryImage(pkg?.category),
    [pkg],
  );

  const handleDayChange = (index: number, field: string, value: unknown) => {
    setDayOverrides((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value } as DayOverrideState;
      return next;
    });
  };

  const handleAddDay = () => {
    setDayOverrides((prev) => {
      const nextIndex = prev.length + 1;
      return [
        ...prev,
        {
          id: `day-${nextIndex}`,
          dayNumber: nextIndex,
          title: `Day ${nextIndex}`,
          description: '',
          activities: [],
          locations: [],
        },
      ];
    });
  };

  const handleRemoveDay = (index: number) => {
    setDayOverrides((prev) => prev.filter((_, idx) => idx !== index));
  };

  /** Runs one assistant page action against this page's own state.
   *
   * This page owns the contact details, one travel date, the notes box and the
   * per-day activities/locations — nothing else. An action naming a field this
   * page does not have has that field dropped and says so; a day regenerates
   * through the page's own AI call, never through a second implementation.
   */
  const tripDestination = pkg?.destination?.name || pkg?.destinationRaw || '';

  const runAssistantAction = async (action: AssistantActionPayload): Promise<string> => {
    switch (action.tool) {
      case 'set_destination':
        return `This page is for the ${pkg?.title ? `${pkg.title} trip` : 'trip you picked'} — the destination comes from the package. Set it on the trip planner instead.`;

      case 'set_travellers':
        setTravelPrefs((prev) => ({ ...prev, travelers: action.travelers }));
        return `Set ${pluralize(action.travelers, 'traveller')}.`;

      case 'set_preferences':
        setMessage(action.preferences);
        return 'Saved your notes.';

      case 'set_contact_details': {
        if (action.field === 'email') {
          if (!EMAIL_SHAPE.test(action.value)) return 'That email address does not look complete — say it again?';
          setContact((prev) => ({ ...prev, email: action.value }));
          return 'Saved your email address.';
        }
        if (action.field === 'phone') {
          if (action.value.replace(/\D/g, '').length < 6) return 'That phone number does not look complete — say it again?';
          setContact((prev) => ({ ...prev, phone: action.value }));
          return 'Saved your phone number.';
        }
        setContact((prev) => ({ ...prev, name: action.value }));
        return 'Saved your name.';
      }

      case 'go_to_step':
        setCurrentStep(Math.min(totalSteps, Math.max(1, action.step)));
        return '';

      case 'generate_itinerary': {
        if (!tripDestination || totalDurationDays === 0) {
          return 'This trip has no dates or length yet, so there is nothing to rebuild.';
        }
        const outcome = await aiGenerator.generate({
          destination: tripDestination,
          duration: totalDurationDays,
          travelers: Number(travelPrefs.travelers) || undefined,
          preferences: message || undefined,
        });
        if (outcome === 'generated') {
          setCurrentStep(3);
          return 'Rebuilt the day-by-day plan.';
        }
        if (outcome === 'cancelled') return 'Left the plan as it was.';
        return 'The plan did not generate — the page shows the error.';
      }

      case 'regenerate_days': {
        const kept = action.dayNumbers.filter((dayNumber) => dayNumber >= 1 && dayNumber <= totalDurationDays);
        if (kept.length === 0) return 'None of those days are in this trip.';
        const outcome = await aiDayGenerator.generateDays(kept);
        if (outcome === 'generated') return `Regenerated ${pluralize(kept.length, 'day')}.`;
        if (outcome === 'partial') return 'Regenerated some of those days — the page names what is still missing.';
        return 'Regenerating those days failed — the page shows the error.';
      }

      case 'edit_day': {
        const day = dayOverrides.find((entry) => entry.dayNumber === action.dayNumber);
        if (!day) return `There is no Day ${action.dayNumber} in this trip.`;

        const next: DayOverrideState = { ...day };
        let changed = false;
        let unmatchedRemoval = false;

        switch (action.operation) {
          case 'set_title': {
            const text = action.values.join(' ').trim();
            if (text && text !== day.title) {
              next.title = text;
              changed = true;
            }
            break;
          }
          case 'set_notes':
            // This page's day cards edit activities and locations; the notes box
            // here is the trip's own, not a day's.
            return 'This page has no per-day notes — the trip planner\u2019s day form does.';
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

        const snapshot = dayOverrides;
        setDayOverrides((prev) => prev.map((entry) => (entry.dayNumber === day.dayNumber ? next : entry)));
        setRegenToast({
          message: `Day ${day.dayNumber} updated`,
          undo: () => setDayOverrides(snapshot),
        });
        return `Updated Day ${day.dayNumber}.`;
      }

      default:
        return 'That is not something I can change on this page.';
    }
  };

  // Fresh every render on purpose: the capability store keeps a ref, so this
  // costs one assignment and always hands the assistant the live trip state.
  const assistantRegistration: AssistantPageRegistration = {
    surface: 'customize',
    // Identity, not content: the package is what makes this page itself.
    revision: `customize:${id ?? ''}`,
    pageContext: {
      surface: 'customize',
      revision: `customize:${id ?? ''}`,
      step: currentStep,
      destination: tripDestination || undefined,
      startDate: travelPrefs.travelDate || undefined,
      duration: totalDurationDays || undefined,
      travelers: Number(travelPrefs.travelers) || undefined,
      preferences: message || undefined,
      days: dayOverrides.map((day) => ({ dayNumber: day.dayNumber, title: day.title || undefined })),
    },
    actions: ASSISTANT_ACTIONS,
    runAction: runAssistantAction,
  };

  useAssistantPageRegistration(assistantRegistration);

  const handleNextStep = () => {
    if (currentStep === 1) {
      // Validate email on step 1
      if (!contact.email || !contact.email.trim()) {
        alert('Please enter your email address to continue.');
        return;
      }
    }
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Double-submit guard: the disabled button alone is not enough — repeat
    // submit events (e.g. Enter-key re-fire) must be ignored while a request
    // is in flight.
    if (isSubmitting) return;
    if (!pkg) return;

    if (!contact.email) {
      alert('Please fill in your email address.');
      return;
    }

    const packageId = pkg.id || pkg?.raw?._id;
    if (!packageId) {
      alert('Unable to submit customization request. Please try again later.');
      return;
    }

    const payload = {
      packageId,
      name: contact.name?.trim() || '',
      email: contact.email.trim(),
      phone: contact.phone?.trim() || '',
      travelers: Number(travelPrefs.travelers) || 1,
      travelDate: travelPrefs.travelDate || undefined,
      message: message.trim(),
      overrides: {
        days: dayOverrides.map((day, index) => ({
          dayNumber: Number(day.dayNumber) || index + 1,
          activities: Array.isArray(day.activities) ? day.activities : splitTextToList(day.activities || ''),
          locations: Array.isArray(day.locations) ? day.locations : splitTextToList(day.locations || ''),
        })),
      },
    };

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await submitCustomizationRequest(payload);
      setSuccessModalVisible(true);
    } catch {
      // This endpoint (lead-service's createWebsiteCustomizedPackage) has no
      // availability check and no cross-service rollback — never surface a
      // specific "sold out"/"conflict" claim. Keep the failure generic and
      // leave the form state intact so nothing the visitor typed is lost.
      setSubmitError("We couldn't complete your request — please try again or contact us.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-white">
        <div className="flex flex-col items-center gap-4 text-gray-600">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="font-semibold">Preparing customization experience...</p>
        </div>
      </div>
    );
  }

  if (error || !pkg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 px-4">
        <div className="max-w-lg bg-white rounded-2xl shadow-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-3">Unable to Customize Package</h2>
          <p className="text-gray-600 mb-6">{error || 'The package you are trying to customize could not be found.'}</p>
          <button
            type="button"
            onClick={() => navigate('/packages')}
            className="px-6 py-3 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition"
          >
            Browse other packages
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-gray-50">
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
      <section className="relative isolate flex min-h-[24rem] flex-col justify-end overflow-hidden bg-brand-dark-900 sm:min-h-[27rem] lg:min-h-[30rem]">
        <img
          src={heroImage}
          alt={pkg.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/40" />
        <div className="absolute inset-x-0 top-24 z-10 mx-auto w-full max-w-[1450px] px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-black/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to package
          </button>
        </div>
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-10 pt-42 sm:px-6 sm:pb-14 lg:px-8 lg:pb-16">
          <div className="mb-3 flex items-center gap-2 text-sm text-white/90 sm:mb-4">
            <Sparkles className="h-4 w-4 text-brand-accent-300 sm:h-5 sm:w-5" />
            <span className="font-semibold">Tailored Journey Request</span>
          </div>
          <h1 className="mb-2 max-w-5xl font-display text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
            {pkg.title}
          </h1>
          <p className="mb-6 w-full break-words text-sm text-white/85 sm:mb-8 sm:text-base lg:text-lg">
            {pkg.destination?.name || pkg.destinationRaw}
            {pkg.destination?.country && `, ${pkg.destination.country}`}
          </p>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <div className="rounded-lg border border-white/25 bg-white/10 px-3.5 py-2 backdrop-blur-sm sm:px-4 sm:py-2.5">
              <p className="mb-0.5 text-xs uppercase tracking-wide text-white/75 sm:mb-1">Duration</p>
              <p className="text-lg font-semibold text-white sm:text-xl">{pluralize(pkg.duration_days, 'Day')}</p>
            </div>
            <div className="rounded-lg border border-white/25 bg-white/10 px-3.5 py-2 backdrop-blur-sm sm:px-4 sm:py-2.5">
              <p className="mb-0.5 text-xs uppercase tracking-wide text-white/75 sm:mb-1">From</p>
              <p className="text-lg font-semibold text-white sm:text-xl">{formatCurrency(pkg.price_from)}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 py-6 sm:py-8 md:py-10">       
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200">
          <form onSubmit={handleSubmit} noValidate className="p-4 sm:p-6 lg:p-8">
                {/* Progress Indicator */}
                <div className="mb-8 sm:mb-10">
                  <Stepper steps={CUSTOMIZE_STEPS} currentStep={currentStep} className="mb-6 sm:mb-8" />
                  <div className="text-center">
                    <h2 className="text-xl sm:text-2xl font-bold text-black mb-2">
                      {currentStep === 1 && "Let's start with your contact info"}
                      {currentStep === 2 && "Tell us about your trip"}
                      {currentStep === 3 && "Customize your daily adventures"}
                      {currentStep === 4 && "Anything else we should know?"}
                      {currentStep === 5 && "Review & Submit"}
                    </h2>
                    <p className="text-xs sm:text-sm text-black/60">
                      {currentStep === 1 && "Only your email is required - everything else is optional!"}
                      {currentStep === 2 && "Help us personalize your experience (all optional)"}
                      {currentStep === 3 && "Share activities and locations for each day (optional)"}
                      {currentStep === 4 && "Special requirements or preferences (optional)"}
                      {currentStep === 5 && "Review your details and submit your request"}
                    </p>
                  </div>
                </div>

                {/* Step Content */}
                <div className="min-h-[300px] sm:min-h-[400px]">

                {/* Step 1: Contact Details */}
                {currentStep === 1 && (
                  <div className="mb-8 sm:mb-10">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-6">
                    <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand-100 flex items-center justify-center">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg sm:text-xl font-bold text-black mb-1">How can we reach you?</h3>
                      <p className="text-xs sm:text-sm text-black/60 mb-4 sm:mb-6">We'll send your customized itinerary to your email</p>

                      <div className="space-y-3 sm:space-y-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs sm:text-sm font-medium text-black">What's your name?</span>
                            <span className="text-xs text-black/40">(Optional)</span>
                          </div>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(e) => setContact((prev) => ({ ...prev, name: e.target.value }))}
                            className="w-full px-4 sm:px-5 py-3 sm:py-4 text-base sm:text-lg border-2 border-black/10 rounded-2xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                            placeholder="Your name"
                          />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs sm:text-sm font-medium text-black">What's your email?</span>
                            <span className="px-2 py-0.5 text-xs font-bold text-brand-600 bg-brand-100 rounded-full">Required</span>
                          </div>
                          <input
                            type="email"
                            required
                            value={contact.email}
                            onChange={(e) => setContact((prev) => ({ ...prev, email: e.target.value }))}
                            className="w-full px-4 sm:px-5 py-3 sm:py-4 text-base sm:text-lg border-2 border-brand-500/30 rounded-2xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 bg-white shadow-sm hover:shadow-md"
                            placeholder="your.email@example.com"
                          />
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs sm:text-sm font-medium text-black">Phone number?</span>
                            <span className="text-xs text-black/40">(Optional - for faster communication)</span>
                          </div>
                          <PhoneInput
                            international
                            defaultCountry="LK"
                            value={contact.phone}
                            onChange={(value) => setContact((prev) => ({ ...prev, phone: value || '' }))}
                            className="phone-input-wrapper"
                            placeholder="Enter phone number"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Step 2: Travel Preferences */}
                {currentStep === 2 && (
                  <div className="mb-8 sm:mb-10">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-6">
                    <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand-100 flex items-center justify-center">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg sm:text-xl font-bold text-black mb-1">Tell us about your trip</h3>
                      <p className="text-xs sm:text-sm text-black/60 mb-4 sm:mb-6">Help us personalize your experience</p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                        <div className="bg-white rounded-2xl p-4 sm:p-5 border-2 border-black/5 hover:border-brand-500/30 transition-all shadow-sm hover:shadow-md">
                          <div className="flex items-center gap-2 sm:gap-3 mb-3">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                              </svg>
                            </div>
                            <div>
                              <label className="text-xs sm:text-sm font-semibold text-black">Travelers</label>
                              <p className="text-xs text-black/50">How many people?</p>
                            </div>
                          </div>
                          <input
                            type="number"
                            min="1"
                            value={travelPrefs.travelers}
                            onChange={(e) => setTravelPrefs((prev) => ({ ...prev, travelers: e.target.value }))}
                            className="w-full px-3 sm:px-4 py-2 sm:py-3 text-base sm:text-lg border-2 border-black/10 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-all bg-white"
                            placeholder="2"
                          />
                        </div>

                        <div className="bg-white rounded-2xl p-4 sm:p-5 border-2 border-black/5 hover:border-brand-500/30 transition-all shadow-sm hover:shadow-md">
                          <div className="flex items-center gap-2 sm:gap-3 mb-3">
                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div>
                              <label className="text-xs sm:text-sm font-semibold text-black">Preferred Date</label>
                              <p className="text-xs text-black/50">When do you want to travel?</p>
                            </div>
                          </div>
                          <input
                            type="date"
                            value={travelPrefs.travelDate}
                            onChange={(e) => setTravelPrefs((prev) => ({ ...prev, travelDate: e.target.value }))}
                            className="w-full px-3 sm:px-4 py-2 sm:py-3 text-base sm:text-lg border-2 border-black/10 rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-all bg-white"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Step 3: Itinerary */}
                {currentStep === 3 && (
                  <div className="mb-8 sm:mb-10">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-6">
                    <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand-100 flex items-center justify-center">
                      <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6">
                        <div>
                          <h3 className="text-lg sm:text-xl font-bold text-black mb-1">Customize your daily adventures</h3>
                          <p className="text-xs sm:text-sm text-black/60">
                            Share activities and locations you'd like for each day (optional)
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                          <button
                            type="button"
                            onClick={() =>
                              aiGenerator.generate({
                                destination: pkg?.destination?.name || pkg?.destinationRaw || '',
                                duration: pkg?.duration_days ?? 0,
                                travelers: Number(travelPrefs.travelers) || undefined,
                                preferences: message || undefined,
                              })
                            }
                            disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                            className="px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold text-brand-600 rounded-xl bg-white border-2 border-brand-500 hover:bg-brand-50 shadow-sm hover:shadow-md transition-all duration-200 flex items-center gap-2 whitespace-nowrap flex-1 sm:flex-none justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {aiGenerator.isGenerating ? (
                              <>
                                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                                <span>Generating...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                                <span>Regenerate with AI</span>
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleAddDay}
                            disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                            className="px-4 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-bold text-white rounded-xl bg-brand-600 hover:bg-brand-700 shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2 whitespace-nowrap flex-1 sm:flex-none justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                            <span>Add Day</span>
                          </button>
                        </div>
                      </div>

                      {aiGenerator.error && (
                        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl">
                          <p className="text-red-700 text-xs sm:text-sm font-medium">{aiGenerator.error}</p>
                        </div>
                      )}
                      {aiDayGenerator.error && (
                        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 border border-red-200 rounded-xl">
                          <p className="text-red-700 text-xs sm:text-sm font-medium">{aiDayGenerator.error}</p>
                        </div>
                      )}
                  <div className={`space-y-4 sm:space-y-5 ${aiGenerator.isGenerating ? 'opacity-50 pointer-events-none' : ''}`}>
                    {dayOverrides.map((day, index) => (
                      <div key={day.id} className="relative border border-gray-200 rounded-2xl p-4 sm:p-6 bg-gradient-to-br from-white to-gray-50/50 shadow-sm hover:shadow-md transition-all duration-200" aria-busy={aiDayGenerator.generatingDayNumber === day.dayNumber}>
                        {aiDayGenerator.generatingDayNumber === day.dayNumber && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 rounded-2xl" role="status" aria-live="polite">
                            <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
                            <span className="sr-only">Regenerating day {day.dayNumber}…</span>
                          </div>
                        )}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-5">
                          <div className="flex items-center gap-3 sm:gap-4">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-brand-600 text-white font-bold text-base sm:text-lg flex items-center justify-center shadow-md flex-shrink-0">
                              {index + 1}
                            </div>
                            <div>
                              <h3 className="text-base sm:text-lg font-semibold text-black">Day {index + 1}</h3>
                              {day.title && day.title !== `Day ${index + 1}` && (
                                <p className="text-xs sm:text-sm text-black/70 mt-0.5">{day.title}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => aiDayGenerator.generateDay(day.dayNumber)}
                              disabled={aiGenerator.isGenerating || aiDayGenerator.isGenerating}
                              aria-label={`Regenerate day ${day.dayNumber}`}
                              title={`Regenerate day ${day.dayNumber}`}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-black hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveDay(index)}
                              className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-black hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors duration-200"
                            >
                              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                          <div className="space-y-2">
                            <label className="block text-xs sm:text-sm font-semibold text-black mb-2 flex items-center gap-2">
                              <svg className="w-3 h-3 sm:w-4 sm:h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              Activities
                            </label>
                            <ActivitySelector
                              activities={day.activities || []}
                              onChange={(activities) => handleDayChange(index, 'activities', activities)}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="block text-xs sm:text-sm font-semibold text-black mb-2 flex items-center gap-2">
                              <svg className="w-3 h-3 sm:w-4 sm:h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              Locations / Stops
                            </label>
                            <LocationSelector
                              locations={day.locations || []}
                              onChange={(locations) => handleDayChange(index, 'locations', locations)}
                              destination={pkg.destination?.name || pkg.destinationRaw || ''}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    {!dayOverrides.length && (
                      <div className="border-2 border-dashed border-black/20 rounded-2xl p-8 sm:p-12 text-center bg-gradient-to-br from-white to-brand-50/30">
                        <svg className="w-12 h-12 sm:w-16 sm:h-16 text-black/40 mx-auto mb-3 sm:mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-black font-medium mb-2 text-sm sm:text-base">No itinerary days added yet</p>
                        <p className="text-xs sm:text-sm text-black/70 mb-4">Click "Add Day" to start building your customized itinerary</p>
                        <button
                          type="button"
                          onClick={handleAddDay}
                          className="px-4 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white rounded-xl bg-brand-600 hover:bg-brand-700 shadow-md hover:shadow-lg transition-all duration-200"
                        >
                          Add Your First Day
                        </button>
                      </div>
                    )}
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
                    </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Step 4: Additional Notes */}
                {currentStep === 4 && (
                  <div className="mb-8 sm:mb-10">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-6">
                      <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-brand-100 flex items-center justify-center">
                        <svg className="w-5 h-5 sm:w-6 sm:h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg sm:text-xl font-bold text-black mb-1">Anything else we should know?</h3>
                        <p className="text-xs sm:text-sm text-black/60 mb-4">Special occasions, dietary needs, accessibility requirements, or travel style preferences</p>
                        <textarea
                          rows={5}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          className="w-full px-4 sm:px-5 py-3 sm:py-4 text-sm sm:text-base border-2 border-black/10 rounded-2xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 resize-none bg-white shadow-sm hover:shadow-md"
                          placeholder="Share your thoughts, preferences, or any special requirements..."
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 5: Review & Submit */}
                {currentStep === 5 && (
                  <div className="mb-8 sm:mb-10">
                    <div className="bg-gradient-to-br from-brand-50 to-brand-accent-50 rounded-3xl p-6 sm:p-8 border-2 border-brand-200">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-6">
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl sm:text-2xl font-bold text-black mb-0.5 sm:mb-1">Review Your Request</h3>
                          <p className="text-xs sm:text-sm text-black/70">Everything looks good? Submit and we'll get started!</p>
                        </div>
                      </div>

                      <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-8">
                        <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10">
                          <h4 className="font-semibold text-black mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            Contact Information
                          </h4>
                          <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                            <p><span className="font-medium">Name:</span> {contact.name || <span className="text-black/40">Not provided</span>}</p>
                            <p><span className="font-medium">Email:</span> {contact.email || <span className="text-red-500">Required</span>}</p>
                            <p><span className="font-medium">Phone:</span> {contact.phone || <span className="text-black/40">Not provided</span>}</p>
                          </div>
                        </div>

                        <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10">
                          <h4 className="font-semibold text-black mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            Travel Preferences
                          </h4>
                          <div className="space-y-1 sm:space-y-2 text-xs sm:text-sm">
                            <p><span className="font-medium">Travelers:</span> {travelPrefs.travelers || <span className="text-black/40">Not specified</span>}</p>
                            <p><span className="font-medium">Travel Date:</span> {travelPrefs.travelDate ? new Date(travelPrefs.travelDate).toLocaleDateString() : <span className="text-black/40">Not specified</span>}</p>
                          </div>
                        </div>

                        {dayOverrides.length > 0 && (
                          <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10">
                            <h4 className="font-semibold text-black mb-2 sm:mb-3 flex items-center gap-2 text-sm sm:text-base">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              Itinerary Days
                            </h4>
                            <p className="text-xs sm:text-sm"><span className="font-medium">{dayOverrides.length}</span> day(s) customized</p>
                          </div>
                        )}

                        {message && (
                          <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10">
                            <h4 className="font-semibold text-black mb-2 flex items-center gap-2 text-sm sm:text-base">
                              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Additional Notes
                            </h4>
                            <p className="text-xs sm:text-sm text-black/80">{message}</p>
                          </div>
                        )}
                      </div>

                      {/* Decision-point trust content (Phase 4): price clarity,
                          cancellation/refund + deposit terms, and a human-support
                          escape hatch — surfaced at the exact step the visitor is
                          about to submit. Wording is grounded in this package's
                          price data, existing site copy, and branding.ts contact
                          sources — see the parent report for file:line citations. */}
                      <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 mb-5 sm:mb-6">
                        <h4 className="text-base sm:text-lg font-bold text-gray-900 mb-4">Good to know before you send</h4>
                        <div className="space-y-4 sm:space-y-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">Price</p>
                            {pkg.price_from > 0 ? (
                              <>
                                <p className="text-sm text-gray-600">
                                  <span className="font-semibold text-gray-900">{formatCurrency(pkg.price_from)}</span> is
                                  this package's starting price, shown <span className="font-semibold text-gray-900">per person</span>.
                                </p>
                                <p className="text-sm text-gray-600 mt-1">
                                  Taxes and service fees are included in the price shown above — no hidden fees.
                                </p>
                              </>
                            ) : (
                              <p className="text-sm text-gray-600">
                                Pricing depends on your customizations — this request is free, and your expert confirms the
                                exact quote for your trip.
                              </p>
                            )}
                            <p className="text-sm text-gray-600 mt-1">
                              Submitting this request is free — nothing is charged today, and your expert confirms the
                              final price in your quote.
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">Cancellation &amp; refunds</p>
                            <p className="text-sm text-gray-600">
                              Cancellation and refund terms apply once your trip is booked, not to this request. The
                              standard policy is shown in this package's Booking Terms and our FAQ — your quote will
                              state the exact terms for your trip.
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">Deposit</p>
                            <p className="text-sm text-gray-600">
                              Once you approve your quote and book, a 30% deposit secures your trip; the balance is due
                              before departure.
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-gray-200">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">
                            Questions before you send? Talk to a human:
                          </p>
                          <div className="flex flex-wrap gap-2 sm:gap-3">
                            {callEnabled && (
                              <a
                                href={`tel:${BRANDING.contact.phone}`}
                                aria-label="Call us"
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:border-gray-300 hover:text-brand-700"
                              >
                                <Phone className="w-4 h-4 text-brand-600" aria-hidden="true" />
                                {BRANDING.contact.phone}
                              </a>
                            )}
                            {whatsappEnabled && (
                              <a
                                href={getWhatsAppUrl(WHATSAPP_HELP_MESSAGE)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Chat on WhatsApp"
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:border-gray-300 hover:text-brand-700"
                              >
                                <MessageCircle className="w-4 h-4 text-brand-600" aria-hidden="true" />
                                WhatsApp
                              </a>
                            )}
                            <Link
                              to="/contact"
                              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:border-gray-300 hover:text-brand-700"
                            >
                              Contact page
                            </Link>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
                        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                          <CheckCircle2 className="w-6 h-6 sm:w-7 sm:h-7 text-brand-600" aria-hidden="true" />
                          <h4 className="text-lg sm:text-xl font-bold text-gray-900">Ready to create your perfect trip?</h4>
                        </div>
                        <p className="text-gray-600 mb-4 sm:mb-6 text-xs sm:text-sm">
                          Our travel experts will review your preferences and send you a personalized itinerary within 24 hours.
                        </p>
                        <div className="flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-1.5 text-xs sm:text-sm text-gray-600 mb-5 sm:mb-6">
                          <span className="flex items-center gap-1.5 sm:gap-2">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Expert travel consultants
                          </span>
                          <span className="flex items-center gap-1.5 sm:gap-2">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            24-hour response
                          </span>
                          <span className="flex items-center gap-1.5 sm:gap-2">
                            <svg className="w-3 h-3 sm:w-4 sm:h-4 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            100% personalized
                          </span>
                        </div>
                        {submitError && (
                          <div role="alert" className="mb-4 sm:mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                            <p className="text-sm font-medium text-red-700">{submitError}</p>
                          </div>
                        )}
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          aria-busy={isSubmitting}
                          className="w-full px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg text-white bg-brand-600 hover:bg-brand-700 transition-colors duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" aria-hidden="true" />
                              <span aria-live="polite">Creating Your Request...</span>
                            </>
                          ) : (
                            <>
                              <span>Send My Request</span>
                              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                </div>

                {/* Navigation Buttons */}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    disabled={currentStep === 1}
                    className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center sm:justify-start gap-2 text-sm sm:text-base ${
                      currentStep === 1
                        ? 'opacity-50 cursor-not-allowed text-gray-400'
                        : 'text-black hover:bg-gray-100'
                    }`}
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Previous
                  </button>

                  <div className="text-xs sm:text-sm text-black/60 text-center sm:text-center">
                    Step {currentStep} of {totalSteps}
                  </div>

                  {currentStep < totalSteps ? (
                    <button
                      type="button"
                      onClick={handleNextStep}
                      className="px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2 text-sm sm:text-base w-full sm:w-auto"
                    >
                      Next
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ) : (
                    <div className="w-full sm:w-[100px]"></div>
                  )}
                </div>
              </form>
            </div>
        </div>

      {successModalVisible && (
        <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all duration-300">
            <div className="px-8 py-10">
              <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Thank you!</h2>
              <p className="text-gray-700 text-center leading-relaxed mb-5">Your customization request is in.</p>
              <ul className="space-y-3 text-left text-sm text-gray-700 leading-relaxed">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>
                    No automated confirmation email is sent for customization requests — a travel expert will
                    reach out to you directly instead.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>Your expert will send a personalized itinerary and quote within 24 hours.</span>
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-brand-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span>
                    Nothing is charged today — payment is only due once you approve your final trip (a 30%
                    deposit secures the booking).
                  </span>
                </li>
              </ul>
              <p className="text-center mt-5">
                <Link
                  to="/my-account"
                  className="text-sm font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2"
                >
                  Track your request in My Account
                </Link>
              </p>
            </div>
            <div className="px-8 py-6 bg-gray-50 border-t border-gray-200 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setSuccessModalVisible(false);
                  navigate(`/package/${id}`);
                }}
                className="px-16 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-colors duration-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
  );
}

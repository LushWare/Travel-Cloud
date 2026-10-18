import { type FormEvent, useEffect } from 'react';
import {
  ArrowRight, Calendar, Check, ChevronLeft, Sparkles, Users, X,
} from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Stepper from '@/components/shared/Stepper';

import { useAssistantPageRegistration } from '../../assistant/capabilities/AssistantCapabilityProvider';
import { assistantFieldState, useAssistantWrittenFields } from '../../assistant/actions/useAssistantFormPrefill';
import { AssistantFilledBadge, assistantMarkedFieldClass } from '../../assistant/components/AssistantFieldMarker';

export interface BookingFormData {
  name: string;
  email: string;
  phone: string;
  travelers: number;
  travelDate: Date | string | null;
  endDate: Date | string | null;
  message: string;
}

interface BookingModalProps {
  open: boolean;
  formData: BookingFormData;
  formErrors: Record<string, string>;
  currentStep: number;
  isSubmittingBooking: boolean;
  setFormData: (data: BookingFormData) => void;
  setFormErrors: (errors: Record<string, string>) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

const BOOKING_STEPS = [
  { label: 'Contact' },
  { label: 'Travel' },
  { label: 'Review' },
];

export default function BookingModal({
  open,
  formData,
  formErrors,
  currentStep,
  isSubmittingBooking,
  setFormData,
  setFormErrors,
  onNext,
  onPrevious,
  onSubmit,
  onClose,
}: BookingModalProps) {
  const { written, markWritten, clearWritten } = useAssistantWrittenFields();

  useEffect(() => {
    if (!open) return;

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';

    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  // Registered while the dialog is open, and only then: a modal-hosted form is not
  // a page, so the assistant may fill it exactly as long as it is on screen. The
  // panel raises above the dialog while this is registered (see the widget).
  useAssistantPageRegistration(
    open
      ? {
          surface: 'booking',
          revision: 'booking',
          // `step` is a planner idea; the form reports its own first step.
          pageContext: { surface: 'booking', revision: 'booking', step: 1 },
          actions: ['prefill_form'],
          hostedInDialog: true,
          prefill: {
            form: 'booking',
            fields: () => ({
              name: assistantFieldState(formData.name, written.has('name')),
              email: assistantFieldState(formData.email, written.has('email')),
              phone: assistantFieldState(formData.phone, written.has('phone')),
              travelers: assistantFieldState(formData.travelers, written.has('travelers')),
              message: assistantFieldState(formData.message, written.has('message')),
            }),
            write: (fields) => {
              setFormData({
                ...formData,
                ...(typeof fields.name === 'string' ? { name: fields.name } : {}),
                ...(typeof fields.email === 'string' ? { email: fields.email } : {}),
                ...(typeof fields.phone === 'string' ? { phone: fields.phone } : {}),
                ...(typeof fields.travelers === 'number' ? { travelers: fields.travelers } : {}),
                ...(typeof fields.message === 'string' ? { message: fields.message } : {}),
              });
              markWritten(Object.keys(fields));
            },
          },
        }
      : null,
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92dvh,48rem)] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl bg-white p-0 text-gray-900 shadow-2xl ring-1 ring-black/10 sm:max-w-3xl"
        data-lenis-prevent
      >
        <DialogHeader className="sticky top-0 z-elevated flex-row shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-brand-dark-900 px-6 py-5 text-white sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand-accent-300/40 bg-brand-accent-300/10 text-brand-accent-300 sm:flex">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-accent-300">Trip enquiry</p>
              <DialogTitle className="font-display text-2xl font-semibold leading-tight text-white sm:text-3xl">
                Book Your Adventure
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-white/70">
                Fill in your details and we'll get back to you within 24 hours
              </DialogDescription>
            </div>
          </div>
          <DialogClose
            aria-label="Close booking dialog"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="h-5 w-5" />
          </DialogClose>
        </DialogHeader>

        <div data-booking-scroll className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain bg-neutral-50">
          {/* Step Progress Indicator */}
          <div className="border-b border-neutral-200 px-6 py-5 sm:px-8">
            <Stepper steps={BOOKING_STEPS} currentStep={currentStep} />
          </div>

          <form onSubmit={onSubmit} className="relative space-y-6 bg-white px-4 py-5 sm:px-8 sm:py-8">
            {/* Step 1: Contact Information */}
            {currentStep === 1 && (
              <div className="space-y-5">
                <div>
                  <h4 className="font-display text-2xl font-semibold text-brand-dark-900">Where can we reach you?</h4>
                  <p className="mt-1 text-sm text-gray-600">Add your contact details to get started.</p>
                </div>

                {/* Email - Required */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <label className="block text-sm font-semibold text-gray-800">Email address</label>
                    <span className="text-xs font-medium text-brand-700">Required</span>
                  </div>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => {
                      clearWritten('email');
                      setFormData({...formData, email: e.target.value});
                      if (formErrors.email) {
                        setFormErrors({...formErrors, email: ''});
                      }
                    }}
                    className={`w-full rounded-lg border px-4 py-3 text-sm transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-4 ${
                      formErrors.email
                        ? 'border-red-500 focus:border-red-500 focus:ring-red-100'
                        : `border-gray-300 bg-white focus:border-brand-600 focus:ring-brand-100 ${assistantMarkedFieldClass(written.has('email'))}`
                    }`}
                    placeholder="your.email@example.com"
                  />
                  {written.has('email') && <AssistantFilledBadge />}
                  {formErrors.email && (
                    <p className="text-red-600 text-sm font-semibold mt-2 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {formErrors.email}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  {/* Name - Optional */}
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="block text-sm font-semibold text-gray-800">Full name</label>
                      <span className="text-xs text-gray-500">Optional</span>
                    </div>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => {
                        clearWritten('name');
                        setFormData({...formData, name: e.target.value});
                        if (formErrors.name) {
                          setFormErrors({...formErrors, name: ''});
                        }
                      }}
                      className={`w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm transition-colors placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-100 ${assistantMarkedFieldClass(
                        written.has('name'),
                      )}`}
                      placeholder="John Doe"
                    />
                    {written.has('name') && <AssistantFilledBadge />}
                  </div>

                  {/* Phone - Optional with country code */}
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="block text-sm font-semibold text-gray-800">Phone number</label>
                      <span className="text-xs text-gray-500">Optional</span>
                    </div>
                    <PhoneInput
                      international
                      defaultCountry="LK"
                                              value={formData.phone}
                        onChange={(value) => {
                          clearWritten('phone');
                          setFormData({...formData, phone: value || ''});
                        if (formErrors.phone) {
                          setFormErrors({...formErrors, phone: ''});
                        }
                      }}
                      className="phone-input-wrapper booking-phone-input"
                      placeholder="Enter phone number"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    onClick={onNext}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-700 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                  >
                    Next Step
                    <ArrowRight className="h-4 w-4 text-brand-accent-300" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Travel Details */}
            {currentStep === 2 && (
              <div className="space-y-6">
                {/* Enhanced Header */}
                <div className="border-b border-gray-100 pb-5">
                  <h4 className="font-display text-2xl font-semibold text-brand-dark-900">
                    Plan Your Journey
                  </h4>
                  <p className="mt-1 text-sm text-gray-600">Choose your dates and tell us who is travelling.</p>
                </div>

                {/* Date Range Picker - Enhanced */}
                <div className="w-full rounded-2xl border border-brand-100 bg-brand-50/60 p-3 sm:p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="block text-sm font-semibold text-gray-900">Travel dates</label>
                      <span className="text-xs text-gray-600">Select a start date, then an end date.</span>
                    </div>
                  </div>
                  <div className="flex w-full justify-center overflow-x-auto rounded-xl border border-brand-100 bg-white p-2 sm:p-4">
                    <DatePicker
                        selected={formData.travelDate ? (typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate) : null}
                        onChange={(dates: Date | [Date | null, Date | null] | null) => {
                        // With selectsRange, dates is either [start, end] array or a single Date
                        if (dates) {
                          if (Array.isArray(dates)) {
                            // Both dates selected - [startDate, endDate]
                            const [start, end] = dates;
                            setFormData({
                              ...formData,
                              travelDate: start || null,
                              endDate: end || null,
                            });
                          } else {
                            // Single date clicked - react-datepicker handles range selection automatically
                            // First click sets start, second click sets end
                            // We just need to update our state accordingly
                            if (!formData.travelDate || formData.endDate) {
                              // Starting new selection or resetting
                              setFormData({
                                ...formData,
                                travelDate: dates,
                                endDate: null,
                              });
                            } else {
                              // Second date clicked - set as end date
                              if (dates >= (formData.travelDate as Date)) {
                                setFormData({
                                  ...formData,
                                  endDate: dates,
                                });
                              } else {
                                // Selected date is before start, make it the new start
                                setFormData({
                                  ...formData,
                                  travelDate: dates,
                                  endDate: null,
                                });
                              }
                            }
                          }
                        } else {
                          // Cleared
                          setFormData({
                            ...formData,
                            travelDate: null,
                            endDate: null,
                          });
                        }
                      }}
                      startDate={formData.travelDate ? (typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate) : null}
                      endDate={formData.endDate ? (typeof formData.endDate === 'string' ? new Date(formData.endDate) : formData.endDate) : null}
                      selectsRange
                      inline
                      minDate={new Date()}
                      calendarClassName="booking-calendar"
                    />
                  </div>
                  {formData.travelDate && (
                    <div className={`mt-4 p-4 rounded-xl transition-all duration-300 ${
                      formData.endDate
                        ? 'bg-brand-50 border border-brand-200'
                        : 'bg-neutral-100 border border-neutral-200'
                    }`}>
                      <div className="flex items-center gap-2 justify-center">
                        <Check className={`w-5 h-5 ${formData.endDate ? 'text-green-700' : 'text-brand-700'}`} />
                        <p className={`text-sm font-medium ${formData.endDate ? 'text-brand-800' : 'text-gray-700'}`}>
                          {formData.endDate
                            ? `Selected: ${(typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${(typeof formData.endDate === 'string' ? new Date(formData.endDate) : formData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                            : `Start Date: ${(typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - Select end date`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Enhanced Travelers & Requests Section */}
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {/* Number of Travelers - Enhanced */}
                  <div className="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 p-5 transition-colors hover:border-neutral-300">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="block text-sm font-semibold text-gray-900">Travellers</label>
                        <span className="text-xs text-gray-500">Number of people in your group</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, travelers: Math.max(1, formData.travelers - 1)})}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-lg font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
                        aria-label="Decrease travelers"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="1"
                        value={formData.travelers}
                        onChange={(e) => {
                          clearWritten('travelers');
                          setFormData({...formData, travelers: +e.target.value || 1});
                        }}
                        className={`min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-center text-lg font-semibold focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-100 ${assistantMarkedFieldClass(
                          written.has('travelers'),
                        )}`}
                        placeholder="2"
                        aria-label="Number of travelers"
                      />
                      {written.has('travelers') && <AssistantFilledBadge />}
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, travelers: formData.travelers + 1})}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-lg font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
                        aria-label="Increase travelers"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Special Requests - Enhanced */}
                  <div className="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 p-5 transition-colors hover:border-neutral-300">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="block text-sm font-semibold text-gray-900">Special requests</label>
                        <span className="text-xs text-gray-500">Optional notes for our team</span>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={formData.message}
                      onChange={(e) => {
                        clearWritten('message');
                        setFormData({...formData, message: e.target.value});
                      }}
                      className={`w-full resize-none rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm transition-colors placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-100 ${assistantMarkedFieldClass(
                        written.has('message'),
                      )}`}
                      placeholder="Any dietary requirements, accessibility needs, or special occasions? We're here to make your trip perfect!"
                    />
                    {written.has('message') && <AssistantFilledBadge />}
                  </div>
                </div>

                {/* Navigation Buttons */}
                <div className="flex gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    onClick={onPrevious}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <ChevronLeft className="w-5 h-5" />
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
                  >
                    Next Step
                    <ArrowRight className="h-4 w-4 text-brand-accent-300" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review & Submit */}
            {currentStep === 3 && (
                <div className="space-y-5">
                <div>
                    <h4 className="font-display text-2xl font-semibold text-brand-dark-900">Review your trip request</h4>
                    <p className="mt-1 text-sm text-gray-600">Check your details before sending them to our travel team.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-5 sm:grid-cols-2 sm:p-6">
                  <div className="space-y-3 border-b border-neutral-200 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-5">
                    <h5 className="text-sm font-semibold text-brand-dark-900">Contact details</h5>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p className="break-words"><span className="font-medium text-gray-500">Email</span><br />{formData.email || <span className="text-gray-400">Not provided</span>}</p>
                      <p><span className="font-medium text-gray-500">Name</span><br />{formData.name || <span className="text-gray-400">Not provided</span>}</p>
                      <p><span className="font-medium text-gray-500">Phone</span><br />{formData.phone || <span className="text-gray-400">Not provided</span>}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h5 className="text-sm font-semibold text-brand-dark-900">Travel details</h5>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p><span className="font-medium text-gray-500">Dates</span><br />{
                        formData.travelDate && formData.endDate
                          ? `${(typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${(typeof formData.endDate === 'string' ? new Date(formData.endDate) : formData.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : formData.travelDate
                          ? `${(typeof formData.travelDate === 'string' ? new Date(formData.travelDate) : formData.travelDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (Start only)`
                          : <span className="text-gray-400">Not provided</span>
                      }</p>
                      <p><span className="font-medium text-gray-500">Travellers</span><br />{formData.travelers || 1}</p>
                      <p><span className="font-medium text-gray-500">Special requests</span><br />{formData.message || <span className="text-gray-400">None</span>}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 border-t border-gray-100 pt-5">
                  <button
                    type="button"
                    onClick={onPrevious}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <ChevronLeft className="w-5 h-5" />
                    Previous
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingBooking}
                    aria-busy={isSubmittingBooking}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800 ${
                      isSubmittingBooking ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                  >
                    <span aria-live="polite">
                      {isSubmittingBooking
                        ? 'Submitting...'
                        : 'Submit Booking Request'}
                    </span>
                    <ArrowRight className="h-4 w-4 text-brand-accent-300" />
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

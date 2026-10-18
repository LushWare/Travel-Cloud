import { useState, useEffect } from 'react';
import { Plane, Loader2, AlertCircle, ChevronDown, ChevronUp, Settings2, Pencil, ExternalLink } from 'lucide-react';
import { toast } from '@/lib/toast';
import { OPTIONAL_FLIGHT_TYPE } from '@travel-crm/constants';
import { flightAPI } from '../../../services/flight.service';
import { leadAPI } from '../../../services/api';
import { FlightSelectionModal, FlightPreferenceCard } from '../../shared';
import { getOutboundModalDefaults, oppositeLeg, type FlightLegPrefs, type TripType } from '../../shared/utils/flightLegDefaults';
import { routeChain } from '../../shared/utils/flightSegments';
import { deriveItemState, ITEM_STATE_LABELS, ITEM_STATE_COLORS } from '../utils/bookingState';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(amount: number | null | undefined, currency: string | undefined) {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
}

interface LeadFlightBookingsSectionProps {
  leadId?: string;
  packageId?: string;
  selectionId?: string;
  leadStatus?: string;
  origin?: string;
  destination?: string;
  originCountry?: string;
  destinationCountry?: string;
  itineraryDays?: any[];
  travelDate?: string;
  endDate?: string;
  travelers?: number;
  onUpdateDay?: (dayNumber: number, patch: any) => void;
  onFlightsChanged?: () => void;
}

export default function LeadFlightBookingsSection({
  leadId,
  packageId,
  selectionId,
  leadStatus,
  origin = '',
  destination = '',
  originCountry = '',
  destinationCountry = '',
  itineraryDays = [],
  onUpdateDay,
  travelDate,
  endDate,
  travelers = 1,
  onFlightsChanged,
}: LeadFlightBookingsSectionProps) {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optional transfer flights (LeadOptionalFlight rows — separate from the
  // itinerary-day bookings above, which come from flight-service instead).
  const [optionalFlights, setOptionalFlights] = useState<any[]>([]);

  // Flight modal state
  const [showFlightModal, setShowFlightModal] = useState(false);
  const [flightModalDay, setFlightModalDay] = useState<number | null>(null);
  const [flightModalType, setFlightModalType] = useState<'itinerary' | 'to-start' | 'return-home'>('itinerary');
  const [flightModalPrefill, setFlightModalPrefill] = useState<any>({});
  const [expanded, setExpanded] = useState(true);

  const fetchBookings = async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await flightAPI.getByLead(leadId);
      setBookings(res.data || []);
    } catch (err: any) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchOptionalFlights = async () => {
    if (!leadId || !selectionId) return;
    try {
      const res = await leadAPI.getSelectionFlights(leadId, selectionId);
      setOptionalFlights(res.data || []);
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  useEffect(() => {
    if (leadId) {
      fetchBookings();
      fetchOptionalFlights();
    }
    const refreshWhenActive = () => {
      fetchBookings();
      fetchOptionalFlights();
    };
    window.addEventListener('focus', refreshWhenActive);
    return () => window.removeEventListener('focus', refreshWhenActive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, selectionId]);

  const flightModalTypeToOptionalFlightType: Record<string, string> = {
    'to-start': OPTIONAL_FLIGHT_TYPE.TO_START,
    'return-home': OPTIONAL_FLIGHT_TYPE.RETURN_HOME,
  };

  const handleFlightTemplate = async (prefs: any) => {
    const { tripType, ...leg } = prefs as FlightLegPrefs & { tripType?: TripType };
    const dayNumber = flightModalDay;
    if (dayNumber && onUpdateDay) {
      // Itinerary day flight — save preferences into the day's flights[].
      // Merge into the first flight if one exists, otherwise append a new one
      // with the editor's flight shape (id + totalAmount).
      const day = itineraryDays.find((d) => d.dayNumber === dayNumber);
      const flights = Array.isArray(day?.flights) ? day.flights : [];
      const prefsPatch = {
        origin: leg.origin,
        destination: leg.destination,
        cabinClass: leg.cabinClass,
        departureTime: leg.departureTime,
        airlinePreference: leg.airlinePreference,
        totalAmount: Number(leg.estimatedUnitPrice) || 0,
      };
      onUpdateDay(dayNumber, {
        flights: flights.length > 0
          ? flights.map((f: any, i: number) => (i === 0 ? { ...f, ...prefsPatch } : f))
          : [{
              ...prefsPatch,
              id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `flight-${Date.now()}`,
            }],
      });
      toast.success(`Flight preferences saved for Day ${dayNumber}`);
      fetchBookings();
      return;
    }

    // Optional transfer flight (to-start / return-home) — persisted as a
    // LeadOptionalFlight row. Backend has no update endpoint for a single
    // flight, so editing an existing direction deletes the old row first.
    const flightType = flightModalTypeToOptionalFlightType[flightModalType];
    if (!flightType || !leadId || !selectionId) return;

    try {
      const existing = optionalFlights.find((f) => f.flightType === flightType);
      if (existing) {
        await leadAPI.deleteSelectionFlight(leadId, selectionId, existing.id);
      }
      await leadAPI.addSelectionFlight(leadId, selectionId, {
        flightType,
        origin: leg.origin || undefined,
        destination: leg.destination || undefined,
        cabinClass: leg.cabinClass || undefined,
        departureTime: leg.departureTime || undefined,
        airlinePreference: leg.airlinePreference || undefined,
        estimatedUnitPrice: Number(leg.estimatedUnitPrice) || 0,
      });
      const partnerType = flightType === OPTIONAL_FLIGHT_TYPE.TO_START
        ? OPTIONAL_FLIGHT_TYPE.RETURN_HOME
        : OPTIONAL_FLIGHT_TYPE.TO_START;
      const partnerExists = optionalFlights.some((f) => f.flightType === partnerType);
      if (tripType === 'roundTrip' && !partnerExists) {
        const partner = oppositeLeg(leg);
        if (partner) {
          await leadAPI.addSelectionFlight(leadId, selectionId, {
            flightType: partnerType,
            origin: partner.origin || undefined,
            destination: partner.destination || undefined,
            cabinClass: partner.cabinClass || undefined,
            departureTime: partner.departureTime || undefined,
            airlinePreference: partner.airlinePreference || undefined,
            estimatedUnitPrice: 0,
          });
        }
      }
      toast.success('Flight preferences saved');
      await fetchOptionalFlights();
      onFlightsChanged?.();
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  const handleDeleteOptionalFlight = async (flightId: string) => {
    if (!leadId || !selectionId) return;
    try {
      await leadAPI.deleteSelectionFlight(leadId, selectionId, flightId);
      toast.success('Flight removed');
      fetchOptionalFlights();
      onFlightsChanged?.();
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    }
  };

  // Days that have flights selected in the editor
  const flightDays = itineraryDays.filter((d) => Array.isArray(d.flights) && d.flights.length > 0);
  const toStartFlight = optionalFlights.find((f) => f.flightType === OPTIONAL_FLIGHT_TYPE.TO_START);
  const returnHomeFlight = optionalFlights.find((f) => f.flightType === OPTIONAL_FLIGHT_TYPE.RETURN_HOME);

  const flightSearchHref = (
    dayNumber: number,
    flight: any,
    flightType: 'itinerary' | 'optional' = 'itinerary',
    departureDate = travelDate,
  ) => {
    const params = new URLSearchParams();
    const routeOrigin = String(flight?.origin || '').trim() || origin.trim() || originCountry.trim();
    const routeDestination = String(flight?.destination || '').trim() || destination.trim() || destinationCountry.trim();
    if (routeOrigin) params.set('origin', routeOrigin);
    if (routeDestination) params.set('destination', routeDestination);
    if (departureDate) {
      const departure = new Date(`${departureDate.slice(0, 10)}T12:00:00`);
      if (flightType === 'itinerary') departure.setDate(departure.getDate() + dayNumber - 1);
      params.set('departureDate', departure.toISOString().slice(0, 10));
    }
    params.set('adults', String(Math.max(1, travelers)));
    if (leadId) params.set('leadId', leadId);
    if (packageId) params.set('packageId', packageId);
    if (flightType === 'itinerary') params.set('dayNumber', String(dayNumber));
    params.set('flightType', flightType);
    return `/flights?${params.toString()}`;
  };
  const defaultTransferFlight = toStartFlight || returnHomeFlight;
  const defaultTransferDate = toStartFlight ? travelDate : returnHomeFlight ? endDate || travelDate : travelDate;

  const flightBookingHref = (bookingId: string) =>
    `/flights?tab=bookings&ids=${encodeURIComponent(bookingId)}&bookingId=${encodeURIComponent(bookingId)}&focus=recommendation`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading flight bookings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 rounded-xl bg-primary text-primary-foreground"
      >
        <div className="flex items-center gap-2">
          <Plane className="w-5 h-5" />
          <span className="font-semibold">Flight Bookings</span>
          {bookings.length > 0 && (
            <span className="text-xs bg-primary-foreground/20 px-2 py-0.5 rounded-full">{bookings.length}</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </button>

      {expanded && (
        <div className="space-y-4 p-4 bg-muted/40 rounded-2xl border border-border">
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
              <button onClick={fetchBookings} className="ml-auto text-destructive font-medium hover:underline">Retry</button>
            </div>
          )}

          {/* Itinerary flight days */}
          {flightDays.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Itinerary Flights</div>
              <div className="space-y-2">
                {flightDays.map((day) => {
                  const dayBooking = bookings.find((b) =>
                    b.dayNumber === day.dayNumber
                    && b.flightType === 'itinerary'
                    && (b.packageId || null) === (packageId || null));
                  const booked = !!dayBooking && dayBooking.status !== 'cancelled' && dayBooking.status !== 'failed';
                  const failed = !!dayBooking && dayBooking.status === 'failed';
                  const firstFlight = Array.isArray(day.flights) ? day.flights[0] : null;
                  const hasPrefs = !booked && !failed && firstFlight?.origin;
                  const itemState = deriveItemState(leadStatus ?? '', booked, failed);
                  const stateLabel = ITEM_STATE_LABELS[itemState];
                  const stateColor = ITEM_STATE_COLORS[itemState];
                  return (
                    <div key={day.dayNumber} className="bg-card rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">Day {day.dayNumber}</span>
                          {(booked || hasPrefs) && (
                            <span className="text-sm text-muted-foreground">
                              {dayBooking?.segments?.length
                                ? routeChain(dayBooking.segments)
                                : `${firstFlight?.origin ?? ''} → ${firstFlight?.destination ?? ''}`}
                            </span>
                          )}
                          <span className={`px-1.5 py-0.5 text-xs rounded-full border ${stateColor}`}>
                            {stateLabel}
                          </span>
                        </div>
                        {itemState === 'PENDING' ? (
                          <Button type="button" disabled variant="secondary" size="sm">
                            <Settings2 className="w-3.5 h-3.5" /> Set Preferences
                          </Button>
                        ) : itemState === 'READY_TO_BOOK' ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                setFlightModalDay(day.dayNumber);
                                setFlightModalType('itinerary');
                                setFlightModalPrefill(firstFlight
                                  ? { ...firstFlight, estimatedUnitPrice: firstFlight.totalAmount }
                                  : { origin: '', destination: '' });
                                setShowFlightModal(true);
                              }}
                            >
                              {hasPrefs ? <Pencil className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                              {hasPrefs ? 'Edit preferences' : 'Set preferences'}
                            </Button>
                            <a
                              href={flightSearchHref(day.dayNumber, firstFlight)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Search &amp; book
                            </a>
                          </>
                        ) : itemState === 'BOOKED' ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <a
                              href={flightBookingHref(dayBooking.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open flight booking ${dayBooking.pnr || dayBooking.id}`}
                              className="inline-flex items-center gap-1 font-mono font-medium text-primary hover:underline"
                            >
                              {dayBooking.pnr || '-'} <ExternalLink className="h-3 w-3" />
                            </a>
                            <span className="capitalize">{dayBooking.status}</span>
                            {dayBooking.supplierPortalUrl && (
                              <a href={dayBooking.supplierPortalUrl} target="_blank" rel="noopener noreferrer"
                                 className="flex items-center gap-1 text-primary hover:text-primary/80">
                                <ExternalLink className="w-3 h-3" /> Portal
                              </a>
                            )}
                            {dayBooking.status !== 'cancelled' && (
                              <a
                                href={flightBookingHref(dayBooking.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-destructive hover:text-destructive/80"
                              >
                                <ExternalLink className="w-3 h-3" /> Cancel / manage
                              </a>
                            )}
                          </div>
                        ) : itemState === 'FAILED' && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-destructive font-medium">Booking failed</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setFlightModalDay(day.dayNumber);
                                setFlightModalType('itinerary');
                                setFlightModalPrefill(firstFlight
                                  ? { ...firstFlight, estimatedUnitPrice: firstFlight.totalAmount }
                                  : { origin: '', destination: '' });
                                setShowFlightModal(true);
                              }}
                            >
                              <AlertCircle className="w-3.5 h-3.5" /> Review preferences
                            </Button>
                            <a
                              href={flightSearchHref(day.dayNumber, firstFlight)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Search again
                            </a>
                          </div>
                        )}
                      </div>
                      {booked && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {dayBooking.segments?.map((s: any, i: number) => (
                            <span key={i}>{s.origin} → {s.destination} on {fmtDate(s.departureAt)}{i < (dayBooking.segments?.length || 1) - 1 ? ' · ' : ''}</span>
                          ))}
                          {' · '}{fmtMoney(dayBooking.totalAmount, dayBooking.currency)}
                        </div>
                      )}
                      {failed && (
                        <div className="mt-1 text-xs text-destructive">
                          Booking attempt failed — manual intervention required. Check with supplier or search for alternatives.
                        </div>
                      )}
                      {hasPrefs && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {firstFlight.cabinClass || 'Economy'}
                          {firstFlight.airlinePreference ? ` · ${firstFlight.airlinePreference}` : ''}
                          {firstFlight.departureTime ? ` · ${firstFlight.departureTime}` : ''}
                          {' · '}
                          {Number(firstFlight.totalAmount) > 0
                            ? `$${Number(firstFlight.totalAmount).toFixed(2)} per person`
                            : <span className="text-warning">no cost set — $0 in pricing</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {flightDays.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              <Plane className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No flights in this itinerary</p>
              <a
                href={flightSearchHref(1, defaultTransferFlight || {}, defaultTransferFlight ? 'optional' : 'itinerary', defaultTransferDate)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Search &amp; book a flight
              </a>
            </div>
          )}

          {/* Optional Flights — inline slots: a filled card, or an add-placeholder in its place */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 mt-4">Optional Transfer Flights</div>
            <div className="space-y-3">
              <div>
                <h5 className="text-xs font-medium text-muted-foreground mb-1.5">To Start</h5>
                {toStartFlight ? (
                  <div className="space-y-2">
                    <FlightPreferenceCard
                      prefs={toStartFlight}
                      onEdit={() => {
                        setFlightModalDay(null);
                        setFlightModalType('to-start');
                        setFlightModalPrefill(toStartFlight);
                        setShowFlightModal(true);
                      }}
                      onRemove={() => handleDeleteOptionalFlight(toStartFlight.id)}
                    />
                    <a
                      href={flightSearchHref(1, toStartFlight, 'optional', travelDate)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Search &amp; book
                    </a>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setFlightModalDay(null);
                      setFlightModalType('to-start');
                      setFlightModalPrefill({});
                      setShowFlightModal(true);
                    }}
                    className="w-full py-3 border-2 border-dashed border-primary/30 text-primary rounded-xl hover:bg-primary/5 hover:border-primary/50 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <Settings2 className="w-4 h-4" />
                    Add Flight Preferences to Start
                  </button>
                )}
              </div>

              <div>
                <h5 className="text-xs font-medium text-muted-foreground mb-1.5">Return Home</h5>
                {returnHomeFlight ? (
                  <div className="space-y-2">
                    <FlightPreferenceCard
                      prefs={returnHomeFlight}
                      onEdit={() => {
                        setFlightModalDay(null);
                        setFlightModalType('return-home');
                        setFlightModalPrefill(returnHomeFlight);
                        setShowFlightModal(true);
                      }}
                      onRemove={() => handleDeleteOptionalFlight(returnHomeFlight.id)}
                    />
                    <a
                      href={flightSearchHref(1, returnHomeFlight, 'optional', endDate || travelDate)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Search &amp; book
                    </a>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setFlightModalDay(null);
                      setFlightModalType('return-home');
                      setFlightModalPrefill(getOutboundModalDefaults(toStartFlight, returnHomeFlight));
                      setShowFlightModal(true);
                    }}
                    className="w-full py-3 border-2 border-dashed border-primary/30 text-primary rounded-xl hover:bg-primary/5 hover:border-primary/50 transition-colors flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <Settings2 className="w-4 h-4" />
                    Add Return Flight Preferences
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flight Preference Modal (template mode — saves preferences only, no booking) */}
      <FlightSelectionModal
        isOpen={showFlightModal}
        onClose={() => { setShowFlightModal(false); setFlightModalDay(null); }}
        mode="template"
        allowRoundTrip={flightModalDay == null}
        initialData={{
          ...flightModalPrefill,
          tripType: (flightModalType === 'to-start' ? returnHomeFlight : toStartFlight) ? 'roundTrip' : 'oneWay',
        }}
        onSelectTemplate={handleFlightTemplate}
      />
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  Plane, Search, ChevronRight, ChevronLeft, Loader2,
  CheckCircle2, ArrowRightLeft, Users, Info, AlertCircle,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { flightAPI } from '../../../services/flight.service';
import AirportAutocomplete from '../../../components/AirportAutocomplete';
import PassengerSelector from '../../../components/PassengerSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Card } from '../../../components/ui/card';
import type { TripType, FlightLegSubmission } from '../utils/flightLegDefaults';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { emptyTraveler, fmtMoney, sanitizeTravelerForBooking, statusBucket, stopsLabel, todayStr } from '@/pages/FlightSearch/helpers';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════
type BookingStep = 'form' | 'results' | 'travelers' | 'review' | 'confirmed';
type TravelerType = 'adult' | 'child' | 'infant';

interface TravelerForm {
  type: TravelerType;
  title: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  passengerId?: string;
  infantPassengerId?: string;
  dob: string;
  gender: string;
  passportNumber: string;
  passportExpiry: string;
  nationality: string;
  frequentFlyerNumber: string;
}

interface FlightSegment {
  origin?: string;
  destination?: string;
  departureAt?: string;
  arrivalAt?: string;
  durationMinutes?: number;
  stops?: number;
  marketingCarrier?: string;
  flightNumber?: string;
}

interface FlightOffer {
  offerId: string;
  passengerIds?: string[];
  airline?: string;
  airlineCode?: string;
  cabinClass?: string;
  segments?: FlightSegment[];
  fareTotal?: number;
  baseFare?: number;
  taxes?: number;
  currency?: string;
  refundable?: boolean;
}

interface FlightSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'template' | 'booking';

  // Template mode
  onSelectTemplate?: (template: FlightLegSubmission) => void;
  initialData?: Partial<FlightLegSubmission>;
  /** Offer the One Way / Round Trip control — only consumers with a directional row pair pass this. */
  allowRoundTrip?: boolean;

  // Booking mode
  onBookFlight?: (booking: any) => void;
  travelDate?: string;
  returnDate?: string;
  tripType?: TripType;
  travelers?: TravelerForm[];
  leadContext?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════
function fmtTime(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(mins?: number) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m > 0 ? `${m}m` : ''}`;
}

const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'];
const TRIP_TYPES: { id: TripType; label: string }[] = [
  { id: 'oneWay', label: 'One Way' },
  { id: 'roundTrip', label: 'Round Trip' },
];
const DEPARTURE_TIMES = [
  { id: 'morning', label: 'Morning (6am–12pm)' },
  { id: 'afternoon', label: 'Afternoon (12pm–6pm)' },
  { id: 'evening', label: 'Evening (6pm–12am)' },
];

// ═══════════════════════════════════════════════════════════════════
//  Offer Card (booking mode)
// ═══════════════════════════════════════════════════════════════════
function OfferCard({ offer, onSelect, paxCount }: { offer: FlightOffer; onSelect: (offer: FlightOffer) => void; paxCount: number }) {
  const segs = offer.segments || [];
  const firstSeg = segs[0];
  const lastSeg = segs[segs.length - 1];
  const totalDuration = segs.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

  return (
    <Card className="flex-row items-center gap-4 p-4 flex-col lg:flex-row hover:ring-primary/30 transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {offer.airlineCode}
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{offer.airline}</div>
            <div className="text-xs text-muted-foreground">{offer.cabinClass}</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {offer.refundable && (
              <Badge className="bg-success/10 text-success border-transparent">Refundable</Badge>
            )}
            {firstSeg?.stops === 0 && (
              <Badge className="bg-primary/10 text-primary border-transparent">Direct</Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-1">
          <div className="text-right">
            <div className="text-lg font-bold text-foreground font-mono tabular-nums">{fmtTime(firstSeg?.departureAt)}</div>
            <div className="text-xs font-medium text-muted-foreground">{firstSeg?.origin}</div>
          </div>
          <div className="flex-1 flex flex-col items-center px-2">
            <div className="text-xs text-muted-foreground mb-0.5">{fmtDuration(totalDuration)}</div>
            <div className="w-full h-0.5 bg-border relative">
              <div className="absolute -top-0.5 left-0 w-2 h-1.5 bg-primary rounded-full" />
              <div className="absolute -top-0.5 right-0 w-2 h-1.5 bg-primary rounded-full" />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {segs.length === 1 ? 'Nonstop' : `${segs.length - 1} stop${segs.length > 2 ? 's' : ''}`}
            </div>
          </div>
          <div>
            <div className="text-lg font-bold text-foreground font-mono tabular-nums">{fmtTime(lastSeg?.arrivalAt)}</div>
            <div className="text-xs font-medium text-muted-foreground">{lastSeg?.destination}</div>
          </div>
        </div>
      </div>

      <div className="text-right shrink-0 lg:border-l lg:border-border lg:pl-4">
        <div className="text-xl font-bold text-foreground font-mono tabular-nums">{fmtMoney(offer.fareTotal, offer.currency)}</div>
        <div className="text-xs text-muted-foreground mb-2">
          {paxCount} traveler{paxCount > 1 ? 's' : ''}
        </div>
        <Button onClick={() => onSelect(offer)}>
          Select <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════
export default function FlightSelectionModal({
  isOpen,
  onClose,
  mode = 'template',

  // Template mode
  onSelectTemplate,
  initialData = {},
  allowRoundTrip = false,

  // Booking mode
  onBookFlight,
  travelDate: initialTravelDate,
  returnDate: initialReturnDate,
  tripType: initialTripType = 'oneWay',
  travelers: initialTravelers,
  leadContext = {},
}: FlightSelectionModalProps) {
  // ── Template mode state ─────────────────────────────────────────
  const [template, setTemplate] = useState({
    origin: initialData?.origin || '',
    destination: initialData?.destination || '',
    cabinClass: initialData?.cabinClass || 'Economy',
    departureTime: initialData?.departureTime || '',
    airlinePreference: initialData?.airlinePreference || '',
    estimatedUnitPrice: initialData?.estimatedUnitPrice ?? '',
    tripType: (initialData?.tripType || 'oneWay') as TripType,
  });

  // ── Booking mode state ──────────────────────────────────────────
  const [bookingStep, setBookingStep] = useState<BookingStep>('form');
  const [searchForm, setSearchForm] = useState({
    origin: initialData?.origin || '',
    destination: initialData?.destination || '',
    departureDate: initialTravelDate || todayStr(),
    returnDate: initialReturnDate || '',
    adults: initialTravelers?.filter(t => t.type === 'adult').length || 1,
    children: initialTravelers?.filter(t => t.type === 'child').length || 0,
    infants: initialTravelers?.filter(t => t.type === 'infant').length || 0,
    cabinClass: initialData?.cabinClass || 'Economy',
  });
  const [tripType, setTripType] = useState<TripType>(initialTripType);
  const [searching, setSearching] = useState(false);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<FlightOffer | null>(null);
  const [travelers, setTravelers] = useState<TravelerForm[]>([]);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [booking, setBooking] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const paxCount = searchForm.adults + searchForm.children + searchForm.infants;

  // Reset on open
  useEffect(() => {
    if (isOpen && mode === 'booking') {
      setBookingStep('form');
      setOffers([]);
      setHasSearched(false);
      setSelectedOffer(null);
      setConfirmedBooking(null);
      setSearchError(null);
    } else if (mode === 'template') {
      setTemplate({
        origin: initialData?.origin || '',
        destination: initialData?.destination || '',
        cabinClass: initialData?.cabinClass || 'Economy',
        departureTime: initialData?.departureTime || '',
        airlinePreference: initialData?.airlinePreference || '',
        estimatedUnitPrice: initialData?.estimatedUnitPrice ?? '',
        tripType: (initialData?.tripType || 'oneWay') as TripType,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  const selectOffer = useCallback((offer: FlightOffer) => {
    setSelectedOffer(offer);
    const newTravelers = [
      ...Array.from({ length: searchForm.adults }, () => emptyTraveler('adult')),
      ...Array.from({ length: searchForm.children }, () => emptyTraveler('child')),
      ...Array.from({ length: searchForm.infants }, () => emptyTraveler('infant')),
    ].map((traveler, index) => ({ ...traveler, passengerId: offer.passengerIds?.[index] }));
    const adultPassengerIds = newTravelers.filter((traveler) => traveler.type === 'adult').map((traveler) => traveler.passengerId).filter(Boolean);
    let infantGuardianIndex = 0;
    newTravelers.forEach((traveler) => {
      if (traveler.type === 'infant') traveler.infantPassengerId = adultPassengerIds[infantGuardianIndex++];
    });
    setTravelers(newTravelers);
    setBookingStep('travelers');
  }, [searchForm]);

  // ═══════════════════════════════════════════════════════════════
  //  Template mode handlers
  // ═══════════════════════════════════════════════════════════════
  const handleTemplateSubmit = () => {
    if (allowRoundTrip && template.tripType === 'roundTrip' && (!template.origin || !template.destination)) {
      toast.error('Origin and destination are required for a round trip');
      return;
    }
    onSelectTemplate?.({
      origin: template.origin,
      destination: template.destination,
      cabinClass: template.cabinClass,
      departureTime: template.departureTime,
      airlinePreference: template.airlinePreference,
      estimatedUnitPrice: Number(template.estimatedUnitPrice) || 0,
      tripType: template.tripType,
    });
    onClose();
  };

  const handleTemplateSwap = () => {
    setTemplate(t => ({ ...t, origin: t.destination, destination: t.origin }));
  };

  // ═══════════════════════════════════════════════════════════════
  //  Booking mode handlers
  // ═══════════════════════════════════════════════════════════════
  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchForm.origin || !searchForm.destination || !searchForm.departureDate) {
      toast.error('Origin, destination and departure date are required');
      return;
    }
    if (tripType === 'roundTrip' && !searchForm.returnDate) {
      toast.error('Return date is required for round trips');
      return;
    }

    setSearching(true);
    setHasSearched(true);
    setOffers([]);
    setSearchError(null);

    try {
      const response = await flightAPI.search({
        origin: searchForm.origin,
        destination: searchForm.destination,
        departureDate: searchForm.departureDate,
        returnDate: tripType === 'roundTrip' ? searchForm.returnDate : undefined,
        adults: searchForm.adults,
        children: searchForm.children || 0,
        infants: searchForm.infants || 0,
        cabinClass: searchForm.cabinClass,
        tripType,
      });
      setOffers(response.data || []);
      if (!response.data?.length) toast('No flights found', { type: 'info' });
    } catch (error: any) {
      setSearchError(apiErrorMessage(error));
      toast.error(apiErrorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  const handleSwap = () => {
    setSearchForm(f => ({ ...f, origin: f.destination, destination: f.origin }));
  };

  const updateTraveler = (index: number, field: keyof TravelerForm, value: string) => {
    setTravelers(prev => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const goToReview = () => {
    for (let i = 0; i < travelers.length; i++) {
      const t = travelers[i];
      if (!t.firstName || !t.lastName) {
        toast.error('Every traveler needs a first and last name');
        return;
      }
      if (!t.dob) {
        toast.error(`Date of birth is required for traveler ${i + 1}`);
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email)) {
        toast.error(`A valid passenger email is required for traveler ${i + 1}`);
        return;
      }
      if (!/^\+[1-9]\d{6,14}$/.test(t.phone)) {
        toast.error(`Enter traveler ${i + 1}'s phone in international format`);
        return;
      }
      if (!t.gender) {
        toast.error(`Gender is required for traveler ${i + 1}`);
        return;
      }
    }
    if (!contact.email) {
      toast.error('Contact email is required');
      return;
    }
    setBookingStep('review');
  };

  const confirmBooking = async () => {
    setBooking(true);
    try {
      const payload = {
        offer: selectedOffer,
        tripType,
        travelers: travelers.map((traveler) => sanitizeTravelerForBooking(traveler)),
        contact,
        ...leadContext,
      };
      const response = leadContext.leadId
        ? await flightAPI.bookForLead(payload)
        : await flightAPI.book(payload);
      setConfirmedBooking(response.data);
      setBookingStep('confirmed');
      onBookFlight?.(response.data);
      toast.success('Flight booked successfully');
    } catch (error: any) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBooking(false);
    }
  };

  const maxW = bookingStep === 'form' ? 'sm:max-w-2xl' : bookingStep === 'results' ? 'sm:max-w-4xl' : 'sm:max-w-3xl';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`${mode === 'template' ? 'sm:max-w-lg' : maxW} max-h-[90vh] overflow-y-auto`}>
        {/* ═══════════════════════════════════════════════════════
            Template mode
        ═══════════════════════════════════════════════════════ */}
        {mode === 'template' ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary text-primary-foreground">
                  <Plane className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle>Select Flight Route</DialogTitle>
                  <DialogDescription>Set flight preferences for this itinerary day</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              {allowRoundTrip && (
                <Tabs value={template.tripType} onValueChange={(value) => value && setTemplate({ ...template, tripType: value as TripType })}>
                  <TabsList>
                    {TRIP_TYPES.map(tt => (
                      <TabsTrigger key={tt.id} value={tt.id}>{tt.label}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Origin</label>
                <AirportAutocomplete
                  value={template.origin}
                  onChange={(code: string) => setTemplate({ ...template, origin: code })}
                  placeholder="Departure airport"
                  excludeCode={template.destination}
                />
              </div>
              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={handleTemplateSwap}
                  title="Swap origin and destination"
                  className="p-1.5 rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                >
                  <ArrowRightLeft className="w-4 h-4 rotate-90" />
                </button>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Destination</label>
                <AirportAutocomplete
                  value={template.destination}
                  onChange={(code: string) => setTemplate({ ...template, destination: code })}
                  placeholder="Arrival airport"
                  excludeCode={template.origin}
                />
              </div>
              {allowRoundTrip && template.tripType === 'roundTrip' && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Return leg</div>
                  <div className="text-sm font-semibold text-foreground">
                    {template.destination || '?'} → {template.origin || '?'}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Same cabin and airline. Return date, preferred time and cost are set on the return row.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Cabin Class</label>
                  <Select value={template.cabinClass} onValueChange={(value) => setTemplate({ ...template, cabinClass: String(value) })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CABIN_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Preferred Time</label>
                  <Select value={template.departureTime || '__any__'} onValueChange={(value) => setTemplate({ ...template, departureTime: value === '__any__' ? '' : String(value) })}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{(value: string) => DEPARTURE_TIMES.find(t => t.id === value)?.label ?? 'Any time'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Any time</SelectItem>
                      {DEPARTURE_TIMES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Preferred Airline (optional)</label>
                <Input
                  type="text"
                  value={template.airlinePreference}
                  onChange={(e) => setTemplate({ ...template, airlinePreference: e.target.value.toUpperCase() })}
                  placeholder="e.g., EK, QR, BA"
                  maxLength={3}
                  className="font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Estimated Cost (per person)</label>
                <Input
                  type="number"
                  aria-label="Estimated Cost (per person)"
                  min="0"
                  step="0.01"
                  value={template.estimatedUnitPrice}
                  onChange={(e) => setTemplate({ ...template, estimatedUnitPrice: e.target.value })}
                  placeholder="0.00"
                />
                <p className="mt-1 text-xs text-muted-foreground">Multiplied by the number of travelers in the lead's pricing.</p>
              </div>
            </div>

            <div className="-mx-4 -mb-4 flex gap-3 justify-end bg-muted/50 rounded-b-xl border-t p-4">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleTemplateSubmit}>Save Flight Preferences</Button>
            </div>
          </>
        ) : (
          // ═══════════════════════════════════════════════════════
          // Booking mode
          // ═══════════════════════════════════════════════════════
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary text-primary-foreground">
                  <Plane className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle>
                    {bookingStep === 'confirmed' ? 'Booking Confirmed' : 'Search & Book Flight'}
                  </DialogTitle>
                  <DialogDescription>
                    {bookingStep === 'form' && 'Search for available flights'}
                    {bookingStep === 'results' && `${offers.length} flight${offers.length !== 1 ? 's' : ''} found`}
                    {bookingStep === 'travelers' && 'Enter traveler details'}
                    {bookingStep === 'review' && 'Review and confirm booking'}
                    {bookingStep === 'confirmed' && 'Flight booked successfully'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* ── Step 1: Search form ─────────────────────────── */}
            {bookingStep === 'form' && (
              <form onSubmit={handleSearch} className="space-y-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Tabs value={tripType} onValueChange={(value) => value && setTripType(value as TripType)}>
                    <TabsList>
                      {TRIP_TYPES.map(tt => (
                        <TabsTrigger key={tt.id} value={tt.id}>{tt.label}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <Select value={searchForm.cabinClass} onValueChange={(value) => setSearchForm({ ...searchForm, cabinClass: String(value) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CABIN_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
                  <AirportAutocomplete
                    label="From"
                    value={searchForm.origin}
                    onChange={(code: string) => setSearchForm({ ...searchForm, origin: code })}
                    placeholder="City or airport"
                    excludeCode={searchForm.destination}
                  />
                  <button
                    type="button"
                    onClick={handleSwap}
                    className="hidden md:flex w-9 h-9 rounded-full border border-border items-center justify-center text-muted-foreground hover:text-primary transition-colors self-end mb-0.5"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                  </button>
                  <AirportAutocomplete
                    label="To"
                    value={searchForm.destination}
                    onChange={(code: string) => setSearchForm({ ...searchForm, destination: code })}
                    placeholder="City or airport"
                    excludeCode={searchForm.origin}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Departure</label>
                    <Input
                      type="date"
                      value={searchForm.departureDate}
                      min={todayStr()}
                      onChange={(e) => setSearchForm({ ...searchForm, departureDate: e.target.value })}
                    />
                  </div>
                  {tripType === 'roundTrip' && (
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Return</label>
                      <Input
                        type="date"
                        value={searchForm.returnDate}
                        min={searchForm.departureDate || todayStr()}
                        onChange={(e) => setSearchForm({ ...searchForm, returnDate: e.target.value })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Passengers</label>
                    <PassengerSelector
                      adults={searchForm.adults}
                      children={searchForm.children}
                      infants={searchForm.infants}
                      onChange={(c: Record<string, number>) => setSearchForm({ ...searchForm, ...c })}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="submit" disabled={searching} className="w-full">
                      {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      {searching ? 'Searching...' : 'Search Flights'}
                    </Button>
                  </div>
                </div>
              </form>
            )}

            {/* ── Step 2: Results ─────────────────────────────── */}
            {bookingStep === 'results' && (
              <>
                {searching && (
                  <div className="text-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
                    <p className="text-muted-foreground">Searching flights...</p>
                  </div>
                )}

                {searchError && !searching && (
                  <div className="text-center py-10">
                    <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
                    <p className="text-destructive font-medium mb-3">{searchError}</p>
                    <Button variant="ghost" onClick={() => { setBookingStep('form'); setSearchError(null); }}>
                      Try again
                    </Button>
                  </div>
                )}

                {!searching && !searchError && offers.length === 0 && hasSearched && (
                  <div className="text-center py-12">
                    <Plane className="w-12 h-12 text-muted mx-auto mb-3" />
                    <h3 className="text-lg font-semibold text-muted-foreground mb-1">No flights found</h3>
                    <p className="text-sm text-muted-foreground mb-3">Try different dates or airports</p>
                    <Button variant="ghost" onClick={() => { setBookingStep('form'); setHasSearched(false); }}>
                      Modify search
                    </Button>
                  </div>
                )}

                {!searching && !searchError && offers.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mb-3"
                      onClick={() => { setBookingStep('form'); setOffers([]); setHasSearched(false); }}
                    >
                      <ChevronLeft className="w-4 h-4" /> Modify search
                    </Button>
                    <div className="space-y-3">
                      {offers.map(offer => (
                        <OfferCard key={offer.offerId} offer={offer} onSelect={selectOffer} paxCount={paxCount} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── Step 3: Traveler details ────────────────────── */}
            {bookingStep === 'travelers' && selectedOffer && (
              <>
                <Button variant="ghost" size="sm" className="mb-4" onClick={() => setBookingStep('results')}>
                  <ChevronLeft className="w-4 h-4" /> Back to results
                </Button>

                <div className="bg-muted rounded-lg p-3 mb-4 flex items-center gap-3 flex-wrap">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {selectedOffer.airlineCode}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{selectedOffer.airline} · {selectedOffer.cabinClass}</div>
                    <div className="text-xs text-muted-foreground">
                      {(selectedOffer.segments || []).map((s, i) => (
                        <span key={i}>{s.origin} → {s.destination}{i < (selectedOffer.segments || []).length - 1 ? ' · ' : ''}</span>
                      ))}
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-lg font-bold text-foreground font-mono tabular-nums">{fmtMoney(selectedOffer.fareTotal, selectedOffer.currency)}</div>
                  </div>
                </div>

                <h3 className="text-md font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" /> Traveler Details
                </h3>

                {(['adult', 'child', 'infant'] as TravelerType[]).map(type => {
                  const indexes = travelers.map((t, i) => t.type === type ? i : -1).filter(i => i >= 0);
                  if (indexes.length === 0) return null;
                  const label = type === 'adult' ? 'Adults' : type === 'child' ? 'Children' : 'Infants';
                  return (
                    <div key={type} className="mb-4">
                      <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">{label} ({indexes.length})</div>
                      {indexes.map((idx) => {
                        const t = travelers[idx];
                        return (
                          <div key={idx} className="border border-border rounded-lg p-3 mb-2">
                            <div className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-bold">{idx + 1}</span>
                              Traveler {idx + 1} <span className="text-xs text-muted-foreground capitalize">({t.type})</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
                                <Select value={t.title} onValueChange={(value) => updateTraveler(idx, 'title', String(value))}>
                                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {['Mr', 'Mrs', 'Ms', 'Miss'].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">First name *</label>
                                <Input placeholder="First name *" value={t.firstName}
                                  onChange={(e) => updateTraveler(idx, 'firstName', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last name *</label>
                                <Input placeholder="Last name *" value={t.lastName}
                                  onChange={(e) => updateTraveler(idx, 'lastName', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date of birth *</label>
                                <Input
                                  type="date"
                                  value={t.dob}
                                  title="Date of birth"
                                  onChange={(e) => updateTraveler(idx, 'dob', e.target.value)}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passenger email *</label>
                                <Input type="email" placeholder="Passenger email *" value={t.email}
                                  onChange={(e) => updateTraveler(idx, 'email', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Passenger phone *</label>
                                <Input type="tel" inputMode="tel" placeholder="+442079460018" value={t.phone}
                                  onChange={(e) => updateTraveler(idx, 'phone', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Gender *</label>
                                <Select value={t.gender || null} onValueChange={(value) => updateTraveler(idx, 'gender', value ? String(value) : '')}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue>{(value: string) => value === 'M' ? 'Male' : value === 'F' ? 'Female' : 'Gender *'}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="M">Male</SelectItem>
                                    <SelectItem value="F">Female</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <div className="border border-border rounded-lg p-3 mb-4">
                  <div className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4 text-muted-foreground" /> Contact Details
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input placeholder="Full name" value={contact.name}
                      onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                    <Input placeholder="Email *" type="email" value={contact.email}
                      onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                    <Input placeholder="Phone" value={contact.phone}
                      onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                  </div>
                </div>

                <Button onClick={goToReview}>
                  Review Booking <ChevronRight className="w-4 h-4" />
                </Button>
              </>
            )}

            {/* ── Step 4: Review ──────────────────────────────── */}
            {bookingStep === 'review' && selectedOffer && (
              <>
                <Button variant="ghost" size="sm" className="mb-4" onClick={() => setBookingStep('travelers')}>
                  <ChevronLeft className="w-4 h-4" /> Back to traveler details
                </Button>
                <h3 className="text-lg font-semibold text-foreground mb-3">Review & Confirm</h3>

                <div className="bg-muted rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                      {selectedOffer.airlineCode}
                    </div>
                    <span className="font-semibold text-sm text-foreground">{selectedOffer.airline} · {selectedOffer.cabinClass}</span>
                  </div>
                  {(selectedOffer.segments || []).map((seg, i) => (
                    <div key={i} className="text-sm text-muted-foreground ml-8">
                      <span className="font-semibold text-foreground">{seg.origin}</span>{' '}→{' '}
                      <span className="font-semibold text-foreground">{seg.destination}</span>{' '}·{' '}
                      {seg.marketingCarrier}{seg.flightNumber?.replace(seg.marketingCarrier || '', '')}{' '}·{' '}
                      {seg.departureAt && new Date(seg.departureAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  ))}
                </div>

                <div className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Travelers</div>
                  {travelers.map((t, i) => (
                    <div key={i} className="text-sm text-foreground">{t.title} {t.firstName} {t.lastName} <span className="text-xs text-muted-foreground capitalize">({t.type})</span></div>
                  ))}
                </div>

                <div className="mb-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Contact</div>
                  <div className="text-sm text-foreground">{contact.name} · {contact.email}{contact.phone ? ` · ${contact.phone}` : ''}</div>
                </div>

                <div className="border-t border-border pt-3 mb-4">
                  <div className="flex justify-between text-sm text-muted-foreground mb-1">
                    <span>Base fare</span><span className="font-mono tabular-nums">{fmtMoney(selectedOffer.baseFare, selectedOffer.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground mb-1">
                    <span>Taxes & fees</span><span className="font-mono tabular-nums">{fmtMoney(selectedOffer.taxes, selectedOffer.currency)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-foreground mt-2 pt-2 border-t border-border">
                    <span>Total</span><span className="font-mono tabular-nums">{fmtMoney(selectedOffer.fareTotal, selectedOffer.currency)}</span>
                  </div>
                </div>

                <Button onClick={confirmBooking} disabled={booking}>
                  {booking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {booking ? 'Booking...' : 'Confirm Booking'}
                </Button>
              </>
            )}

            {/* ── Step 5: Confirmed ────────────────────────────── */}
            {bookingStep === 'confirmed' && confirmedBooking && (
              <div className="text-center py-4">
                <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-1">Booking Confirmed</h3>
                <div className="inline-flex items-center gap-2 bg-muted rounded-lg px-4 py-2 mb-4">
                  <span className="text-xs text-muted-foreground uppercase">PNR</span>
                  <span className="text-lg font-mono font-bold text-primary">{confirmedBooking.pnr}</span>
                </div>
                <Button onClick={onClose}>Done</Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

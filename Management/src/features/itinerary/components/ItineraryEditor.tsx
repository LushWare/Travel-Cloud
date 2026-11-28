/**
 * Itinerary Editor Component
 * Card-based day editor aligned with the backend day-based structure
 */

import {
  Trash2, Plus, Upload, X, Search, Loader,
  MapPin, Activity, Utensils, Car, Building2,
  StickyNote, Image as ImageIcon, ChevronDown, ChevronUp,
  Coffee, UtensilsCrossed, Moon, Check, Star, Phone, Bed,
  Receipt, Plane,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { uploadItineraryImages } from '../../../services/cloudinaryService';
import Swal from 'sweetalert2';
import ActivitySelector from './ActivitySelector';
import LocationSelector from './LocationSelector';
import TransportRowEditor from './form/TransportRowEditor';
import { FlightSelectionModal, HotelSelectionModal } from '../../shared';
import {
  calculateMealCosts,
  calculateActivityCosts,
  calculateTransportCosts,
  dayMealPrices,
  chargeableMealDays,
  STANDARD_OCCUPANCY,
} from '@travel-crm/pricing-engine';
import {
  getMealCounts,
  getDayActivities,
  getDayTransports,
  getTransportRowCost,
  getAccommodationTotal,
} from '../utils/helpers';
import {
  resolveFlightAdd,
  resolveFlightEdit,
  resolveFlightRemove,
  countUnlinkedFlightRows,
} from '../utils/flightSync';
import { createDefaultTransportRow } from '@travel-crm/constants';
import HotelService from '../../../services/hotel.service';
import { usePricingDefaults, transportRateFor, seatsFor, type MealKey, type PricingDefaults } from '../hooks/usePricingDefaults';
import { TRANSPORT_MODE_LABELS } from '@travel-crm/constants';
import { getCountryCodeFromDestination, getMappedCityFromDestination } from '../utils/destinationMapping';
import { formatCurrency } from '../../../utils/currency.js';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MEAL_FIELDS: Array<{ meal: MealKey; count: string; label: string; price: string }> = [
  { meal: 'breakfast', count: 'breakfastCount', label: 'Breakfasts', price: 'breakfastPriceOverride' },
  { meal: 'lunch', count: 'lunchCount', label: 'Lunches', price: 'lunchPriceOverride' },
  { meal: 'dinner', count: 'dinnerCount', label: 'Dinners', price: 'dinnerPriceOverride' },
];

/**
 * A new row, or a row switched to another vehicle or pricing model, takes that Settings rate;
 * with no Settings rate for the new choice it starts at 0. The rep can still type a cost after.
 */
export function withTransportRate(previous: any, next: any, defaults: PricingDefaults) {
  const modeChanged = !previous || previous.transportMode !== next.transportMode;
  const rate = transportRateFor(defaults, next.transportMode, modeChanged ? undefined : next.pricingModel);
  if (rate) return { ...next, ...rate };
  return previous ? { ...next, unitCost: 0 } : next;
}

/**
 * A day's meals after the hotel's meal plan: what is still charged, and which
 * meals the plan covers (breakfast from last night's hotel, lunch/dinner from tonight's).
 * Same rule the package price uses.
 */
export function dayMealsAfterHotelPlan(days: any[], dayNumber: number) {
  const list = (days || []).filter(Boolean).map((d: any) => ({ ...getMealCounts(d), dayNumber: d.dayNumber, accommodation: d.accommodation }));
  return chargeableMealDays(list).find((d: any) => d.dayNumber === dayNumber);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Why a transport row costs what it does: the vehicle's seats, and for a lead
 * the number of vehicles its travellers need. Null when there is nothing to explain.
 */
export function transportHint(row: any, defaults: PricingDefaults, travelers?: number) {
  const mode = row?.transportMode;
  if (!mode || mode === 'FLIGHT') return null;
  const label = (TRANSPORT_MODE_LABELS as Record<string, string>)[mode] || mode;
  const unit = Number(row.unitCost) || 0;
  const party = Number(travelers) >= 1 ? Math.floor(Number(travelers)) : null;
  if (row.pricingModel === 'PER_PERSON') {
    return party ? `Per person · ${plural(party, 'traveller')} × ${formatCurrency(unit)} = ${formatCurrency(unit * party)}` : null;
  }
  const seats = seatsFor(defaults, mode);
  if (!seats) return null;
  if (!party) return `${label} seats ${seats}`;
  const vehicles = Math.ceil(party / seats);
  const vehicleWord = label.toLowerCase();
  if (row.pricingModel === 'PER_KM') {
    const km = Number(row.distanceKm) || 0;
    return `${label} seats ${seats} · ${plural(party, 'traveller')} → ${plural(vehicles, vehicleWord)} × ${km} km × ${formatCurrency(unit)} = ${formatCurrency(unit * km * vehicles)}`;
  }
  return `${label} seats ${seats} · ${plural(party, 'traveller')} → ${plural(vehicles, vehicleWord)} × ${formatCurrency(unit)} = ${formatCurrency(unit * vehicles)}`;
}

/**
 * A day's transport rows with every unpriced ($0) vehicle row given its Settings rate —
 * for its own pricing model, else the vehicle's default one. Null when nothing changes.
 */
export function fillUnpricedTransports(rows: any[], defaults: PricingDefaults) {
  let changed = false;
  const next = rows.map((row) => {
    if (!row || row.transportMode === 'FLIGHT' || Number(row.unitCost) > 0) return row;
    const rate = transportRateFor(defaults, row.transportMode, row.pricingModel)
      ?? transportRateFor(defaults, row.transportMode);
    if (!rate) return row;
    changed = true;
    return { ...row, ...rate, distanceKm: rate.pricingModel === 'PER_KM' ? row.distanceKm ?? null : null };
  });
  return changed ? next : null;
}

/** For a lead: how many rooms its travellers need, unless the hotel price already covers the whole party. */
export function roomsHint(accommodation: any, defaults: PricingDefaults, travelers?: number) {
  const party = Number(travelers) >= 1 ? Math.floor(Number(travelers)) : null;
  if (!party || !accommodation?.name || accommodation.priceCovers === 'PARTY') return null;
  const rooms = Math.ceil(party / defaults.peoplePerRoom);
  return `${plural(party, 'traveller')} → ${plural(rooms, 'room')} (${defaults.peoplePerRoom} per room)`;
}

// Stored price is one twin room for one night — what package pricing charges.
function toAccommodation(hotel: any, day: any, nights = 1) {
  const rate = hotel.cheapestRate || {};
  const stayTotal = Number(rate.totalAmount ?? hotel.totalAmount);
  const perNight = Number.isFinite(stayTotal) && stayTotal > 0
    ? Math.round((stayTotal / Math.max(1, Number(nights) || 1)) * 100) / 100
    : null;
  return {
    name: hotel.name,
    address: hotel.address || '',
    contactNumber: hotel.contactNumber || hotel.phone || '',
    rating: hotel.starRating ?? hotel.rating ?? (day?.accommodation?.rating || ''),
    type: day?.accommodation?.type || 'hotel',
    hotelId: hotel.hotelId || hotel.id || null,
    hotelImage: hotel.images?.[0] || hotel.hotelImage || null,
    roomType: rate.roomType || hotel.roomType || null,
    boardType: rate.boardType || hotel.boardType || null,
    totalAmount: perNight,
    currency: rate.currency || hotel.currency || null,
    refundable: rate.refundable ?? hotel.refundable ?? null,
  };
}

const sampleDate = (daysAhead: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};

let countryListCache: Promise<Array<{ code: string; name: string }>> | null = null;
const cityListCache = new Map<string, Promise<string[]>>();

async function providerCountryCode(text: string) {
  if (!text?.trim()) return null;
  countryListCache ||= HotelService.getCountries()
    .then((response: any) => (Array.isArray(response?.data) ? response.data : []))
    .catch(() => { countryListCache = null; return []; });
  const wanted = text.trim().toLowerCase();
  const countries = await countryListCache!;
  return countries.find((c) => c.name?.toLowerCase() === wanted)?.code
    || countries.find((c) => c.name && wanted.includes(c.name.toLowerCase()))?.code
    || null;
}
const cityHotelCache = new Map<string, Promise<any | null>>();

function providerCities(country: string) {
  if (!cityListCache.has(country)) {
    cityListCache.set(country, HotelService.getCities(country)
      .then((response: any) => (Array.isArray(response?.data) ? response.data : []))
      .catch(() => { cityListCache.delete(country); return []; }));
  }
  return cityListCache.get(country)!;
}

function matchProviderCity(name: unknown, cities: string[]) {
  if (typeof name !== 'string' || name.trim().length < 3) return null;
  const wanted = name.trim().toLowerCase();
  return cities.find((city) => city.toLowerCase() === wanted)
    || cities.find((city) => city.length >= 3 && (wanted.includes(city.toLowerCase()) || city.toLowerCase().includes(wanted)))
    || null;
}

function bestHotelInCity(city: string, country: string) {
  const key = `${country}|${city}`;
  if (!cityHotelCache.has(key)) {
    cityHotelCache.set(key, HotelService.search({
      city,
      country,
      checkin: sampleDate(30),
      checkout: sampleDate(31),
      occupancies: [{ adults: STANDARD_OCCUPANCY, children: [] }],
      currency: 'USD',
      guestNationality: country,
      limit: 30,
    }).then((response: any) => {
      const priced = (response?.data || []).filter((h: any) => Number(h.cheapestRate?.totalAmount) > 0);
      return priced.sort((a: any, b: any) =>
        (Number(b.rating) || 0) - (Number(a.rating) || 0)
        || Number(a.cheapestRate.totalAmount) - Number(b.cheapestRate.totalAmount))[0] || null;
    }).catch(() => { cityHotelCache.delete(key); return null; }));
  }
  return cityHotelCache.get(key)!;
}

/**
 * Real provider hotels for every day without one: the day's own location
 * first, then the previous day's hotel, then the package's first hotel,
 * then the destination's main city.
 */
export async function pickHotelsForDays(days: any[], destination: string) {
  const picks = new Map<number, any>();
  const sorted = days.filter(Boolean).sort((a, b) => a.dayNumber - b.dayNumber);
  const country = getCountryCodeFromDestination(destination)
    || await providerCountryCode(destination)
    || sorted.flatMap((d) => d.locations || []).map((loc: string) => getCountryCodeFromDestination(loc)).find(Boolean);
  if (!country) return picks;

  const cities = await providerCities(country);
  const destinationCity = matchProviderCity(getMappedCityFromDestination(destination, country), cities)
    || matchProviderCity(destination, cities);

  const dayHotels = await Promise.all(sorted.map(async (day) => {
    const city = (Array.isArray(day.locations) ? day.locations : [])
      .map((loc: string) => matchProviderCity(loc, cities))
      .find(Boolean);
    return city ? bestHotelInCity(city, country) : null;
  }));

  const firstFound = dayHotels.find(Boolean)
    || (destinationCity ? await bestHotelInCity(destinationCity, country) : null);

  let previous: any = null;
  sorted.forEach((day, index) => {
    const existing = day.accommodation?.name ? day.accommodation : null;
    const hotel = dayHotels[index] || previous || firstFound;
    if (!existing && hotel) picks.set(day.dayNumber, hotel);
    previous = dayHotels[index] || (existing?.hotelId ? existing : previous) || hotel;
  });
  return picks;
}

// ═══════════════════════════════════════════════════════════════════
//  Hotel Stay Card — shown when a hotel is selected from the API
// ═══════════════════════════════════════════════════════════════════
function HotelStayCard({ accommodation, onSearch, onRemove, roomsNote }: { accommodation: any; onSearch: () => void; onRemove: () => void; roomsNote?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const acc = accommodation || {};

  function fmtMoney(amount: number | null | undefined, currency?: string | null) {
    if (amount == null) return null;
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
  }

  const priceStr = fmtMoney(acc.totalAmount, acc.currency);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {/* Image */}
        <div className="w-full sm:w-40 h-32 rounded-lg overflow-hidden bg-muted shrink-0">
          {acc.hotelImage ? (
            <img src={acc.hotelImage} alt={acc.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Building2 className="w-10 h-10 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-bold text-foreground">{acc.name}</h4>

          {/* Stars */}
          <div className="flex items-center gap-0.5 mt-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={cn('w-4 h-4', acc.rating != null && i < Math.round(Number(acc.rating)) ? 'fill-warning text-warning' : 'text-muted')}
              />
            ))}
            {acc.rating != null && acc.rating > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">{Number(acc.rating).toFixed(1)}</span>
            )}
            {(!acc.rating || acc.rating === 0) && (
              <span className="ml-1 text-xs text-muted-foreground">—</span>
            )}
          </div>

          {/* Address */}
          {acc.address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1.5">
              <MapPin className="w-3 h-3 shrink-0" /> {acc.address}
            </p>
          )}

          {/* Badges row */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {acc.roomType && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                <Bed className="w-3 h-3" /> {acc.roomType}
              </span>
            )}
            {acc.boardType && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {acc.boardType}
              </span>
            )}
            {acc.refundable && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
                Refundable
              </span>
            )}
            {priceStr && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning font-semibold">
                {priceStr}{acc.cheapestRate ? '' : '/night'}
              </span>
            )}
          </div>
          {roomsNote && <p className="mt-2 text-xs text-muted-foreground">{roomsNote}</p>}
        </div>

        {/* Actions */}
        <div className="flex sm:flex-col gap-2 shrink-0 items-end">
          <Button type="button" onClick={onSearch} variant="outline" size="sm">
            Change
          </Button>
          <Button type="button" onClick={onRemove} variant="destructive" size="sm">
            Remove
          </Button>
        </div>
      </div>

      {/* Expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted border-t border-border transition-colors"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? 'Less details' : 'More details'}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 text-xs text-muted-foreground">
          {acc.contactNumber && (
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 shrink-0" />
              <span>{acc.contactNumber}</span>
            </div>
          )}
          {acc.address && (
            <div className="flex items-center gap-1.5 sm:col-span-2">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>{acc.address}</span>
            </div>
          )}
          {priceStr && (
            <div className="flex items-center gap-1.5">
              <span className="shrink-0">Price:</span>
              <span className="font-semibold text-foreground">{priceStr}</span>
            </div>
          )}
          {acc.type && (
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="capitalize">{acc.type}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 sm:col-span-2">
            <span className="shrink-0">Hotel ID:</span>
            <span className="font-mono">{acc.hotelId || '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Best-effort flight price lookup across the shapes the flight modal and
 * loaded packages may produce (totalAmount / fareTotal / price).
 */
function getFlightPrice(flight: any) {
  if (!flight) return null;
  const value = flight.totalAmount ?? flight.fareTotal ?? flight.price;
  return value == null || value === '' ? null : Number(value);
}

type DayDetailSection = 'plan' | 'stay' | 'notes' | 'costs';

const DAY_DETAIL_TABS: { id: DayDetailSection; label: string; icon: typeof MapPin }[] = [
  { id: 'plan', label: 'Plan', icon: MapPin },
  { id: 'stay', label: 'Flights & stay', icon: Plane },
  { id: 'notes', label: 'Notes & photos', icon: StickyNote },
  { id: 'costs', label: 'Costs', icon: Receipt },
];

function getDayDetailStatus(day: any, section: DayDetailSection) {
  const locations = Array.isArray(day.locations) ? day.locations : [];
  const activities = Array.isArray(day.activities) ? day.activities : [];
  const flights = Array.isArray(day.flights) ? day.flights : [];
  const images = Array.isArray(day.images) ? day.images : [];

  if (section === 'plan') return `${locations.length} places · ${activities.length} activities`;
  if (section === 'stay') return `${flights.length} flights · ${day.accommodation?.name ? 'Hotel selected' : 'Hotel not selected'}`;
  if (section === 'notes') return `${day.notes?.trim() ? 'Notes added' : 'No notes'} · ${images.length} photos`;
  return 'Meals, activities, transport and hotel';
}

interface ItineraryEditorProps {
  days?: any[];
  onDayChange: (dayNumber: number, patch: any) => void;
  onAddDay: () => void;
  onRemoveDay: (dayNumber: number) => void;
  destination?: string;
  packageType?: string;
  category?: string;
  useLocationAutocomplete?: boolean;
  LocationAutocompleteComponent?: any;
  hideTitleAndDescription?: boolean;
  hideDescription?: boolean;
  compactDayNavigation?: boolean;
  /** A lead's party size: shows how many vehicles and rooms it needs. Omitted for packages. */
  travelers?: number;
  /** Package editing: give unpriced vehicle rows their Settings rate once the rates load. */
  fillUnpricedTransport?: boolean;
}

const MEALS = [
  { key: 'breakfast', label: 'Breakfast', icon: Coffee },
  { key: 'lunch', label: 'Lunch', icon: UtensilsCrossed },
  { key: 'dinner', label: 'Dinner', icon: Moon },
] as const;

const ACCOMMODATION_TYPE_LABELS: Record<string, string> = {
  hotel: 'Hotel',
  resort: 'Resort',
  guesthouse: 'Guesthouse',
  homestay: 'Homestay',
  camp: 'Camp',
};

const ItineraryEditor = ({
  days = [],
  onDayChange,
  onAddDay,
  onRemoveDay,
  destination = '',
  packageType = '',
  category = '',
  useLocationAutocomplete = false,
  LocationAutocompleteComponent = null,
  hideTitleAndDescription = false,
  hideDescription = false,
  compactDayNavigation = false,
  travelers,
  fillUnpricedTransport = false,
}: ItineraryEditorProps) => {
  const [uploadingDayImages, setUploadingDayImages] = useState<Record<number, boolean>>({});
  const [currentDayForHotel, setCurrentDayForHotel] = useState<number | null>(null);
  const [currentDayLocations, setCurrentDayLocations] = useState<string[]>([]);
  const [autoFillingHotel, setAutoFillingHotel] = useState(false);
  const autoFillAttempts = useRef(new Set<string>());
  const pricingDefaults = usePricingDefaults();

  useEffect(() => {
    if (!fillUnpricedTransport) return;
    days.forEach((day) => {
      if (!day) return;
      const filled = fillUnpricedTransports(getDayTransports(day), pricingDefaults);
      if (filled) onDayChange(day.dayNumber, { transports: filled });
    });
    // Runs when the Settings rates arrive or the set of days changes; a filled row is no longer $0.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillUnpricedTransport, pricingDefaults, days.length]);
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    const firstDayNumber = days.find((day) => day && day.dayNumber != null)?.dayNumber;
    days.forEach((day) => {
      if (day && day.dayNumber != null) {
        init[day.dayNumber] = !compactDayNavigation || day.dayNumber === firstDayNumber;
      }
    });
    return init;
  });
  const [showFlightModal, setShowFlightModal] = useState(false);
  // { dayNumber, index } — index null means "add a new flight".
  const [flightModalTarget, setFlightModalTarget] = useState<{ dayNumber: number; index: number | null } | null>(null);
  const [showHotelModal, setShowHotelModal] = useState(false);
  const [hotelModalMode, setHotelModalMode] = useState<'search' | 'suggest'>('suggest');
  const [highlightedFlightSection, setHighlightedFlightSection] = useState<number | null>(null);
  // Cost subsections are collapsed by default — summary chips show totals.
  const [expandedCosts, setExpandedCosts] = useState<Record<number, boolean>>({});
  const [activeDaySections, setActiveDaySections] = useState<Record<number, DayDetailSection>>({});

  const toggleCostsExpand = (dayNumber: number) => {
    setExpandedCosts(prev => ({ ...prev, [dayNumber]: !prev[dayNumber] }));
  };

  const handleMealToggle = (day: any, mealKey: string, checked: boolean) => {
    onDayChange(day.dayNumber, {
      meals: { ...(day.meals || {}), [mealKey]: checked },
      [`${mealKey}Count`]: checked ? 1 : 0,
    });
  };

  const handleMealCountChange = (day: any, field: string, value: string) => {
    const num = Math.max(0, parseInt(value, 10) || 0);
    onDayChange(day.dayNumber, {
      [field]: num,
      meals: { ...(day.meals || {}), [field.replace('Count', '')]: num > 0 },
    });
  };

  // Editing one meal price moves an older single day price onto the other meals, so they keep it.
  const handleMealPriceChange = (day: any, meal: MealKey, value: string) => {
    const legacy = day.mealPriceOverride === '' || day.mealPriceOverride == null ? null : Number(day.mealPriceOverride);
    const patch: Record<string, number | null> = { [`${meal}PriceOverride`]: value === '' ? null : (parseFloat(value) || 0) };
    if (legacy != null) {
      MEAL_FIELDS.filter((f) => f.meal !== meal).forEach((f) => {
        patch[f.price] = day[f.price] ?? legacy;
      });
      patch.mealPriceOverride = null;
    }
    onDayChange(day.dayNumber, patch);
  };

  const handleActivityCostChange = (day: any, name: string, field: string, value: string) => {
    const activities = getDayActivities(day);
    const current = activities.find((a: any) => a.name === name) || { name, defaultCost: 0, costOverride: null };
    const parsed = value === '' ? null : (parseFloat(value) || 0);
    onDayChange(day.dayNumber, {
      activityCosts: {
        ...(day.activityCosts || {}),
        [name]: {
          defaultCost: current.defaultCost,
          costOverride: field === 'costOverride' ? parsed : current.costOverride,
        },
      },
    });
  };

  const handleTransportCostChange = (day: any, index: number, patch: any) => {
    const current = getDayTransports(day);
    const rows = current.length > 0
      ? current
      : [createDefaultTransportRow()];
    onDayChange(day.dayNumber, {
      transports: rows.map((row: any, i: number) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        const switched = (patch.transportMode && patch.transportMode !== row.transportMode)
          || (patch.pricingModel && patch.pricingModel !== row.pricingModel);
        return switched ? withTransportRate(row, next, pricingDefaults) : next;
      }),
    });
  };

  const handleAddTransport = (day: any) => {
    const current = getDayTransports(day);
    onDayChange(day.dayNumber, {
      transports: [
        ...current,
        withTransportRate(null, createDefaultTransportRow(), pricingDefaults),
      ],
    });
  };

  const handleRemoveTransport = (day: any, index: number) => {
    const current = getDayTransports(day);
    onDayChange(day.dayNumber, {
      transports: current.filter((_: any, i: number) => i !== index),
    });
  };

  const handleAddFlight = (day: any) => {
    setFlightModalTarget({ dayNumber: day.dayNumber, index: null });
    setShowFlightModal(true);
  };

  const handleEditFlight = (day: any, index: number) => {
    setFlightModalTarget({ dayNumber: day.dayNumber, index });
    setShowFlightModal(true);
  };

  const handleRemoveFlight = (day: any, index: number) => {
    const flights = Array.isArray(day.flights) ? day.flights : [];
    const removed = flights[index];
    if (!removed) return;
    onDayChange(day.dayNumber, resolveFlightRemove({
      flights,
      transports: getDayTransports(day),
      flightId: removed.id,
    }));
  };

  /**
   * A FLIGHT transport row exists without a linked flight — take the user to
   * the Flight Booking section so both stay in sync.
   */
  const handleJumpToFlightSection = (day: any) => {
    const section = document.getElementById(`day-${day.dayNumber}-flight-section`);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlightedFlightSection(day.dayNumber);
    setTimeout(() => setHighlightedFlightSection(null), 1200);
    handleAddFlight(day);
  };

  const renderCostsSection = (day: any) => {
    const mealCounts = getMealCounts(day);
    const activityRows = getDayActivities(day);
    const transportRows = getDayTransports(day);
    const accommodationTotal = getAccommodationTotal(day);
    const isExpanded = Boolean(expandedCosts[day.dayNumber]);

    const mealsCharged = dayMealsAfterHotelPlan(days, day.dayNumber) ?? { ...mealCounts, includedMeals: {} };
    const mealTotal = calculateMealCosts([mealsCharged], { mealPrices: pricingDefaults.mealPrices }).total;
    const coveredByHotel = MEAL_FIELDS.filter((f) => Number(mealsCharged.includedMeals?.[f.meal]) > 0).map((f) => f.meal);
    const mealPrices = dayMealPrices(mealCounts, pricingDefaults.mealPrices);
    const activityTotal = calculateActivityCosts(activityRows, { groupSize: 1 }).total;
    const transportTotal = calculateTransportCosts(transportRows, { groupSize: 1 }).total;
    const flightTotal = transportRows
      .filter((row: any) => row.transportMode === 'FLIGHT')
      .reduce((sum: number, row: any) => sum + getTransportRowCost(row, 1), 0);
    const unlinkedFlightCount = countUnlinkedFlightRows(transportRows);

    const chip = (label: string, value: number) => {
      const hasValue = Number(value) > 0;
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border',
            hasValue
              ? 'bg-success/10 border-success/20 text-success dark:bg-success/15 dark:border-success/40'
              : 'bg-muted border-border text-muted-foreground dark:bg-secondary dark:border-white/15 dark:text-foreground/90'
          )}
        >
          {label}: {hasValue ? formatCurrency(value) : '—'}
        </span>
      );
    };

    const mealSummary = MEAL_FIELDS
      .filter((f) => Number((mealsCharged as any)[f.count]) > 0)
      .map((f) => `${(mealsCharged as any)[f.count]} × ${formatCurrency(mealPrices[f.meal], { minimumFractionDigits: Number.isInteger(mealPrices[f.meal]) ? 0 : 2 })}`)
      .join(' + ');
    const costSummary = (
      <div className="flex flex-wrap gap-1.5">
        {chip('Meals', mealTotal)}
        {chip('Activities', activityTotal)}
        {chip('Transport', transportTotal)}
        {chip('Flight', flightTotal)}
        {chip('Hotel', accommodationTotal)}
      </div>
    );

    return (
      <div className={cn(
        'bg-card rounded-lg border border-success/20 overflow-hidden',
        compactDayNavigation && 'dark:bg-secondary/50 dark:border-success/40'
      )}>
        {compactDayNavigation ? (
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:bg-secondary/70">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Receipt className="w-4 h-4 text-success" />
              Costs &amp; Pricing
            </div>
            {costSummary}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleCostsExpand(day.dayNumber)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-success/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Receipt className="w-4 h-4 text-success" />
              Costs &amp; Pricing
              <span className="text-xs font-normal text-muted-foreground">
                ({isExpanded ? 'editing' : 'collapsed'})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {costSummary}
              <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                {isExpanded ? <ChevronUp className="w-4 h-4 text-success" /> : <ChevronDown className="w-4 h-4 text-success" />}
              </div>
            </div>
          </button>
        )}

        {(isExpanded || compactDayNavigation) && (
          <div className="px-4 pb-4 pt-1 border-t border-success/10 dark:border-success/30 space-y-4">
            {/* ── Meals ───────────────────────────────────────── */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2 uppercase tracking-wider">
                <Utensils className="w-3.5 h-3.5 text-success" /> Meals
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {MEAL_FIELDS.map((field) => (
                  <div key={field.meal} className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`day-${day.dayNumber}-${field.count}`} className="block text-xs text-muted-foreground mb-1">{field.label}</label>
                      <Input
                        id={`day-${day.dayNumber}-${field.count}`}
                        type="number" min="0"
                        value={(mealCounts as any)[field.count]}
                        onChange={(e) => handleMealCountChange(day, field.count, e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                    </div>
                    <div>
                      <label htmlFor={`day-${day.dayNumber}-${field.price}`} className="block text-xs text-muted-foreground mb-1">Price each</label>
                      <Input
                        id={`day-${day.dayNumber}-${field.price}`}
                        type="number" min="0" step="0.01"
                        value={(mealCounts as any)[field.price] ?? mealCounts.mealPriceOverride ?? ''}
                        placeholder={pricingDefaults.mealPricesSet ? String(pricingDefaults.mealPrices[field.meal]) : 'Not set'}
                        onChange={(e) => handleMealPriceChange(day, field.meal, e.target.value)}
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {mealSummary ? <>{mealSummary} = </> : (coveredByHotel.length ? '' : 'No meals · ')}
                <span className="font-semibold text-success">{formatCurrency(mealTotal)}</span>
                {coveredByHotel.length > 0 && (
                  <span className="ml-1">· {coveredByHotel.join(', ')} in hotel meal plan (included in the room price)</span>
                )}
                <span className="ml-1">per person · {pricingDefaults.mealPricesSet ? 'a blank price uses the Settings price' : 'meal prices are not set in Settings yet'}</span>
              </p>
            </div>

            {/* ── Activities ───────────────────────────────────── */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2 uppercase tracking-wider">
                <Activity className="w-3.5 h-3.5 text-success" /> Activities
              </label>
              {activityRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No activities added to this day.</p>
              ) : (
                <div className="space-y-2">
                  {activityRows.map((activity: any) => {
                    const unit = activity.costOverride ?? activity.defaultCost ?? 0;
                    const total = unit;
                    return (
                      <div key={activity.name} className="flex flex-wrap items-center gap-2 bg-muted rounded-lg border border-border px-3 py-2">
                        <span className="text-sm font-medium text-foreground flex-1 min-w-[120px]">{activity.name}</span>
                        <span className="text-xs text-muted-foreground">
                          Default: <span className="font-semibold text-foreground">{formatCurrency(activity.defaultCost)}</span>
                        </span>
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          Override
                          <Input
                            type="number" min="0" step="0.01"
                            value={activity.costOverride ?? ''}
                            placeholder={String(activity.defaultCost || 0)}
                            onChange={(e) => handleActivityCostChange(day, activity.name, 'costOverride', e.target.value)}
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-24"
                          />
                        </label>
                        <span className="text-xs text-success font-medium">
                          {formatCurrency(total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Transport ────────────────────────────────────── */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2 uppercase tracking-wider">
                <Car className="w-3.5 h-3.5 text-success" /> Transport
              </label>
              {transportRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transport configured for this day.</p>
              ) : (
                <div className="space-y-2">
                  {transportRows.map((row: any, i: number) => (
                    <div key={`${day.dayNumber}-transport-${i}`}>
                      <TransportRowEditor
                        index={i}
                        transport={row}
                        onChange={(patch: any) => handleTransportCostChange(day, i, patch)}
                        onRemove={(idx: number) => handleRemoveTransport(day, idx)}
                      />
                      {transportHint(row, pricingDefaults, travelers) && (
                        <p className="mt-1 px-1 text-xs text-muted-foreground">{transportHint(row, pricingDefaults, travelers)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <Button type="button" onClick={() => handleAddTransport(day)} variant="outline" size="sm" className="border-success/30 text-success hover:bg-success/10">
                  <Plus className="w-3.5 h-3.5" /> Add Transport
                </Button>
                <p className="text-xs text-muted-foreground">
                  Total = <span className="font-semibold text-success">{formatCurrency(transportTotal)}</span>
                </p>
              </div>
              {unlinkedFlightCount > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 bg-warning/5 border border-warning/20 rounded-lg px-3 py-2 text-xs text-warning">
                  <Plane className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1 min-w-[160px]">
                    {unlinkedFlightCount === 1
                      ? 'A flight cost was added — add the flight details so pricing stays in sync.'
                      : `${unlinkedFlightCount} flight costs were added — add the flight details so pricing stays in sync.`}
                  </span>
                  <Button type="button" onClick={() => handleJumpToFlightSection(day)} variant="outline" size="sm" className="border-warning/30 text-warning hover:bg-warning/10">
                    Add flight details
                  </Button>
                </div>
              )}
            </div>

            {/* ── Accommodation ────────────────────────────────── */}
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2 uppercase tracking-wider">
                <Building2 className="w-3.5 h-3.5 text-success" /> Accommodation
              </label>
              {day.accommodation?.name ? (
                <div className="flex flex-wrap items-center gap-2 bg-muted rounded-lg border border-border px-3 py-2">
                  <span className="text-sm font-medium text-foreground flex-1 min-w-[120px]">{day.accommodation.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Total: <span className="font-semibold text-foreground">{formatCurrency(accommodationTotal)}</span>
                  </span>
                  {/* Tech debt: multi-day hotel stays are not yet supported. The
                      current implementation treats each day's accommodation as an
                      independent per-night booking. When multi-day stays are
                      implemented, the pricing engine should de-duplicate consecutive
                      nights at the same hotel. */}
                  <span className="text-xs text-muted-foreground" title="Each day books one per-night stay for now">
                    {formatCurrency(accommodationTotal)} / night
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Accommodation: —</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Keep the focused day visible when the itinerary length changes.
  useEffect(() => {
    if (compactDayNavigation) {
      const validDays = days.filter(Boolean);
      setExpandedDays((prev) => {
        const hasNewDay = validDays.some((day) => prev[day.dayNumber] === undefined);
        const currentDay = validDays.find((day) => prev[day.dayNumber]);
        const focusedDay = hasNewDay ? validDays[validDays.length - 1] : currentDay || validDays[0];
        const next: Record<number, boolean> = {};
        validDays.forEach((day) => { next[day.dayNumber] = day.dayNumber === focusedDay?.dayNumber; });
        return next;
      });
      return;
    }

    const expanded: Record<number, boolean> = {};
    days.forEach(day => {
      if (day && day.dayNumber != null && expandedDays[day.dayNumber] === undefined) {
        expanded[day.dayNumber] = true;
      }
    });
    if (Object.keys(expanded).length > 0) {
      setExpandedDays(prev => ({ ...prev, ...expanded }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, compactDayNavigation]);

  const toggleDayExpand = (dayNumber: number) => {
    if (compactDayNavigation) {
      setExpandedDays((prev) => {
        const next: Record<number, boolean> = {};
        days.filter(Boolean).forEach((day) => { next[day.dayNumber] = day.dayNumber === dayNumber; });
        return next;
      });
      return;
    }
    setExpandedDays(prev => ({ ...prev, [dayNumber]: !prev[dayNumber] }));
  };

  const handleDayImageUpload = async (dayNumber: number, files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploadingDayImages(prev => ({ ...prev, [dayNumber]: true }));

    try {
      const uploadedImages = await uploadItineraryImages(files);
      const day = days.find(d => d && d.dayNumber === dayNumber);
      const existingImages = day?.images || [];
      const updatedImages = [...existingImages, ...uploadedImages];
      onDayChange(dayNumber, { images: updatedImages });
      Swal.fire('Success', `${uploadedImages.length} image(s) uploaded successfully!`, 'success');
    } catch (error) {
      console.error('Day image upload error:', error);
      Swal.fire('Error', (error as Error).message || 'Failed to upload images', 'error');
    } finally {
      setUploadingDayImages(prev => ({ ...prev, [dayNumber]: false }));
    }
  };

  const handleRemoveDayImage = (dayNumber: number, imageIndex: number) => {
    const day = days.find(d => d && d.dayNumber === dayNumber);
    const updatedImages = (day?.images || []).filter((_: any, idx: number) => idx !== imageIndex);
    onDayChange(dayNumber, { images: updatedImages });
  };

  const latestDays = useRef(days);
  latestDays.current = days;

  useEffect(() => {
    if (!destination) return undefined;
    const keyOf = (d: any) => `${destination}|${d.dayNumber}|${(d.locations || []).join(',')}`;
    const missing = days.filter((d) => d && !d.accommodation?.name && !autoFillAttempts.current.has(keyOf(d)));
    if (missing.length === 0) return undefined;

    const timer = setTimeout(async () => {
      missing.forEach((d) => autoFillAttempts.current.add(keyOf(d)));
      const targets = new Set(missing.map((d) => d.dayNumber));
      setAutoFillingHotel(true);
      try {
        const picks = await pickHotelsForDays(latestDays.current, destination);
        picks.forEach((hotel, dayNumber) => {
          const day = latestDays.current.find((d) => d && d.dayNumber === dayNumber);
          if (day && targets.has(dayNumber) && !day.accommodation?.name) {
            onDayChange(dayNumber, { accommodation: toAccommodation(hotel, day) });
          }
        });
      } catch (error) {
        console.error('Error auto-filling hotels:', error);
      } finally {
        setAutoFillingHotel(false);
      }
    }, 1500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days
    .filter(Boolean)
    .map(d => `${d.dayNumber}-${Array.isArray(d.locations) ? d.locations.join(',') : ''}-${d.accommodation?.name ? 1 : 0}`)
    .join('|'), destination, packageType, category]);

  // Field Group Component
  const FieldGroup = ({ label, icon: Icon, children, className = '' }: { label: string; icon?: any; children: React.ReactNode; className?: string }) => (
    <div className={cn(
      'bg-card rounded-lg border border-border p-4',
      compactDayNavigation && 'dark:bg-secondary/70 dark:border-white/15',
      className
    )}>
      <label className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
        {label}
      </label>
      {children}
    </div>
  );

  if (!days || days.length === 0) {
    return (
      <div className="bg-muted rounded-xl border-2 border-dashed border-border p-12 text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Plus className="w-8 h-8 text-primary" />
        </div>
        <p className="text-foreground font-medium mb-2">No days added to itinerary</p>
        <p className="text-sm text-muted-foreground mb-6">Start building your travel itinerary</p>
        <Button onClick={onAddDay}>
          <Plus size={16} />
          Add First Day
        </Button>
      </div>
    );
  }

  const validDays = days.filter(Boolean);

  return (
    <div className="space-y-4">
      {compactDayNavigation && (
        <div role="tablist" aria-label="Itinerary days" className="flex gap-2 overflow-x-auto pb-2">
          {validDays.map((day) => {
            const isActive = Boolean(expandedDays[day.dayNumber]);
            return (
              <button
                key={day.dayNumber}
                type="button"
                role="tab"
                id={`itinerary-day-${day.dayNumber}-tab`}
                aria-label={`Day ${day.dayNumber}${day.title ? `: ${day.title}` : ''}`}
                aria-selected={isActive}
                aria-controls={`day-${day.dayNumber}-content`}
                onClick={() => toggleDayExpand(day.dayNumber)}
                className={cn(
                  'flex min-h-14 w-40 shrink-0 flex-col items-start justify-center gap-1 rounded-xl border-2 px-3 py-2 text-left transition-colors',
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-foreground hover:border-primary/40'
                )}
              >
                <span className={cn('text-xs font-semibold uppercase', isActive ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                  Day {day.dayNumber}
                </span>
                <span className="w-full truncate text-sm font-semibold">
                  {day.title || `Day ${day.dayNumber}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {validDays.filter((day) => !compactDayNavigation || expandedDays[day.dayNumber]).map((day) => {
        const isExpanded = Boolean(expandedDays[day.dayNumber]);
        const activeDaySection = activeDaySections[day.dayNumber] || 'plan';

        return (
        <div key={day.dayNumber} className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          {/* Day Header */}
          <div className={cn(
            'flex items-stretch justify-between',
            compactDayNavigation ? 'border-b border-border bg-card' : 'bg-primary text-primary-foreground'
          )}>
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={`day-${day.dayNumber}-content`}
              onClick={() => toggleDayExpand(day.dayNumber)}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-4 px-6 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                compactDayNavigation ? 'hover:bg-muted/60' : 'hover:bg-primary/90'
              )}
            >
              <span className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold font-mono',
                compactDayNavigation ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'bg-primary-foreground/20'
              )}>
                {String(day.dayNumber).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                {compactDayNavigation && (
                  <span className="block text-xs font-semibold uppercase text-muted-foreground">Day {day.dayNumber}</span>
                )}
                <span className={cn(
                  'block truncate font-heading font-semibold',
                  compactDayNavigation ? 'text-base text-foreground' : 'text-lg'
                )}>
                  {compactDayNavigation ? day.title || `Day ${day.dayNumber}` : `Day ${day.dayNumber}`}
                </span>
                {!compactDayNavigation && day.title ? (
                  <span className="block truncate text-sm text-primary-foreground/80">{day.title}</span>
                ) : null}
              </span>
              <span className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                compactDayNavigation ? 'text-muted-foreground' : 'bg-primary-foreground/10'
              )}>
                {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Remove Day ${day.dayNumber}`}
              onClick={() => onRemoveDay(day.dayNumber)}
              className={cn(
                'mr-4 my-auto rounded-md p-2 transition-colors',
                compactDayNavigation
                  ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                  : 'hover:bg-destructive/80'
              )}
              title="Remove day"
            >
              <Trash2 size={18} />
            </button>
          </div>

          {/* Day Content */}
          {isExpanded && (
            <div id={`day-${day.dayNumber}-content`} className="p-6 space-y-4">
              {compactDayNavigation && (
                <div
                  role="tablist"
                  aria-label={`Day ${day.dayNumber} details`}
                  className="grid grid-cols-2 gap-2 border-b border-border pb-4 sm:grid-cols-4"
                >
                  {DAY_DETAIL_TABS.map(({ id, label, icon: Icon }) => {
                    const isActive = activeDaySection === id;
                    return (
                      <button
                        key={id}
                        id={`day-${day.dayNumber}-${id}-tab`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`day-${day.dayNumber}-details`}
                        onClick={() => setActiveDaySections((prev) => ({ ...prev, [day.dayNumber]: id }))}
                        className={cn(
                          'flex min-h-14 min-w-0 flex-col items-start justify-center gap-1 rounded-md border-2 px-3 py-2 text-left transition-colors',
                          isActive
                            ? 'border-primary bg-background text-foreground shadow-sm'
                            : 'border-border bg-muted/40 text-foreground hover:bg-muted dark:border-white/15 dark:bg-secondary dark:hover:bg-muted'
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} />
                          <span className="truncate">{label}</span>
                        </span>
                        <span className="w-full truncate pl-6 text-xs text-muted-foreground dark:text-foreground/75">
                          {getDayDetailStatus(day, id)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div
                id={compactDayNavigation ? `day-${day.dayNumber}-details` : undefined}
                role={compactDayNavigation ? 'tabpanel' : undefined}
                aria-labelledby={compactDayNavigation ? `day-${day.dayNumber}-${activeDaySection}-tab` : undefined}
                className="space-y-4"
              >
              {(!compactDayNavigation || activeDaySection === 'plan') && (
              <div className="space-y-4">
              {/* Row 1: Title and Description */}
              {!hideTitleAndDescription && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <FieldGroup label="Day Title" icon={StickyNote}>
                    <Input
                      type="text"
                      value={day.title || ''}
                      onChange={(e) => onDayChange(day.dayNumber, { title: e.target.value })}
                      placeholder="e.g., Arrival in Dubai (optional)"
                    />
                  </FieldGroup>

                  {!hideDescription && (
                    <FieldGroup label="Description" icon={StickyNote}>
                      <Textarea
                        rows={2}
                        value={day.description || ''}
                        onChange={(e) => onDayChange(day.dayNumber, { description: e.target.value })}
                        placeholder="Brief description of the day's activities..."
                      />
                    </FieldGroup>
                  )}
                </div>
              )}

              {/* Row 2: Locations and Activities */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FieldGroup label="Locations Covered" icon={MapPin}>
                  {useLocationAutocomplete && LocationAutocompleteComponent ? (
                    <LocationAutocompleteComponent
                      locations={day.locations || []}
                      onChange={(locations: string[]) => onDayChange(day.dayNumber, { locations })}
                    />
                  ) : (
                    <LocationSelector
                      locations={day.locations || []}
                      onChange={(locations: string[]) => onDayChange(day.dayNumber, { locations })}
                      destination={destination}
                    />
                  )}
                </FieldGroup>

                <FieldGroup label="Activities" icon={Activity}>
                  <ActivitySelector
                    activities={day.activities || []}
                    onChange={(activities: string[]) => onDayChange(day.dayNumber, { activities })}
                    destination={destination}
                  />
                </FieldGroup>
              </div>

              {/* Row 3: Meals */}
              <FieldGroup label="Meals Included" icon={Utensils}>
                <div className="flex flex-wrap gap-3">
                  {MEALS.map((meal) => {
                    const checked = Boolean(day.meals?.[meal.key]);
                    return (
                      <label
                        key={meal.key}
                        className={cn(
                          // `relative` anchors the sr-only (absolute) checkbox inside the chip.
                          // Without it the input is positioned against the dialog, and focusing
                          // it on click scrolls the overflow-hidden dialog shell out of place.
                          'relative flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-colors border',
                          checked
                            ? 'bg-warning/10 border-warning/30 text-warning'
                            : 'bg-muted border-border text-muted-foreground hover:bg-accent'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => handleMealToggle(day, meal.key, e.target.checked)}
                          className="sr-only"
                        />
                        {checked ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <meal.icon className="w-4 h-4 opacity-50" />
                        )}
                        <span className="text-sm font-medium">{meal.label}</span>
                      </label>
                    );
                  })}
                </div>
              </FieldGroup>
              </div>
              )}

              {(!compactDayNavigation || activeDaySection === 'stay') && (
              <div className="space-y-4">
              {/* Flight Booking — standalone section */}
              <div
                id={`day-${day.dayNumber}-flight-section`}
                className={cn(
                  'bg-card rounded-lg border overflow-hidden transition-shadow',
                  highlightedFlightSection === day.dayNumber
                    ? 'border-primary ring-4 ring-primary/20'
                    : 'border-primary/20',
                  compactDayNavigation && 'dark:bg-secondary/50 dark:border-primary/40'
                )}
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Plane className="w-4 h-4 text-primary" />
                    Flight Booking
                  </div>
                  <Button
                    id={`day-${day.dayNumber}-add-flight`}
                    type="button"
                    onClick={() => handleAddFlight(day)}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Flight
                  </Button>
                </div>

                <div className="px-4 pb-4 pt-3 border-t border-primary/10 space-y-2">
                  {(Array.isArray(day.flights) ? day.flights : []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No flight selected</p>
                  ) : (
                    (day.flights || []).map((flight: any, index: number) => (
                      <div key={flight.id || index} className="bg-primary/5 rounded-lg border border-primary/20 p-4 dark:bg-primary/10 dark:border-primary/35">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span className="text-sm font-medium text-primary">
                            {flight.origin ? `${flight.origin} → ${flight.destination}` : 'No flight selected'}
                          </span>
                          <div className="flex gap-2">
                            <Button type="button" onClick={() => handleEditFlight(day, index)} size="sm">
                              Edit Flight
                            </Button>
                            <Button type="button" onClick={() => handleRemoveFlight(day, index)} variant="destructive" size="sm">
                              Remove Flight
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-primary/80 space-y-0.5">
                          <p>Airline: {flight.airlinePreference || 'Any'} | Cabin: {flight.cabinClass || 'Economy'}</p>
                          {flight.departureTime && <p>Preferred: {flight.departureTime}</p>}
                          {getFlightPrice(flight) != null && (
                            <p>Price: {formatCurrency(getFlightPrice(flight)!)} (auto-added to transport)</p>
                          )}
                          {flight.flightNumber && (
                            <>
                              <p className="mt-1 font-medium text-success">Booked: {flight.flightNumber} ({flight.carrierName})</p>
                              <p>PNR: {flight.bookingReference} | Status: {flight.status}</p>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Row 4: Accommodation */}
              <div className={cn(
                'bg-card rounded-lg border border-border p-4',
                compactDayNavigation && 'dark:bg-secondary/70 dark:border-white/15'
              )}>
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  Accommodation
                </label>

                {day.accommodation?.name ? (
                  /* ── Hotel Card (selected) ──────────────────── */
                  <HotelStayCard
                    accommodation={day.accommodation}
                    roomsNote={roomsHint(day.accommodation, pricingDefaults, travelers)}
                    onSearch={() => {
                      setCurrentDayForHotel(day.dayNumber);
                      setCurrentDayLocations(day.locations || []);
                      setHotelModalMode('suggest');
                      setShowHotelModal(true);
                    }}
                    onRemove={() => {
                      onDayChange(day.dayNumber, {
                        accommodation: { name: '', type: '', rating: 0, address: '', contactNumber: '', hotelId: null, hotelImage: null, roomType: null, boardType: null, totalAmount: null, currency: null, refundable: null, bookingIds: [] },
                      });
                    }}
                  />
                ) : (
                  /* ── No hotel selected — search prompt ─────── */
                  <div className="text-center py-6 bg-muted rounded-lg border-2 border-dashed border-border">
                    <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">No hotel selected for this day</p>
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setCurrentDayForHotel(day.dayNumber);
                          setCurrentDayLocations(day.locations || []);
                          setHotelModalMode('suggest');
                          setShowHotelModal(true);
                        }}
                        size="sm"
                      >
                        <Search className="w-4 h-4" />
                        Search Hotels
                      </Button>
                      <span className="text-xs text-muted-foreground">or fill below</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 px-3">
                      <Input
                        type="text"
                        value={day.accommodation?.name || ''}
                        onChange={(e) => onDayChange(day.dayNumber, { accommodation: { ...day.accommodation, name: e.target.value } })}
                        placeholder="Hotel name (manual)"
                      />
                      <Select
                        value={day.accommodation?.type || undefined}
                        onValueChange={(value) => onDayChange(day.dayNumber, { accommodation: { ...day.accommodation, type: String(value) } })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Type">
                            {(value: string) => ACCOMMODATION_TYPE_LABELS[value] ?? value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hotel">Hotel</SelectItem>
                          <SelectItem value="resort">Resort</SelectItem>
                          <SelectItem value="guesthouse">Guesthouse</SelectItem>
                          <SelectItem value="homestay">Homestay</SelectItem>
                          <SelectItem value="camp">Camp</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {autoFillingHotel && !day.accommodation?.name && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-primary bg-primary/5 px-2 py-1 rounded-lg">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>Finding best match...</span>
                  </div>
                )}
              </div>
              </div>
              )}

              {(!compactDayNavigation || activeDaySection === 'notes') && (
              <div className="space-y-4">
              {/* Row 5: Notes */}
              <FieldGroup label="Additional Notes" icon={StickyNote}>
                <Textarea
                  rows={2}
                  value={day.notes || ''}
                  onChange={(e) => onDayChange(day.dayNumber, { notes: e.target.value })}
                  placeholder="Any additional notes or important information..."
                />
              </FieldGroup>

              {/* Row 6: Day Images — intentionally shown regardless of
                  hideTitleAndDescription (that flag only concerns the
                  title/description text fields above, not imagery). */}
              <div className={cn(
                'bg-card rounded-lg border border-border p-4',
                compactDayNavigation && 'dark:bg-secondary/70 dark:border-white/15'
              )}>
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  Day Images
                </label>

                <div className="mb-3">
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/jpg"
                    onChange={(e) => handleDayImageUpload(day.dayNumber, e.target.files)}
                    disabled={uploadingDayImages[day.dayNumber]}
                    className="hidden"
                    id={`day-${day.dayNumber}-image-upload`}
                  />
                  <label
                    htmlFor={`day-${day.dayNumber}-image-upload`}
                    className={cn(
                      'inline-flex items-center gap-2 px-5 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
                      uploadingDayImages[day.dayNumber]
                        ? 'border-primary/30 bg-primary/5 opacity-50 cursor-not-allowed'
                        : 'border-border bg-muted hover:border-primary/40 hover:bg-primary/5'
                    )}
                  >
                    {uploadingDayImages[day.dayNumber] ? (
                      <Loader className="w-4 h-4 animate-spin text-primary" />
                    ) : (
                      <Upload className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      {uploadingDayImages[day.dayNumber] ? 'Uploading...' : 'Upload Day Images'}
                    </span>
                  </label>
                </div>

                {day.images && day.images.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {day.images.map((img: any, imgIdx: number) => {
                      const imageUrl = typeof img === 'string' ? img : img.url;
                      return (
                        <div key={imgIdx} className="relative group">
                          <div className="aspect-square rounded-lg overflow-hidden border-2 border-border hover:border-primary/40 transition-colors">
                            <img
                              src={imageUrl}
                              alt={`Day ${day.dayNumber} Image ${imgIdx + 1}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50" y="50" text-anchor="middle" dominant-baseline="middle"%3EImage%3C/text%3E%3C/svg%3E';
                              }}
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveDayImage(day.dayNumber, imgIdx)}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:bg-destructive/90 transition-colors shadow-dropdown opacity-0 group-hover:opacity-100"
                            type="button"
                            title="Remove image"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              </div>
              )}

              {/* Costs & Pricing — last section of the day card */}
              {(!compactDayNavigation || activeDaySection === 'costs') && renderCostsSection(day)}
              </div>
            </div>
          )}
        </div>
        );
      })}

      {/* Add Day Button */}
      <button
        onClick={onAddDay}
        className="w-full py-4 border-2 border-dashed border-primary/30 bg-primary/5 rounded-xl text-primary hover:border-primary/50 hover:bg-primary/10 transition-colors font-medium flex items-center justify-center gap-2"
      >
        <Plus size={20} />
        Add Another Day
      </button>

      {/* Flight Selection Modal — template mode */}
      <FlightSelectionModal
        isOpen={showFlightModal}
        onClose={() => { setShowFlightModal(false); setFlightModalTarget(null); }}
        mode="template"
        initialData={flightModalTarget
          ? (days.find(d => d && d.dayNumber === flightModalTarget.dayNumber)?.flights || [])[flightModalTarget.index as number] || {}
          : {}}
        onSelectTemplate={(template: any) => {
          const { tripType: _tripType, ...flightData } = template;
          if (flightModalTarget) {
            const day = days.find(d => d && d.dayNumber === flightModalTarget.dayNumber);
            const result = flightModalTarget.index != null
              ? resolveFlightEdit({
                  flights: Array.isArray(day?.flights) ? day.flights : [],
                  transports: getDayTransports(day),
                  index: flightModalTarget.index,
                  patch: flightData,
                })
              : resolveFlightAdd({
                  flights: Array.isArray(day?.flights) ? day.flights : [],
                  transports: getDayTransports(day),
                  flightData,
                });
            onDayChange(flightModalTarget.dayNumber, result);
          }
          setShowFlightModal(false);
          setFlightModalTarget(null);
        }}
      />

      {/* Unified Hotel Selection Modal */}
      <HotelSelectionModal
        isOpen={showHotelModal}
        onClose={() => { setShowHotelModal(false); setCurrentDayForHotel(null); }}
        mode={hotelModalMode}
        destination={destination}
        packageType={packageType}
        category={category}
        locations={currentDayLocations}
        travelers={STANDARD_OCCUPANCY}
        onSelectHotel={(hotel: any) => {
          if (currentDayForHotel) {
            const day = days.find(d => d && d.dayNumber === currentDayForHotel);
            onDayChange(currentDayForHotel, { accommodation: toAccommodation(hotel, day, hotel.nights) });
          }
        }}
      />
    </div>
  );
};

export default ItineraryEditor;

import { createElement, Fragment, useState, useEffect, useMemo, useRef, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getCountryCodeFromDestination, getMappedCityFromDestination } from '@/features/itinerary/utils/destinationMapping';
import {
  Hotel, Search, ChevronRight, ChevronDown, Loader2, Ban, ListChecks, Star, ExternalLink,
  MapPin, Building2, SlidersHorizontal, Eye, AlertTriangle, CheckCircle2,
  CalendarDays, Clock3, FileText, Users,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import HotelService from '../services/hotel.service';
import CountrySelect from '../components/CountrySelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import RecommendationStrip from '@/features/recommendations/RecommendationStrip';
import HotelSelectionModal from '@/features/shared/components/HotelSelectionModal';
import HotelOccupancyFields, { type HotelRoomOccupancy } from '@/features/shared/components/HotelOccupancyFields';
import PageHeader from '../components/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface HotelRate {
  offerId?: string;
  roomType?: string;
  boardType?: string;
  refundable?: boolean;
  totalAmount?: number;
  currency?: string;
}

interface HotelOffer {
  hotelId: string;
  name: string;
  starRating?: number;
  rating?: number | null;
  reviewCount?: number;
  address?: string;
  images?: string[];
  city?: string;
  country?: string;
  cheapestRate?: HotelRate;
}

interface HotelCountry {
  code: string;
  name: string;
}

interface HotelFilterOption {
  id: number;
  name: string;
}

interface HotelFilterOptions {
  facilities: HotelFilterOption[];
  hotelTypes: HotelFilterOption[];
  chains: HotelFilterOption[];
}

interface HotelSearchFilters {
  hotelName: string;
  starRating: number[];
  minRating: string;
  minReviewsCount: string;
  hotelTypeId: string;
  chainId: string;
  facilities: number[];
  strictFacilityFiltering: boolean;
  refundableRatesOnly: boolean;
  boardType: string;
  sortBy: '' | 'top_picks' | 'price';
}

interface Booking {
  id: string;
  bookingId?: string;
  liteapiBookingId?: string | null;
  leadId?: string | null;
  hotelId?: string | null;
  hotelName?: string;
  hotelAddress?: string | null;
  hotelImage?: string | null;
  checkin?: string;
  checkout?: string;
  pnrCode?: string | null;
  hotelConfirmationCode?: string | null;
  supplierBookingId?: string | null;
  supplierBookingName?: string | null;
  supplier?: string | null;
  supplierId?: number | null;
  feed?: string | null;
  supplierPortalUrl?: string | null;
  guestInfo?: unknown[];
  roomDetails?: Record<string, unknown> | null;
  bookedRooms?: Array<Record<string, unknown>>;
  holder?: Record<string, unknown> | null;
  totalAmount?: number;
  currency?: string;
  commission?: number | null;
  clientReference?: string | null;
  status?: string;
  providerStatus?: string | null;
  createdAt?: string;
  paymentStatus?: string | null;
  paymentTransactionId?: string | null;
  paymentScheduledAt?: string | null;
  lastFreeCancellationDate?: string | null;
  refundableTag?: string | null;
  nationality?: string | null;
  holderTitle?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  adults?: number;
  children?: string | number | null;
  childrenCount?: number;
  voucherCode?: string | null;
  voucherTotalAmount?: number;
  voucherId?: number | null;
  voucherTransactionId?: string | null;
  sellingPrice?: string | number | null;
  exchangeRate?: number;
  exchangeRateUsd?: number;
  distributorCommission?: number;
  distributorPrice?: number;
  processingFee?: number;
  updatedAt?: string | null;
  refundedAt?: string | null;
  goodwillPayment?: { amount?: number; currency?: string; description?: string } | null;
  customTags?: Record<string, string> | null;
  mandatoryFees?: string | null;
  optionalFees?: string | null;
  specialRemarks?: string | null;
  knowBeforeYouGo?: string | null;
  addons?: Array<Record<string, unknown>>;
  addonsTotalAmount?: number;
  amountRefunded?: number;
  refundType?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  cancellationPolicies?: {
    refundable?: boolean;
    refundableTag?: string;
    nonRefundable?: boolean;
    hotelRemarks?: unknown[];
    cancelPolicyInfos?: Array<{ cancelTime?: string; amount?: number | string; currency?: string; type?: string; timezone?: string }>;
  } | null;
  canCancel?: boolean;
  cancellationUnavailableReason?: string | null;
}

interface HotelProfile {
  hotelId?: string;
  name?: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  hotelType?: string | null;
  chain?: string | null;
  starRating?: number;
  rating?: number | null;
  reviewCount?: number;
  images?: string[];
  amenities?: Array<string | { name?: string }>;
  description?: string | null;
  importantInformation?: string | null;
  checkinTime?: string | null;
  checkoutTime?: string | null;
  checkinInstructions?: Array<{ instruction?: string }>;
  specialInstructions?: string;
  policies?: Array<{ name?: string; description?: string }>;
  securityDeposit?: { amount?: number; currency?: string; basis?: string } | null;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const tomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

function fmtDate(iso?: string) {
  if (!iso) return '-';
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(isDateOnly ? { timeZone: 'UTC' } : {}),
  });
}

function fmtPolicyDate(iso?: string | null) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  }).format(date);
}

function fmtMoney(amount?: number, currency?: string) {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount);
}

function fmtCancellationCharge(amount: number | string | undefined, currency: string | undefined, type: string | undefined) {
  if (amount == null) return 'Fee not provided';
  const normalizedType = type?.toLowerCase() || '';
  if (normalizedType.includes('percent')) return `${amount}%`;
  if (normalizedType.includes('night')) return `${amount} night(s)`;
  return fmtMoney(Number(amount), currency);
}

function stayNights(checkin?: string, checkout?: string) {
  if (!checkin || !checkout) return null;
  const nights = Math.round((new Date(checkout).getTime() - new Date(checkin).getTime()) / 86_400_000);
  return nights > 0 ? nights : null;
}

function displayValue(value: unknown) {
  if (value == null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const HOTEL_DESCRIPTION_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'div', 'span',
  'h2', 'h3', 'h4', 'h5', 'blockquote',
]);

function renderHotelDescription(markup: string): ReactNode[] {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const renderNodes = (nodes: ChildNode[], keyPrefix: string): ReactNode[] => nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = (node as Element).tagName.toLowerCase();
    const children = renderNodes(Array.from(node.childNodes), key);
    if (tag === 'br') return createElement('br', { key });
    if (tag === 'a') return createElement('span', { key, className: 'underline underline-offset-2' }, children);
    if (!HOTEL_DESCRIPTION_TAGS.has(tag)) return createElement(Fragment, { key }, children);
    return createElement(tag, { key }, children);
  });

  return renderNodes(Array.from(parsed.body.childNodes), 'hotel-description');
}

function StarRating({ rating }: { rating?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i < (rating || 0) ? 'fill-warning text-warning' : 'text-muted'}`}
        />
      ))}
    </div>
  );
}

function HotelCard({ offer, onSelect }: { offer: HotelOffer; onSelect: (offer: HotelOffer) => void }) {
  const rate = offer.cheapestRate || {};
  return (
    <div className="bg-card rounded-xl border border-border p-5 flex flex-col md:flex-row gap-4 hover:border-primary/40 hover:shadow-[var(--shadow-card)] transition-all">
      <div className="w-full md:w-48 h-36 rounded-lg overflow-hidden bg-muted shrink-0">
        {offer.images?.[0] ? (
          <img src={offer.images[0]} alt={offer.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Building2 className="w-10 h-10" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <h3 className="font-semibold text-foreground">{offer.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              {offer.starRating != null && offer.starRating > 0 && <><StarRating rating={offer.starRating} />
              <span className="text-xs text-muted-foreground">{offer.starRating}-star</span></>}
              {offer.rating != null && <span className="text-xs text-muted-foreground">Guest score {offer.rating}/10{offer.reviewCount ? ` · ${offer.reviewCount.toLocaleString()} reviews` : ''}</span>}
            </div>
          </div>
        </div>
        {offer.address && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
            <MapPin className="w-3 h-3" /> {offer.address}
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">
            {rate.roomType || 'Standard'}
          </Badge>
          <Badge variant="outline" className="bg-muted text-muted-foreground border-transparent">
            {rate.boardType || 'Room Only'}
          </Badge>
          {rate.refundable && (
            <Badge variant="outline" className="bg-success/10 text-success border-transparent">
              Refundable
            </Badge>
          )}
        </div>
      </div>

      <div className="text-right shrink-0 flex flex-col justify-between">
        <div>
          <div className="text-2xl font-bold font-mono tabular-nums text-foreground">
            {fmtMoney(rate.totalAmount, rate.currency)}
          </div>
          <div className="text-xs text-muted-foreground">total for stay</div>
        </div>
        <Button onClick={() => onSelect(offer)} className="mt-3 gap-1.5 h-9">
          View details <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

type Tab = 'search' | 'bookings';
export default function HotelSearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusBookingId = searchParams.get('bookingId');
  const requestedCity = searchParams.get('city') || '';
  const requestedDestination = searchParams.get('destination') || '';
  const requestedAddress = searchParams.get('address') || '';
  const requestedCountry = searchParams.get('country') || '';
  const mappedCountry = getCountryCodeFromDestination(`${requestedCity} ${requestedDestination} ${requestedAddress}`);
  const initialCountry = /^[A-Z]{2}$/i.test(requestedCountry)
    ? requestedCountry.toUpperCase()
    : mappedCountry || '';
  const initialCity = requestedCity
    || getMappedCityFromDestination(`${requestedDestination} ${requestedAddress}`, initialCountry)
    || '';
  const recommendationFocus = searchParams.get('focus') === 'recommendation';
  const linkedBookingIds = new Set((searchParams.get('ids') || '').split(',').filter(Boolean));
  const bookingContext = useMemo(() => Object.fromEntries(
    ['leadId', 'packageId', 'dayNumber']
      .map((key) => [key, searchParams.get(key)])
      .filter(([, value]) => value),
  ), [searchParams]);
  const [activeTab, setActiveTab] = useState<Tab>(() => searchParams.get('tab') === 'bookings' ? 'bookings' : 'search');

  useEffect(() => {
    if (searchParams.get('tab') === 'bookings') setActiveTab('bookings');
  }, [searchParams]);

  const [form, setForm] = useState(() => ({
    city: initialCity,
    country: initialCountry,
    checkin: searchParams.get('checkin') || todayStr(),
    checkout: searchParams.get('checkout') || tomorrowStr(),
    occupancies: [{ adults: Math.max(1, Number(searchParams.get('adults')) || 1), childAges: [] }] as HotelRoomOccupancy[],
    currency: 'USD',
  }));
  const [searching, setSearching] = useState(false);
  const [countries, setCountries] = useState<HotelCountry[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [countriesError, setCountriesError] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [citiesError, setCitiesError] = useState(false);
  const [filterOptions, setFilterOptions] = useState<HotelFilterOptions>({ facilities: [], hotelTypes: [], chains: [] });
  const [filterOptionsLoaded, setFilterOptionsLoaded] = useState(false);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);
  const [filterOptionsError, setFilterOptionsError] = useState(false);
  const [facilitySearch, setFacilitySearch] = useState('');
  const [facilitiesOpen, setFacilitiesOpen] = useState(false);
  const facilitiesRef = useRef<HTMLDivElement>(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<HotelSearchFilters>({
    hotelName: searchParams.get('hotelName') || '', starRating: [], minRating: '', minReviewsCount: '', hotelTypeId: '', chainId: '',
    facilities: [], strictFacilityFiltering: false, refundableRatesOnly: false, boardType: '', sortBy: '',
  });
  const [offers, setOffers] = useState<HotelOffer[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedOffer, setSelectedOffer] = useState<HotelOffer | null>(null);
  const [hotelModalOpen, setHotelModalOpen] = useState(false);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsTab, setDetailsTab] = useState<'booking' | 'hotel'>('booking');
  const [hotelProfile, setHotelProfile] = useState<HotelProfile | null>(null);
  const [showAllHotelImages, setShowAllHotelImages] = useState(false);
  const [loadingHotelProfile, setLoadingHotelProfile] = useState(false);
  const [hotelProfileError, setHotelProfileError] = useState('');
  const [cancellationBooking, setCancellationBooking] = useState<Booking | null>(null);
  const [loadingCancellation, setLoadingCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const autoSearchStarted = useRef(false);
  const autoOpenedBookingId = useRef<string | null>(null);
  const selectedCountryName = countries.find((item) => item.code === form.country)?.name;
  const destinationCountryDisplay = selectedCountryName || requestedCountry || requestedDestination || 'Not provided on lead';

  useEffect(() => {
    let active = true;
    HotelService.getCountries()
      .then((response) => { if (active) setCountries(response.data || []); })
      .catch(() => { if (active) setCountriesError(true); })
      .finally(() => { if (active) setCountriesLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!form.country) {
      setCities([]);
      setCitiesError(false);
      return;
    }
    let active = true;
    setCities([]);
    setCitiesLoading(true);
    setCitiesError(false);
    HotelService.getCities(form.country)
      .then((response) => { if (active) setCities(response.data || []); })
      .catch(() => { if (active) setCitiesError(true); })
      .finally(() => { if (active) setCitiesLoading(false); });
    return () => { active = false; };
  }, [form.country]);

  useEffect(() => {
    const countryHint = requestedCountry || requestedDestination;
    if (countriesLoading || form.country || !countryHint) return;
    const mappedMatch = mappedCountry
      ? countries.find((item) => item.code.toLowerCase() === mappedCountry.toLowerCase())
      : undefined;
    const locationText = `${requestedCountry} ${requestedDestination} ${requestedAddress}`.toLocaleLowerCase();
    const namedMatches = countries.filter((item) => locationText.includes(item.name.toLocaleLowerCase()));
    const namedMatch = namedMatches.length === 1 ? namedMatches[0] : undefined;
    const matchedCountry = countries.find((item) =>
      item.code.toLowerCase() === countryHint.toLowerCase()
      || item.name.toLowerCase() === countryHint.toLowerCase(),
    ) || mappedMatch || namedMatch;
    if (matchedCountry) setForm((current) => ({ ...current, country: matchedCountry.code }));
  }, [countries, countriesLoading, form.country, mappedCountry, requestedAddress, requestedCountry, requestedDestination]);

  const handleSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!form.city.trim()) {
      toast.error('Enter a city to search');
      return;
    }
    if (!form.country) {
      toast.error('Select the destination country');
      return;
    }
    const selectedCity = cities.find((city) => city.toLocaleLowerCase() === form.city.trim().toLocaleLowerCase());
    if (!selectedCity) {
      toast.error('Select a city from LiteAPI locations for this country');
      return;
    }
    if (!form.checkin || !form.checkout || form.checkout <= form.checkin) {
      toast.error('Check-out must be after check-in');
      return;
    }
    if (form.occupancies.some((room) => room.childAges.some((age) => age == null))) {
      toast.error('Enter the age of every child');
      return;
    }

    setSearching(true);
    setHasSearched(true);
    setOffers([]);
    try {
      const response = await HotelService.search({
        city: selectedCity,
        country: form.country,
        checkin: form.checkin,
        checkout: form.checkout,
        occupancies: form.occupancies.map((room) => ({
          adults: room.adults,
          children: room.childAges as number[],
        })),
        currency: form.currency,
        guestNationality: form.country,
        limit: 5000,
        ...(filters.hotelName.trim() && { hotelName: filters.hotelName.trim() }),
        ...(filters.starRating.length && { starRating: filters.starRating }),
        ...(filters.minRating !== '' && { minRating: Number(filters.minRating) }),
        ...(filters.minReviewsCount !== '' && { minReviewsCount: Number(filters.minReviewsCount) }),
        ...(filters.hotelTypeId && { hotelTypeIds: [Number(filters.hotelTypeId)] }),
        ...(filters.chainId && { chainIds: [Number(filters.chainId)] }),
        ...(filters.facilities.length && { facilities: filters.facilities }),
        ...(filters.facilities.length && { strictFacilityFiltering: filters.strictFacilityFiltering }),
        ...(filters.refundableRatesOnly && { refundableRatesOnly: true }),
        ...(filters.boardType && { boardType: filters.boardType }),
        ...(filters.sortBy && {
          sort: [{ field: filters.sortBy, direction: filters.sortBy === 'price' ? 'ascending' : 'descending' }],
        }),
      });
      setOffers(response.data || []);
      if (!response.data?.length) toast('No hotels found', { type: 'info' });
    } catch (err) {
      toast.error((err as Error)?.message || 'Hotel search failed');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (
      !bookingContext.leadId
      || autoSearchStarted.current
      || countriesLoading
      || citiesLoading
      || !form.country
      || !form.city
      || cities.length === 0
    ) return;

    const locationHints = [form.city, requestedDestination, requestedAddress]
      .filter(Boolean)
      .map((value) => value.toLocaleLowerCase());
    const matchedCity = cities.find((city) => locationHints.some((hint) => hint === city.toLocaleLowerCase()))
      || cities.find((city) => locationHints.some((hint) => hint.includes(city.toLocaleLowerCase())));
    if (!matchedCity) {
      if (form.city) setForm((current) => ({ ...current, city: '' }));
      return;
    }
    if (form.city !== matchedCity) {
      setForm((current) => ({ ...current, city: matchedCity }));
      return;
    }

    autoSearchStarted.current = true;
    void handleSearch();
    // The handler intentionally uses the resolved country/city values from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingContext.leadId, countriesLoading, citiesLoading, cities, form.country, form.city, requestedDestination, requestedAddress]);

  const selectOffer = (offer: HotelOffer) => {
    setSelectedOffer(offer);
    setHotelModalOpen(true);
  };

  const resetSearch = () => {
    setOffers([]);
    setHasSearched(false);
    setSelectedOffer(null);
    setHotelModalOpen(false);
  };

  const fetchBookings = async () => {
    setLoadingBookings(true);
    try {
      const r = await HotelService.listBookings();
      setBookings(r.data || []);
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load bookings');
    } finally {
      setLoadingBookings(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'bookings') fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'bookings' || linkedBookingIds.size === 0 || !recommendationFocus || loadingBookings) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('recommendation-target')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, searchParams, recommendationFocus, loadingBookings]);

  const visibleBookings = linkedBookingIds.size > 0
    ? bookings.filter((booking) => linkedBookingIds.has(booking.id))
    : bookings;

  const loadBookingDetails = async (id: string) => {
    const response = await HotelService.getBooking(id);
    return response.data as Booking;
  };

  const openBookingDetails = async (booking: Booking) => {
    setSelectedBooking(booking);
    setLoadingDetails(true);
    setDetailsError('');
    setDetailsTab('booking');
    setHotelProfile(null);
    setShowAllHotelImages(false);
    setHotelProfileError('');
    try {
      const details = await loadBookingDetails(booking.id);
      setSelectedBooking({ ...booking, ...details, leadId: details.leadId ?? booking.leadId });
    } catch (err) {
      setDetailsError((err as Error)?.message || 'Could not load booking details.');
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'bookings' || loadingBookings || !focusBookingId || autoOpenedBookingId.current === focusBookingId || selectedBooking) return;
    const booking = bookings.find((item) => item.id === focusBookingId);
    if (!booking) return;
    autoOpenedBookingId.current = focusBookingId;
    void openBookingDetails(booking);
  }, [activeTab, bookings, focusBookingId, loadingBookings, selectedBooking]);

  const openHotelProfile = async () => {
    if (!selectedBooking?.hotelId || hotelProfile || loadingHotelProfile) return;
    setLoadingHotelProfile(true);
    setHotelProfileError('');
    try {
      const response = await HotelService.getDetails(selectedBooking.hotelId);
      setHotelProfile(response.data as HotelProfile);
    } catch (err) {
      setHotelProfileError((err as Error)?.message || 'Hotel details could not be loaded.');
    } finally {
      setLoadingHotelProfile(false);
    }
  };

  const selectDetailsTab = (tab: 'booking' | 'hotel') => {
    setDetailsTab(tab);
    if (tab === 'hotel') void openHotelProfile();
  };

  const openCancellation = async (booking: Booking) => {
    setCancellationBooking(booking);
    setCancellationReason('');
    setCancellationError('');
    setLoadingCancellation(true);
    try {
      const details = await loadBookingDetails(booking.id);
      setCancellationBooking(details);
    } catch (err) {
      setCancellationError((err as Error)?.message || 'Could not load current cancellation eligibility.');
    } finally {
      setLoadingCancellation(false);
    }
  };

  const closeCancellation = () => {
    if (loadingCancellation || confirmingCancellation) return;
    setCancellationBooking(null);
    setCancellationError('');
  };

  const cancelBooking = async () => {
    if (!cancellationBooking?.canCancel) return;
    setConfirmingCancellation(true);
    setCancellationError('');
    try {
      const response = await HotelService.cancelBooking(cancellationBooking.id, cancellationReason || 'Cancelled by agent');
      const result = response.data?.cancellation;
      const outcomes = [
        result?.cancellationFee != null ? `Fee ${fmtMoney(Number(result.cancellationFee), result.currency || cancellationBooking.currency)}` : null,
        result?.refundAmount != null ? `Refund ${fmtMoney(Number(result.refundAmount), result.currency || cancellationBooking.currency)}` : null,
      ].filter(Boolean);
      toast.success(`Hotel cancellation confirmed${outcomes.length ? ` · ${outcomes.join(' · ')}` : ''}`);
      setCancellationBooking(null);
      await fetchBookings();
    } catch (err) {
      setCancellationError((err as Error)?.message || 'Cancellation failed.');
    } finally {
      setConfirmingCancellation(false);
    }
  };

  const loadFilterOptions = async () => {
    if (filterOptionsLoaded || filterOptionsLoading) return;
    setFilterOptionsLoading(true);
    setFilterOptionsError(false);
    try {
      const response = await HotelService.getFilterOptions();
      setFilterOptions(response.data || { facilities: [], hotelTypes: [], chains: [] });
      setFilterOptionsLoaded(true);
    } catch {
      setFilterOptionsError(true);
    } finally {
      setFilterOptionsLoading(false);
    }
  };

  useEffect(() => {
    if (!facilitiesOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !facilitiesRef.current?.contains(event.target)) setFacilitiesOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFacilitiesOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [facilitiesOpen]);

  return (
    <>
      <PageHeader title="Hotels" subtitle="Search and book hotels worldwide" />
      <div className="mx-auto max-w-7xl px-4 pt-4 md:px-6"><RecommendationStrip module="hotels" /></div>
      <div className="min-h-screen bg-background p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (!value) return;
            setActiveTab(value as Tab);
            setSearchParams({ tab: value });
            if (value === 'search') resetSearch();
          }}
        >
          <TabsList>
            <TabsTrigger value="search" className="gap-1.5">
              <Search className="w-4 h-4" /> Search & Book
            </TabsTrigger>
            <TabsTrigger value="bookings" className="gap-1.5">
              <ListChecks className="w-4 h-4" /> Bookings
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === 'search' && (
        <>
              <form onSubmit={handleSearch} className="bg-card rounded-xl shadow-[var(--shadow-card)] border border-border p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Destination country</label>
                    <CountrySelect
                      value={form.country}
                      countries={countries}
                      disabled={countriesLoading || countriesError || countries.length === 0}
                      inputClassName="h-10 rounded-lg border border-input bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                      onChange={(code: string) => setForm({ ...form, country: code, city: '' })}
                      placeholder={countriesLoading ? 'Loading countries...' : countriesError ? 'Country list unavailable' : 'Select destination country...'}
                    />
                    {bookingContext.leadId && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Destination country: <span className="font-medium text-foreground">{destinationCountryDisplay}</span>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">City</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        list={`hotel-cities-${form.country}`}
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                        disabled={!form.country || citiesLoading || cities.length === 0}
                        placeholder={citiesError ? 'City list unavailable' : citiesLoading ? 'Loading cities...' : 'Select or type a city...'}
                        className="h-10 pl-9"
                      />
                    </div>
                    <datalist id={`hotel-cities-${form.country}`}>
                      {cities.map((city) => <option key={city} value={city} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Property name (optional)</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={filters.hotelName}
                        onChange={(event) => setFilters({ ...filters, hotelName: event.target.value })}
                        placeholder="Search hotel name"
                        className="h-10 pl-9"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Check-in</label>
                    <Input
                      type="date"
                      value={form.checkin}
                      min={todayStr()}
                      onChange={(e) => setForm({ ...form, checkin: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Check-out</label>
                    <Input
                      type="date"
                      value={form.checkout}
                      min={form.checkin || todayStr()}
                      onChange={(e) => setForm({ ...form, checkout: e.target.value })}
                      className="h-10"
                    />
                  </div>
                </div>
                <div className="mb-4 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 gap-2 px-1"
                      aria-expanded={advancedFiltersOpen}
                      onClick={() => {
                        const open = !advancedFiltersOpen;
                        setAdvancedFiltersOpen(open);
                        if (open) void loadFilterOptions();
                      }}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Advanced filters
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                    {advancedFiltersOpen && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFilters({
                            hotelName: '', starRating: [], minRating: '', minReviewsCount: '', hotelTypeId: '', chainId: '',
                            facilities: [], strictFacilityFiltering: false, refundableRatesOnly: false, boardType: '', sortBy: '',
                          });
                          setFacilitySearch('');
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                  {advancedFiltersOpen && (
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                      <fieldset>
                        <legend className="mb-2 text-xs font-medium text-muted-foreground">Stars</legend>
                        <div className="flex flex-wrap gap-2">
                          {[3, 3.5, 4, 4.5, 5].map((star) => (
                            <label key={star} className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border px-2 text-sm">
                              <input
                                type="checkbox"
                                checked={filters.starRating.includes(star)}
                                onChange={(event) => setFilters({
                                  ...filters,
                                  starRating: event.target.checked
                                    ? [...filters.starRating, star]
                                    : filters.starRating.filter((value) => value !== star),
                                })}
                              />
                              {star} <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label className="block text-xs text-muted-foreground">
                        Minimum guest rating
                        <select value={filters.minRating} onChange={(event) => setFilters({ ...filters, minRating: event.target.value })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Any rating</option>
                          {[3, 3.5, 4, 4.5, 5].map((rating) => <option key={rating} value={rating}>{rating} / 5 or higher</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Minimum reviews
                        <select value={filters.minReviewsCount} onChange={(event) => setFilters({ ...filters, minReviewsCount: event.target.value })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Any number</option>
                          {[10, 50, 100, 500, 1000].map((count) => <option key={count} value={count}>{count}+ reviews</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Property type
                        <select value={filters.hotelTypeId} onChange={(event) => setFilters({ ...filters, hotelTypeId: event.target.value })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Any type</option>
                          {filterOptions.hotelTypes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Chain
                        <select value={filters.chainId} onChange={(event) => setFilters({ ...filters, chainId: event.target.value })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Any chain</option>
                          {filterOptions.chains.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Board type
                        <select value={filters.boardType} onChange={(event) => setFilters({ ...filters, boardType: event.target.value })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Any meal plan</option>
                          {[
                            ['RO', 'Room only'], ['BI', 'Breakfast included'], ['HB', 'Half board'],
                            ['FB', 'Full board'], ['AI', 'All inclusive'], ['DI', 'Dinner included'],
                            ['LI', 'Lunch included'], ['BDI', 'Breakfast and dinner'], ['BLI', 'Breakfast and lunch'], ['LDI', 'Lunch and dinner'],
                          ].map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                        </select>
                      </label>
                      <label className="block text-xs text-muted-foreground">
                        Sort by
                        <select value={filters.sortBy} onChange={(event) => setFilters({ ...filters, sortBy: event.target.value as HotelSearchFilters['sortBy'] })}
                          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground">
                          <option value="">Top picks</option>
                          <option value="price">Lowest price</option>
                        </select>
                      </label>
                      <div className="space-y-2 pt-5 text-sm text-foreground">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={filters.refundableRatesOnly}
                            onChange={(event) => setFilters({ ...filters, refundableRatesOnly: event.target.checked })} />
                          Refundable rates only
                        </label>
                        {filters.facilities.length > 0 && (
                          <label className="flex items-center gap-2">
                            <input type="checkbox" checked={filters.strictFacilityFiltering}
                              onChange={(event) => setFilters({ ...filters, strictFacilityFiltering: event.target.checked })} />
                            Require all selected facilities
                          </label>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs text-muted-foreground">Facilities</label>
                        <div ref={facilitiesRef} className="relative mt-1">
                          <button
                            type="button"
                            aria-expanded={facilitiesOpen}
                            onClick={() => setFacilitiesOpen((open) => !open)}
                            className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <span>{filters.facilities.length ? `${filters.facilities.length} facilities selected` : 'Any facility'}</span>
                            <ChevronDown className={`h-4 w-4 transition-transform ${facilitiesOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {facilitiesOpen && (
                            <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-border bg-popover p-2 shadow-[var(--shadow-dropdown)]">
                              <Input
                                autoFocus
                                aria-label="Search facilities"
                                value={facilitySearch}
                                onChange={(event) => setFacilitySearch(event.target.value)}
                                placeholder="Search facilities..."
                                className="h-10"
                              />
                              {filterOptionsLoading ? <p className="px-2 py-4 text-sm text-muted-foreground">Loading facilities...</p>
                                : filterOptionsError ? <p className="px-2 py-4 text-sm text-destructive">Could not load facilities.</p>
                                  : <div className="mt-2 max-h-60 overflow-y-auto">
                                    {filterOptions.facilities
                                      .filter((option) => option.name.toLowerCase().includes(facilitySearch.trim().toLowerCase()))
                                      .map((option) => (
                                        <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 text-sm text-foreground hover:bg-accent">
                                          <input type="checkbox" checked={filters.facilities.includes(option.id)}
                                            onChange={(event) => setFilters({
                                              ...filters,
                                              facilities: event.target.checked
                                                ? [...filters.facilities, option.id]
                                                : filters.facilities.filter((id) => id !== option.id),
                                            })} />
                                          <span>{option.name}</span>
                                        </label>
                                      ))}
                                  </div>}
                            </div>
                          )}
                      </div>
                    </div>
                    </div>
                  )}
                </div>
                <div className="mb-4">
                  <HotelOccupancyFields
                    occupancies={form.occupancies}
                    onChange={(occupancies) => setForm({ ...form, occupancies })}
                  />
                </div>
                <Button type="submit" disabled={searching} className="gap-2 h-10">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {searching ? 'Searching...' : 'Search Hotels'}
                </Button>
              </form>

              {searching && (
                <div className="text-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  <p className="text-sm text-muted-foreground mt-2">Searching hotels...</p>
                </div>
              )}
              {hasSearched &&
                !searching &&
                (offers.length === 0 ? (
                  <div className="text-center py-16 bg-card rounded-xl border border-border">
                    <Hotel className="w-12 h-12 text-muted mx-auto mb-3" />
                    <p className="text-muted-foreground">No hotels found. Try a different city or dates.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {offers.length} hotel{offers.length !== 1 ? 's' : ''} found
                    </p>
                    {offers.map((offer) => (
                      <HotelCard key={offer.hotelId} offer={offer} onSelect={selectOffer} />
                    ))}
                  </div>
                ))}
        </>
      )}

      {hotelModalOpen && selectedOffer && (
        <HotelSelectionModal
          isOpen={hotelModalOpen}
          onClose={() => setHotelModalOpen(false)}
          mode="search"
          initialHotel={selectedOffer}
          initialCheckin={form.checkin}
          initialCheckout={form.checkout}
          initialOccupancies={form.occupancies}
          country={form.country}
          currency={form.currency}
          leadContext={bookingContext}
          onBookHotel={() => { void fetchBookings(); }}
        />
      )}

      {activeTab === 'bookings' && (
        <>
        {linkedBookingIds.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-sm text-foreground">Active filter: linked hotel bookings <span className="font-mono tabular-nums">({visibleBookings.length})</span></p>
            <Button variant="ghost" size="sm" onClick={() => setSearchParams({ tab: 'bookings' })}>Clear filter</Button>
          </div>
        )}
        <div id="recommendation-target" className="scroll-mt-20 bg-card rounded-xl shadow-[var(--shadow-card)] border border-border overflow-hidden">
          {loadingBookings ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : visibleBookings.length === 0 ? (
            <div className="p-16 text-center">
              <ListChecks className="w-12 h-12 text-muted mx-auto mb-3" />
              <p className="text-muted-foreground">{bookings.length === 0 ? 'No hotel bookings yet.' : 'No matching hotel bookings.'}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3">Hotel</th>
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Check-in</th>
                  <th className="px-4 py-3">Check-out</th>
                  <th className="px-4 py-3">Guests</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{b.hotelName || 'Unknown'}</td>
                    <td className="px-4 py-3">
                      {b.leadId ? (
                        <a
                          href={`/leads?ids=${encodeURIComponent(b.leadId)}&leadId=${encodeURIComponent(b.leadId)}&open=1`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                          aria-label={`Open lead ${b.leadId}`}
                        >
                          {b.leadId.slice(0, 8)} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : <span className="text-muted-foreground">Unlinked</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(b.checkin)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(b.checkout)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{b.guestInfo?.length || '-'}</td>
                    <td className="px-4 py-3 font-medium font-mono tabular-nums text-foreground">
                      {fmtMoney(b.totalAmount, b.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={b.status === 'cancelled' || b.status === 'failed'
                          ? 'bg-destructive/10 text-destructive border-transparent'
                          : b.status === 'pending'
                            ? 'bg-warning/10 text-warning border-transparent'
                            : 'bg-success/10 text-success border-transparent'}
                      >
                        {b.status || 'unknown'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => void openBookingDetails(b)}>
                          <Eye className="h-3.5 w-3.5" /> Details
                        </Button>
                        {b.status !== 'cancelled' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void openCancellation(b)}
                          >
                            <Ban className="h-3.5 w-3.5" /> Cancel
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
      )}

      <Dialog open={selectedBooking !== null} onOpenChange={(open) => !open && !loadingDetails && setSelectedBooking(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] !max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedBooking?.hotelName || 'Hotel booking details'}</DialogTitle>
            <DialogDescription>
              Booking ID {selectedBooking?.liteapiBookingId || selectedBooking?.id}
              {selectedBooking?.holder ? ` · ${[selectedBooking.holder.firstName, selectedBooking.holder.lastName].filter(Boolean).join(' ')}` : ''}
            </DialogDescription>
            {selectedBooking?.leadId && (
              <a
                href={`/leads?ids=${encodeURIComponent(selectedBooking.leadId)}&leadId=${encodeURIComponent(selectedBooking.leadId)}&open=1`}
                className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
                aria-label={`Open lead ${selectedBooking.leadId}`}
              >
                <ExternalLink className="h-3.5 w-3.5" /> Lead {selectedBooking.leadId.slice(0, 8)}
              </a>
            )}
          </DialogHeader>

          {loadingDetails ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading current booking details...
            </div>
          ) : selectedBooking ? (
            <div className="space-y-4">
              {detailsError && <p role="alert" className="text-sm text-destructive">{detailsError}</p>}
              <div role="tablist" aria-label="Booking information" className="flex w-fit max-w-full gap-1 rounded-md bg-muted p-1">
                <Button
                  type="button"
                  role="tab"
                  aria-selected={detailsTab === 'booking'}
                  variant={detailsTab === 'booking' ? 'secondary' : 'ghost'}
                  onClick={() => selectDetailsTab('booking')}
                >
                  <FileText className="h-4 w-4" /> Booking Details
                </Button>
                <Button
                  type="button"
                  role="tab"
                  aria-selected={detailsTab === 'hotel'}
                  variant={detailsTab === 'hotel' ? 'secondary' : 'ghost'}
                  onClick={() => selectDetailsTab('hotel')}
                >
                  <Building2 className="h-4 w-4" /> Hotel Details
                </Button>
              </div>

              {detailsTab === 'booking' ? (
                <div className="space-y-4">
                  <section className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Building2 className="h-5 w-5 text-primary" />
                      <span className="text-xs uppercase text-muted-foreground">Hotel</span>
                      <span className="text-sm font-semibold">{selectedBooking.hotelName || 'Unknown hotel'}</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <CalendarDays className="h-5 w-5 text-primary" />
                      <span className="text-xs uppercase text-muted-foreground">Date and time</span>
                      <span className="text-sm font-semibold">{fmtDate(selectedBooking.checkin)} - {fmtDate(selectedBooking.checkout)}</span>
                      <span className="text-xs text-muted-foreground">{stayNights(selectedBooking.checkin, selectedBooking.checkout) ?? '-'} night(s)</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Users className="h-5 w-5 text-primary" />
                      <span className="text-xs uppercase text-muted-foreground">Room details</span>
                      <span className="text-sm font-semibold">{selectedBooking.bookedRooms?.length || 1} room(s)</span>
                      <span className="text-xs text-muted-foreground">
                        {selectedBooking.bookedRooms?.reduce((sum, room) => sum + Number(room.adults || 0), 0) || selectedBooking.guestInfo?.length || '-'} adults
                      </span>
                    </div>
                  </section>

                  <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold">Price &amp; commission</h3>
                      <Badge variant="outline" className={selectedBooking.refundableTag === 'RFN' ? 'border-success/30 bg-success/10 text-success' : selectedBooking.refundableTag === 'NRFN' ? 'border-warning/30 bg-warning/10 text-warning' : ''}>
                        {selectedBooking.refundableTag === 'RFN' ? 'Refundable' : selectedBooking.refundableTag === 'NRFN' ? 'Non-refundable' : 'Refund terms unavailable'}
                      </Badge>
                    </div>
                    <dl className="divide-y divide-border text-sm">
                      <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">Booking price</dt><dd className="font-mono font-semibold">{fmtMoney(selectedBooking.totalAmount, selectedBooking.currency)}</dd></div>
                      {selectedBooking.commission != null && <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">Commission</dt><dd className="font-mono">{fmtMoney(selectedBooking.commission, selectedBooking.currency)}</dd></div>}
                      {selectedBooking.addonsTotalAmount ? <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">Add-ons</dt><dd className="font-mono">{fmtMoney(selectedBooking.addonsTotalAmount, selectedBooking.currency)}</dd></div> : null}
                      {selectedBooking.voucherTotalAmount ? <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">LiteAPI voucher discount</dt><dd className="font-mono">{fmtMoney(selectedBooking.voucherTotalAmount, selectedBooking.currency)}</dd></div> : null}
                      {selectedBooking.processingFee ? <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">Processing fee</dt><dd className="font-mono">{fmtMoney(selectedBooking.processingFee, selectedBooking.currency)}</dd></div> : null}
                    </dl>
                  </section>

                  <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <h3 className="text-base font-semibold">Cancellation terms</h3>
                    {selectedBooking.lastFreeCancellationDate ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md bg-muted/40 p-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-4 w-4" /> Last free cancellation date</div>
                          <p className="mt-2 text-sm font-semibold">{fmtPolicyDate(selectedBooking.lastFreeCancellationDate)}</p>
                        </div>
                        <div className="rounded-md bg-muted/40 p-3">
                          <div className="text-xs text-muted-foreground">Cancellation fees after deadline</div>
                          {selectedBooking.cancellationPolicies?.cancelPolicyInfos?.length ? (
                            selectedBooking.cancellationPolicies.cancelPolicyInfos.map((policy, index) => (
                              <p key={`${policy.cancelTime || 'policy'}-${index}`} className="mt-2 text-sm font-semibold text-destructive">
                                {policy.cancelTime ? `From ${fmtPolicyDate(policy.cancelTime)} · ` : ''}
                                {fmtCancellationCharge(policy.amount, policy.currency || selectedBooking.currency, policy.type)}
                              </p>
                            ))
                          ) : <p className="mt-2 text-sm text-muted-foreground">Fee not provided</p>}
                        </div>
                      </div>
                    ) : selectedBooking.refundableTag === 'NRFN' ? (
                      <p className="text-sm text-warning">This booking is non-refundable. LiteAPI did not provide a free-cancellation deadline.</p>
                    ) : <p className="text-sm text-muted-foreground">The provider did not return a free-cancellation deadline.</p>}
                    {selectedBooking.cancellationPolicies?.hotelRemarks?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {selectedBooking.cancellationPolicies.hotelRemarks.map((remark: any, index: number) => <li key={index}>{typeof remark === 'string' ? remark : displayValue(remark)}</li>)}
                      </ul>
                    ) : null}
                  </section>

                  <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <h3 className="text-base font-semibold">Booking details</h3>
                    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs uppercase text-muted-foreground">Status</dt><dd className="mt-1"><Badge variant="outline">{selectedBooking.providerStatus || selectedBooking.status || 'Unknown'}</Badge></dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">LiteAPI booking ID</dt><dd className="mt-1 break-all font-mono">{selectedBooking.bookingId || selectedBooking.liteapiBookingId || '-'}</dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">Hotel confirmation number</dt><dd className="mt-1 break-all font-mono">{selectedBooking.hotelConfirmationCode || selectedBooking.pnrCode || 'Pending'}</dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">Supplier booking ID</dt><dd className="mt-1 break-all font-mono">{selectedBooking.supplierBookingId || '-'}</dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">Supplier</dt><dd className="mt-1">{[selectedBooking.supplierBookingName, selectedBooking.supplier].filter(Boolean).join(' · ') || '-'}</dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">Hotel ID</dt><dd className="mt-1 break-all font-mono">{selectedBooking.hotelId || '-'}</dd></div>
                      <div><dt className="text-xs uppercase text-muted-foreground">Booking created</dt><dd className="mt-1">{selectedBooking.createdAt ? new Date(selectedBooking.createdAt).toLocaleString() : 'Not recorded'}</dd></div>
                      {selectedBooking.updatedAt && <div><dt className="text-xs uppercase text-muted-foreground">Last updated</dt><dd className="mt-1">{new Date(selectedBooking.updatedAt).toLocaleString()}</dd></div>}
                      {selectedBooking.lastFreeCancellationDate && <div><dt className="text-xs uppercase text-muted-foreground">Cancellation deadline</dt><dd className="mt-1">{fmtPolicyDate(selectedBooking.lastFreeCancellationDate)}</dd></div>}
                      <div><dt className="text-xs uppercase text-muted-foreground">Tag</dt><dd className="mt-1"><Badge variant="outline">{selectedBooking.refundableTag || 'Not provided'}</Badge></dd></div>
                      {selectedBooking.nationality && <div><dt className="text-xs uppercase text-muted-foreground">Nationality</dt><dd className="mt-1">{selectedBooking.nationality}</dd></div>}
                      <div><dt className="text-xs uppercase text-muted-foreground">Currency</dt><dd className="mt-1">{selectedBooking.currency || 'USD'}</dd></div>
                      {selectedBooking.paymentStatus && <div><dt className="text-xs uppercase text-muted-foreground">Payment status</dt><dd className="mt-1 capitalize">{selectedBooking.paymentStatus}</dd></div>}
                      {selectedBooking.clientReference && <div><dt className="text-xs uppercase text-muted-foreground">Client reference</dt><dd className="mt-1 break-all font-mono">{selectedBooking.clientReference}</dd></div>}
                      {selectedBooking.paymentTransactionId && <div><dt className="text-xs uppercase text-muted-foreground">Payment reference</dt><dd className="mt-1 break-all font-mono">{selectedBooking.paymentTransactionId}</dd></div>}
                      {selectedBooking.paymentScheduledAt && <div><dt className="text-xs uppercase text-muted-foreground">Scheduled payment</dt><dd className="mt-1">{new Date(selectedBooking.paymentScheduledAt).toLocaleString()}</dd></div>}
                      {selectedBooking.voucherCode && <div><dt className="text-xs uppercase text-muted-foreground">LiteAPI voucher code</dt><dd className="mt-1 break-all font-mono">{selectedBooking.voucherCode}</dd></div>}
                      {selectedBooking.voucherId != null && <div><dt className="text-xs uppercase text-muted-foreground">LiteAPI voucher ID</dt><dd className="mt-1 font-mono">{selectedBooking.voucherId}</dd></div>}
                      {selectedBooking.voucherTransactionId && <div><dt className="text-xs uppercase text-muted-foreground">Voucher transaction</dt><dd className="mt-1 break-all font-mono">{selectedBooking.voucherTransactionId}</dd></div>}
                      {selectedBooking.sellingPrice != null && <div><dt className="text-xs uppercase text-muted-foreground">Selling price</dt><dd className="mt-1">{fmtMoney(Number(selectedBooking.sellingPrice), selectedBooking.currency)}</dd></div>}
                      {selectedBooking.distributorPrice ? <div><dt className="text-xs uppercase text-muted-foreground">Distributor price</dt><dd className="mt-1">{fmtMoney(selectedBooking.distributorPrice, selectedBooking.currency)}</dd></div> : null}
                      {selectedBooking.distributorCommission ? <div><dt className="text-xs uppercase text-muted-foreground">Distributor commission</dt><dd className="mt-1">{fmtMoney(selectedBooking.distributorCommission, selectedBooking.currency)}</dd></div> : null}
                      {selectedBooking.exchangeRate ? <div><dt className="text-xs uppercase text-muted-foreground">Exchange rate</dt><dd className="mt-1">{selectedBooking.exchangeRate}</dd></div> : null}
                      {selectedBooking.exchangeRateUsd ? <div><dt className="text-xs uppercase text-muted-foreground">USD exchange rate</dt><dd className="mt-1">{selectedBooking.exchangeRateUsd}</dd></div> : null}
                      {Number(selectedBooking.amountRefunded || 0) > 0 && <div><dt className="text-xs uppercase text-muted-foreground">Amount refunded</dt><dd className="mt-1">{fmtMoney(selectedBooking.amountRefunded, selectedBooking.currency)}{selectedBooking.refundType ? ` · ${selectedBooking.refundType}` : ''}</dd></div>}
                      {selectedBooking.refundedAt && <div><dt className="text-xs uppercase text-muted-foreground">Refunded</dt><dd className="mt-1">{fmtDate(selectedBooking.refundedAt)}</dd></div>}
                      {selectedBooking.cancelledAt && <div><dt className="text-xs uppercase text-muted-foreground">Cancelled</dt><dd className="mt-1">{fmtDate(selectedBooking.cancelledAt)}</dd></div>}
                    </dl>
                    {selectedBooking.cancellationReason && <p className="border-t border-border pt-3 text-sm"><span className="text-muted-foreground">Cancellation reason: </span>{selectedBooking.cancellationReason}</p>}
                  </section>

                  {(selectedBooking.holder || selectedBooking.firstName || selectedBooking.email || selectedBooking.nationality) && (
                    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                      <h3 className="text-base font-semibold">Guest information</h3>
                      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                        <div><dt className="text-xs uppercase text-muted-foreground">Full name</dt><dd className="mt-1">{[selectedBooking.holderTitle, selectedBooking.holder?.firstName || selectedBooking.firstName, selectedBooking.holder?.lastName || selectedBooking.lastName].filter(Boolean).join(' ') || '-'}</dd></div>
                        <div><dt className="text-xs uppercase text-muted-foreground">Email</dt><dd className="mt-1 break-all">{String(selectedBooking.holder?.email || selectedBooking.email || '-')}</dd></div>
                        <div><dt className="text-xs uppercase text-muted-foreground">Phone</dt><dd className="mt-1">{displayValue(selectedBooking.holder?.phone)}</dd></div>
                        <div><dt className="text-xs uppercase text-muted-foreground">Nationality</dt><dd className="mt-1">{selectedBooking.nationality || '-'}</dd></div>
                      </dl>
                    </section>
                  )}

                  {selectedBooking.bookedRooms?.length ? (
                    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                      <h3 className="text-base font-semibold">Rooms and guests</h3>
                      {selectedBooking.bookedRooms.map((room, index) => {
                        const roomType = room.roomType && typeof room.roomType === 'object' ? room.roomType as Record<string, unknown> : {};
                        const roomGuests = Array.isArray(room.guests) ? room.guests as Array<Record<string, unknown>> : [];
                        const guestName = [room.firstName, room.lastName].filter(Boolean).join(' ');
                        const roomPolicy = room.cancellationPolicies && typeof room.cancellationPolicies === 'object' ? room.cancellationPolicies as Booking['cancellationPolicies'] : null;
                        return (
                          <div key={`${room.occupancy_number || index}`} className="border-t border-border pt-3 first:border-0 first:pt-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div><p className="text-sm font-semibold">Room {index + 1} · {displayValue(roomType.name || room.roomName || room.roomTitle)}</p><p className="mt-1 text-sm text-muted-foreground">{displayValue(room.boardName || room.board)}</p></div>
                              <span className="text-sm text-muted-foreground">{Number(room.adults || 0)} Adults{Number(room.children || room.children_count || 0) ? ` · ${Number(room.children || room.children_count)} Children` : ''}</span>
                            </div>
                            {guestName && <p className="mt-2 text-sm">Guest: {guestName}</p>}
                            {roomGuests.map((guest, guestIndex) => (
                              <div key={`${guest.occupancyNumber || guestIndex}`} className="mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                                <span>Guest {guestIndex + 1}: {[guest.firstName, guest.lastName].filter(Boolean).join(' ') || '-'}</span>
                                {Boolean(guest.email) && <span>{String(guest.email)}</span>}
                                {Boolean(guest.phone) && <span>{String(guest.phone)}</span>}
                                {Boolean(guest.remarks) && <span>{String(guest.remarks)}</span>}
                              </div>
                            ))}
                            {room.remarks != null && String(room.remarks) && <p className="mt-1 text-sm text-muted-foreground">{String(room.remarks)}</p>}
                            {roomPolicy?.refundableTag && <p className="mt-1 text-xs text-muted-foreground">Rate: {roomPolicy.refundableTag === 'RFN' ? 'Refundable' : 'Non-refundable'}</p>}
                          </div>
                        );
                      })}
                    </section>
                  ) : null}

                  {(selectedBooking.mandatoryFees || selectedBooking.optionalFees || selectedBooking.specialRemarks || selectedBooking.knowBeforeYouGo || selectedBooking.addons?.length || selectedBooking.customTags || selectedBooking.goodwillPayment) ? (
                    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                      <h3 className="text-base font-semibold">Additional details</h3>
                      {selectedBooking.mandatoryFees && <p className="text-sm"><span className="font-medium">Mandatory fees: </span>{selectedBooking.mandatoryFees}</p>}
                      {selectedBooking.optionalFees && <p className="text-sm"><span className="font-medium">Optional fees: </span>{selectedBooking.optionalFees}</p>}
                      {selectedBooking.specialRemarks && <p className="text-sm"><span className="font-medium">Special remarks: </span>{selectedBooking.specialRemarks}</p>}
                      {selectedBooking.knowBeforeYouGo && <p className="text-sm"><span className="font-medium">Know before you go: </span>{selectedBooking.knowBeforeYouGo}</p>}
                      {selectedBooking.addons?.map((addon, index) => <p key={index} className="text-sm">{displayValue(addon.addon)} · {displayValue(addon.value)} {displayValue(addon.currency)}</p>)}
                      {selectedBooking.goodwillPayment && <p className="text-sm"><span className="font-medium">Goodwill payment: </span>{fmtMoney(selectedBooking.goodwillPayment.amount, selectedBooking.goodwillPayment.currency)}{selectedBooking.goodwillPayment.description ? ` · ${selectedBooking.goodwillPayment.description}` : ''}</p>}
                      {selectedBooking.customTags && Object.entries(selectedBooking.customTags).map(([key, value]) => <p key={key} className="text-sm"><span className="font-medium">{key}: </span>{value}</p>)}
                    </section>
                  ) : null}

                </div>
              ) : (
                <div className="space-y-4">
                  {loadingHotelProfile ? (
                    <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading hotel profile...</div>
                  ) : hotelProfileError ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                      <span>{hotelProfileError}</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => { setHotelProfile(null); void openHotelProfile(); }}>Retry</Button>
                    </div>
                  ) : !selectedBooking.hotelId ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Hotel profile is unavailable because this booking has no provider hotel ID.</p>
                  ) : hotelProfile ? (
                    <>
                      {hotelProfile.images?.length ? (
                        <div className="aspect-[16/7] max-h-[320px] overflow-hidden rounded-md bg-muted">
                          <img
                            src={selectedBooking.hotelImage || hotelProfile.images[0]}
                            alt={hotelProfile.name || selectedBooking.hotelName || 'Hotel'}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ) : null}

                      <section className="grid gap-5 rounded-md border border-border bg-card p-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(280px,1fr)]">
                        <div className="space-y-2">
                          <h3 className="text-xl font-semibold">{hotelProfile.name || selectedBooking.hotelName}</h3>
                          <div className="flex flex-wrap items-center gap-3">
                            {hotelProfile.starRating ? <StarRating rating={hotelProfile.starRating} /> : null}
                            {hotelProfile.rating != null && <span className="text-sm text-muted-foreground">{hotelProfile.rating} ({hotelProfile.reviewCount?.toLocaleString() || 0} reviews)</span>}
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">Hotel ID: {hotelProfile.hotelId || selectedBooking.hotelId}</p>
                          {(hotelProfile.address || hotelProfile.city || hotelProfile.country) && (
                            <p className="flex items-start gap-2 text-sm text-muted-foreground">
                              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>{[hotelProfile.address, hotelProfile.city, hotelProfile.country, hotelProfile.postalCode].filter(Boolean).join(', ')}</span>
                            </p>
                          )}
                          {hotelProfile.phone && <p className="text-sm text-muted-foreground">Phone: {hotelProfile.phone}</p>}
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-md bg-muted/40 p-3">
                            <p className="text-xs text-muted-foreground">Check-in</p>
                            <p className="mt-1 text-sm font-semibold">{fmtDate(selectedBooking.checkin)}</p>
                            <p className="text-xs text-muted-foreground">{hotelProfile.checkinTime || 'Time unavailable'}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-3">
                            <p className="text-xs text-muted-foreground">Check-out</p>
                            <p className="mt-1 text-sm font-semibold">{fmtDate(selectedBooking.checkout)}</p>
                            <p className="text-xs text-muted-foreground">{hotelProfile.checkoutTime || 'Time unavailable'}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 p-3">
                            <p className="text-xs text-muted-foreground">Stay</p>
                            <p className="mt-1 text-sm font-semibold">{stayNights(selectedBooking.checkin, selectedBooking.checkout) ?? '-'} night(s)</p>
                            <p className="text-xs text-muted-foreground">{selectedBooking.bookedRooms?.length || 1} room · {selectedBooking.adults ?? selectedBooking.guestInfo?.length ?? 1} guest(s)</p>
                          </div>
                        </div>
                      </section>

                      {hotelProfile.description && (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-3 text-base font-semibold">Description</h3>
                          <div className="hotel-description text-sm leading-6 text-muted-foreground">{renderHotelDescription(hotelProfile.description)}</div>
                        </section>
                      )}

                      {hotelProfile.importantInformation && (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-3 text-base font-semibold">Important Information</h3>
                          <div className="hotel-description text-sm leading-6 text-muted-foreground">{renderHotelDescription(hotelProfile.importantInformation)}</div>
                        </section>
                      )}

                      {Boolean(hotelProfile.specialInstructions || hotelProfile.checkinInstructions?.length) && (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-2 text-base font-semibold">Check-in instructions</h3>
                          {hotelProfile.specialInstructions && <p className="whitespace-pre-line text-sm text-muted-foreground">{hotelProfile.specialInstructions}</p>}
                          {hotelProfile.checkinInstructions?.length ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                              {hotelProfile.checkinInstructions.map((item, index) => <li key={index}>{item.instruction}</li>)}
                            </ul>
                          ) : null}
                        </section>
                      )}

                      {hotelProfile.amenities?.length ? (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-3 text-base font-semibold">Facilities</h3>
                          <ul className="grid gap-x-8 gap-y-2 pl-5 text-sm text-muted-foreground sm:grid-cols-2">
                            {hotelProfile.amenities.map((amenity, index) => {
                              const name = typeof amenity === 'string' ? amenity : amenity.name || 'Facility';
                              return <li key={`${name}-${index}`}>{name}</li>;
                            })}
                          </ul>
                        </section>
                      ) : null}

                      {hotelProfile.policies?.length ? (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-2 text-base font-semibold">Hotel policies</h3>
                          <div className="divide-y divide-border">
                            {hotelProfile.policies.map((policy, index) => (
                              <div key={`${policy.name || 'policy'}-${index}`} className="py-2 first:pt-0 last:pb-0">
                                <p className="text-sm font-medium">{policy.name || 'Policy'}</p>
                                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{policy.description}</p>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}

                      {hotelProfile.images?.length ? (
                        <section className="rounded-md border border-border bg-card p-4">
                          <h3 className="mb-3 text-base font-semibold">Gallery</h3>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
                            {(showAllHotelImages ? hotelProfile.images : hotelProfile.images.slice(0, 4)).map((image, index) => (
                              <img
                                key={`${image}-${index}`}
                                src={image}
                                alt={`${hotelProfile.name || selectedBooking.hotelName || 'Hotel'} image ${index + 1}`}
                                loading="lazy"
                                className="aspect-[4/3] w-full rounded-md object-cover"
                              />
                            ))}
                          </div>
                          {hotelProfile.images.length > 4 && (
                            <Button type="button" variant="ghost" size="sm" className="mt-2 px-0 text-muted-foreground" onClick={() => setShowAllHotelImages((show) => !show)}>
                              {showAllHotelImages ? 'Show fewer images' : `+${hotelProfile.images.length - 4} more images`}
                            </Button>
                          )}
                        </section>
                      ) : null}

                      <section className="rounded-md border border-border bg-card p-4">
                        <h3 className="mb-3 text-base font-semibold">Additional Information</h3>
                        <dl className="grid gap-4 text-sm sm:grid-cols-2">
                          <div><dt className="text-muted-foreground">Type</dt><dd className="mt-1 font-medium">{hotelProfile.hotelType || 'Not provided'}</dd></div>
                          <div><dt className="text-muted-foreground">Chain</dt><dd className="mt-1 font-medium">{hotelProfile.chain || 'Not provided'}</dd></div>
                          {hotelProfile.securityDeposit && <div><dt className="text-muted-foreground">Security deposit</dt><dd className="mt-1 font-medium">{fmtMoney(hotelProfile.securityDeposit.amount, hotelProfile.securityDeposit.currency)}{hotelProfile.securityDeposit.basis ? ` · ${hotelProfile.securityDeposit.basis.replace(/_/g, ' ')}` : ''}</dd></div>}
                        </dl>
                      </section>
                    </>
                  ) : <p className="py-8 text-center text-sm text-muted-foreground">Hotel profile details were not returned by LiteAPI.</p>}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => !loadingDetails && setSelectedBooking(null)} disabled={loadingDetails}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancellationBooking !== null} onOpenChange={(open) => !open && closeCancellation()}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cancel hotel booking</DialogTitle>
            <DialogDescription>
              {cancellationBooking?.hotelName || 'Review cancellation eligibility before confirming.'}
              {cancellationBooking?.pnrCode ? ` · ${cancellationBooking.pnrCode}` : ''}
            </DialogDescription>
          </DialogHeader>

          {loadingCancellation ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Checking current hotel booking and cancellation eligibility...
            </div>
          ) : (
            <div className="space-y-4">
              {cancellationError && <p role="alert" className="text-sm text-destructive">{cancellationError}</p>}
              {cancellationBooking && (
                <>
                  <div className="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
                    <div><div className="text-xs text-muted-foreground">Check-in</div>{fmtDate(cancellationBooking.checkin)}</div>
                    <div><div className="text-xs text-muted-foreground">Check-out</div>{fmtDate(cancellationBooking.checkout)}</div>
                    <div><div className="text-xs text-muted-foreground">Stay total</div>{fmtMoney(cancellationBooking.totalAmount, cancellationBooking.currency)}</div>
                    <div><div className="text-xs text-muted-foreground">Status</div>{cancellationBooking.status || 'unknown'}</div>
                  </div>
                  {!cancellationBooking.canCancel ? (
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {cancellationBooking.cancellationUnavailableReason || 'The hotel provider currently reports this booking as not cancellable.'}
                    </p>
                  ) : (
                    <div className="space-y-2 border-l-2 border-warning pl-4">
                      <p className="text-sm font-medium">The provider will determine the final cancellation result.</p>
                      {cancellationBooking.cancellationPolicies?.cancelPolicyInfos?.length ? (
                        cancellationBooking.cancellationPolicies.cancelPolicyInfos.map((policy, index) => (
                          <p key={`${policy.cancelTime || 'policy'}-${index}`} className="text-sm text-muted-foreground">
                            {policy.cancelTime ? `Until ${fmtDate(policy.cancelTime)}: ` : ''}
                            {fmtCancellationCharge(policy.amount, policy.currency || cancellationBooking.currency, policy.type)}
                            {policy.amount != null && !policy.type?.toLowerCase().includes('percent') && !policy.type?.toLowerCase().includes('night') ? ' cancellation fee' : ''}
                          </p>
                        ))
                      ) : cancellationBooking.cancellationPolicies?.refundable === false || cancellationBooking.cancellationPolicies?.nonRefundable ? (
                        <p className="text-sm text-warning">This rate is non-refundable. Cancellation may result in no refund.</p>
                      ) : (
                        <p className="text-sm text-warning">No current fee or refund quote is available. Cancellation may incur charges; the provider confirms the final terms.</p>
                      )}
                    </div>
                  )}
                  <Textarea
                    placeholder="Cancellation reason (optional)"
                    value={cancellationReason}
                    onChange={(event) => setCancellationReason(event.target.value)}
                    rows={2}
                    disabled={confirmingCancellation || !cancellationBooking.canCancel}
                  />
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeCancellation} disabled={loadingCancellation || confirmingCancellation}>Keep booking</Button>
            {cancellationBooking?.canCancel && !loadingCancellation && (
              <Button variant="destructive" onClick={() => void cancelBooking()} disabled={confirmingCancellation || !!cancellationError}>
                {confirmingCancellation ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirm cancellation
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}

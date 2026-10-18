import { useState, useEffect, useRef } from 'react';
import {
  Search, MapPin, RefreshCw, Loader2, Star,
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp, ArrowLeft,
  Users, Info, CheckCircle2, Building2, Phone, Bed, Plus, CreditCard,
} from 'lucide-react';
import HotelService from '../../../services/hotel.service';
import { leadAPI } from '@/services/api';
import toast from '@/lib/toast';
import CountrySelect from '../../../components/CountrySelect';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Card } from '../../../components/ui/card';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { groupOffersByRoom } from '../utils/hotelRateOptions';
import HotelOccupancyFields, { type HotelRoomOccupancy } from './HotelOccupancyFields';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════
type HotelBookingStep = 'form' | 'results' | 'hotel' | 'guests' | 'review' | 'prebook' | 'confirmed';
const HOTEL_PAYMENT_SESSION_KEY = 'liteapi-hotel-payment-session';
const EMPTY_LEAD_CONTEXT = {};
const REVIEW_PAGE_SIZE = 5;

declare global {
  interface Window {
    LiteAPIPayment?: new (config: Record<string, unknown>) => { handlePayment: () => void; destroy?: () => void };
  }
}

interface HotelRate {
  offerId?: string;
  roomTypeId?: string;
  mappedRoomId?: string | number | null;
  totalAmount?: number;
  currency?: string;
  roomType?: string;
  boardType?: string;
  refundable?: boolean | null;
  occupancyNumber?: number;
  offerTotalAmount?: number;
  offerRates?: HotelRate[];
  maxOccupancy?: number | null;
  taxes?: Array<{ description: string; amount: number; currency: string; included: boolean | null }>;
  cancellationPolicies?: { cancelPolicyInfos?: Array<{ cancelTime?: string; amount?: number; currency?: string }> };
  paymentTypes?: string[];
  perks?: Array<{ name?: string; amount?: number; currency?: string; level?: string }>;
  remarks?: string;
}

interface HotelRoom {
  roomId?: string | number;
  name?: string;
  description?: string;
  size?: number | null;
  sizeUnit?: string | null;
  maxOccupancy?: number | null;
  bedTypes?: Array<{ bedType?: string; quantity?: number }>;
  amenities?: string[];
  images?: string[];
}

interface Hotel {
  hotelId?: string;
  name?: string;
  images?: string[];
  starRating?: number;
  rating?: number | null;
  address?: string;
  phone?: string;
  description?: string;
  importantInformation?: string;
  amenities?: Array<string | { name?: string }>;
  policies?: Array<string | { name?: string; description?: string }>;
  checkinTime?: string;
  checkoutTime?: string;
  reviewCount?: number;
  rooms?: HotelRoom[];
  rates?: HotelRate[];
  cheapestRate?: HotelRate;
}

interface Guest {
  occupancyNumber: number;
  firstName: string;
  lastName: string;
  title: string;
}

interface LeadGuestPrefill {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface HotelReview {
  reviewId: number;
  averageScore: number;
  country?: string;
  type?: string;
  name?: string;
  date?: string;
  headline?: string;
  pros?: string;
  cons?: string;
  source?: string;
}

interface HotelCountry {
  code: string;
  name: string;
}

interface EsimPackage {
  packageId: number;
  name: string;
  dataSizeMb: number;
  validityDays: number;
  price: number;
  currency: string;
}

interface HotelSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'suggest' | 'search';

  // Suggest mode
  onSelectHotel?: (hotel: Hotel) => void;
  destination?: string;
  packageType?: string;
  category?: string;
  locations?: string[];

  // Search/booking mode
  onBookHotel?: (booking: any) => void;
  initialHotel?: Hotel;
  initialCheckin?: string;
  initialCheckout?: string;
  travelers?: number;
  children?: number;
  childAges?: number[];
  initialOccupancies?: HotelRoomOccupancy[];
  country?: string;
  currency?: string;
  leadContext?: Record<string, any>;
}

const todayStr = () => new Date().toISOString().split('T')[0];
const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };

function fmtDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(amount?: number, currency?: string) {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
}

function getNightCount(checkin: string, checkout: string) {
  const start = Date.parse(`${checkin}T00:00:00Z`);
  const end = Date.parse(`${checkout}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.round((end - start) / 86400000)
    : 1;
}

function buildHotelAddons(
  uberVoucherAmount: number | null,
  selectedEsimPackage: EsimPackage | undefined,
  countryCode: string,
  checkin: string,
  checkout: string,
) {
  return [
    ...(uberVoucherAmount ? [{ addon: 'uber' as const, value: uberVoucherAmount, currency: 'USD' as const }] : []),
    ...(selectedEsimPackage ? [{
      addon: 'esimply' as const,
      value: selectedEsimPackage.price,
      currency: 'USD' as const,
      addonDetails: {
        package_id: selectedEsimPackage.packageId,
        destination_code: countryCode,
        start_date: checkin,
        end_date: checkout,
      },
    }] : []),
  ];
}

function cleanProviderDescription(description?: string) {
  if (!description?.trim()) return '';
  if (typeof DOMParser === 'undefined') return description.trim();

  let parsed = new DOMParser().parseFromString(description, 'text/html');
  const escapedMarkup = parsed.body.textContent || '';
  if (!parsed.body.querySelector('br, div, li, ol, p, ul, h1, h2, h3, h4, h5, h6') && /<\/?(?:br|div|li|ol|p|ul|h[1-6])\b[^>]*>/i.test(escapedMarkup)) {
    parsed = new DOMParser().parseFromString(escapedMarkup, 'text/html');
  }

  const blockTags = new Set(['BR', 'DIV', 'LI', 'OL', 'P', 'UL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const extractText = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';

    const element = node as Element;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED'].includes(element.tagName)) return '';
    const text = Array.from(element.childNodes).map(extractText).join('');
    if (element.tagName === 'BR') return '\n';
    if (element.tagName === 'LI') return `- ${text.trim()}\n`;
    return blockTags.has(element.tagName) ? `${text}\n` : text;
  };

  return extractText(parsed.body)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function groupRatesByOffer(rates: HotelRate[] = []) {
  const groups = new Map<string, HotelRate[]>();
  rates.forEach((rate, index) => {
    const key = rate.offerId || `rate-${index}`;
    groups.set(key, [...(groups.get(key) || []), rate]);
  });
  return Array.from(groups, ([offerId, offerRates]) => ({
    ...offerRates[0],
    offerId,
    offerRates,
    totalAmount: offerRates[0].offerTotalAmount
      ?? offerRates.reduce((total, rate) => total + (rate.totalAmount || 0), 0),
    roomType: offerRates.length > 1 ? `${offerRates.length} rooms` : offerRates[0].roomType,
    boardType: offerRates.length > 1 ? 'Multiple room rates' : offerRates[0].boardType,
    refundable: offerRates.every((rate) => rate.refundable === true)
      ? true
      : offerRates.some((rate) => rate.refundable === false) ? false : null,
  }));
}

function RoomImageGallery({ room }: { room?: HotelRoom }) {
  const [imageIndex, setImageIndex] = useState(0);
  const images = room?.images || [];

  if (!images.length) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Building2 className="h-9 w-9" />
      </div>
    );
  }

  return (
    <div className="group relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
      <img src={images[imageIndex]} alt={`${room?.name || 'Room'} photo ${imageIndex + 1}`} className="h-full w-full object-cover" />
      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous room photo"
            onClick={() => setImageIndex((index) => (index - 1 + images.length) % images.length)}
            className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next room photo"
            onClick={() => setImageIndex((index) => (index + 1) % images.length)}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground shadow opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute bottom-2 right-2 rounded bg-black/65 px-2 py-1 text-xs text-white">
            {imageIndex + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}

function StarRating({ rating, showEmpty = true }: { rating?: number; showEmpty?: boolean }) {
  const hasRating = rating != null && rating > 0;
  if (!hasRating && !showEmpty) return null;
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${hasRating && i < Math.round(rating!) ? 'fill-warning text-warning' : 'text-muted'}`}
        />
      ))}
      {!hasRating && (
        <span className="text-xs text-muted-foreground ml-1">—</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Hotel Card with expandable details
// ═══════════════════════════════════════════════════════════════════
function HotelCard({ hotel, isBest, rank, onSelect, mode }: { hotel: Hotel; isBest: boolean; rank: number; onSelect: (hotel: Hotel) => void; mode: 'suggest' | 'search' }) {
  const [expanded, setExpanded] = useState(false);
  const rate = hotel.cheapestRate || {};

  return (
    <Card className={`overflow-hidden ${isBest ? 'ring-success/40 bg-success/5' : 'hover:ring-primary/30'}`}>
      {/* Main row — always visible */}
      <div className="px-4 flex items-start gap-4">
        {/* Image */}
        <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted shrink-0">
          {hotel.images?.[0] ? (
            <img src={hotel.images[0]} alt={hotel.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Building2 className="w-8 h-8" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
              {isBest ? '★' : rank}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-semibold text-foreground truncate">{hotel.name}</h4>
                {isBest && (
                  <Badge className="bg-success text-success-foreground border-transparent">Best Match</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <StarRating rating={hotel.starRating} />
                {hotel.starRating != null && hotel.starRating > 0 && (
                  <span className="text-xs text-muted-foreground">{hotel.starRating}-star</span>
                )}
              </div>
              {hotel.address && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> {hotel.address}
                </p>
              )}
            </div>
          </div>

          {/* Expand toggle */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
          >
            {expanded ? (
              <><ChevronUp className="w-3.5 h-3.5" /> Hide details</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" /> View details</>
            )}
          </button>
        </div>

        {/* Price + CTA */}
        <div className="text-right shrink-0">
          {rate.totalAmount != null ? (
            <>
              <div className="text-lg font-bold text-foreground font-mono tabular-nums">{fmtMoney(rate.totalAmount, rate.currency)}</div>
              <div className="text-xs text-muted-foreground">for stay</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">Price on request</div>
          )}
          <Button
            className="mt-2"
            variant={isBest ? 'default' : 'default'}
            onClick={(e) => { e.stopPropagation(); onSelect(hotel); }}
          >
            View details
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 mt-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {hotel.address && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>{hotel.address}</span>
              </div>
            )}
            {hotel.phone && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Phone className="w-3.5 h-3.5 shrink-0" />
                <span>{hotel.phone}</span>
              </div>
            )}
            {rate.roomType && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Bed className="w-3.5 h-3.5 shrink-0" />
                <span>Room: {rate.roomType}</span>
              </div>
            )}
            {rate.boardType && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Board: {rate.boardType}</span>
              </div>
            )}
            {rate.refundable === true && (
              <div className="flex items-center gap-1.5 text-success">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Refundable</span>
              </div>
            )}
            {rate.refundable === false && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Non-refundable</span>
              </div>
            )}
            {hotel.rating != null && hotel.rating > 0 && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Star className="w-3.5 h-3.5 text-warning shrink-0" />
                <span>Guest score: {parseFloat(String(hotel.rating)).toFixed(1)} / 10</span>
              </div>
            )}
          </div>
          {hotel.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{hotel.description}</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════
export default function HotelSelectionModal({
  isOpen,
  onClose,
  mode = 'suggest',

  // Suggest mode
  onSelectHotel,
  destination = '',
  onBookHotel,
  initialHotel,
  initialCheckin,
  initialCheckout,
  travelers: initialTravelers = 1,
  children: initialChildren = 0,
  childAges: initialChildAges = [],
  initialOccupancies,
  country: initialCountry = '',
  currency: initialCurrency = 'USD',
  leadContext = EMPTY_LEAD_CONTEXT,
}: HotelSelectionModalProps) {
  const isSuggestMode = mode === 'suggest';

  // ── Search form ─────────────────────────────────────────────────
  const [searchForm, setSearchForm] = useState({
    city: '',
    country: initialCountry,
    checkin: initialCheckin || todayStr(),
    checkout: initialCheckout || tomorrowStr(),
    occupancies: initialOccupancies?.map((room) => ({ ...room })) || [{
      adults: typeof initialTravelers === 'number' ? initialTravelers : 1,
      childAges: initialChildAges.length
        ? initialChildAges
        : Array.from({ length: initialChildren }, () => null),
    }],
    currency: initialCurrency,
  });
  const [cities, setCities] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [citiesError, setCitiesError] = useState(false);
  const [countries, setCountries] = useState<HotelCountry[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [countriesError, setCountriesError] = useState(false);
  const [searchResults, setSearchResults] = useState<Hotel[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [bestMatch] = useState<Hotel | null>(null);

  // ── Booking flow (search mode only) ─────────────────────────────
  const [bookingStep, setBookingStep] = useState<HotelBookingStep>(initialHotel ? 'hotel' : 'form');
  const [selectedOffer, setSelectedOffer] = useState<Hotel | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [holder, setHolder] = useState({ firstName: '', lastName: '' });
  const [leadGuestPrefill, setLeadGuestPrefill] = useState<LeadGuestPrefill | null>(null);
  const leadId = String(leadContext?.leadId || '');
  const [bookingFor, setBookingFor] = useState<'self' | 'someone-else'>('self');
  const [travelingForWork, setTravelingForWork] = useState(false);
  const [specialRequests, setSpecialRequests] = useState('');
  const [uberVoucherAmount, setUberVoucherAmount] = useState<number | null>(null);
  const [esimPackages, setEsimPackages] = useState<EsimPackage[]>([]);
  const [selectedEsimPackageId, setSelectedEsimPackageId] = useState<number | null>(null);
  const [esimPackagesLoading, setEsimPackagesLoading] = useState(false);
  const [esimPackagesError, setEsimPackagesError] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoFeedback, setPromoFeedback] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [hotelDetailsLoading, setHotelDetailsLoading] = useState(Boolean(initialHotel));
  const [hotelDetailsError, setHotelDetailsError] = useState<string | null>(null);
  const [selectedRate, setSelectedRate] = useState<HotelRate | null>(null);
  const [prebookResult, setPrebookResult] = useState<any>(null);
  const [clientReference, setClientReference] = useState<string | null>(null);
  const [paymentSdkLoading, setPaymentSdkLoading] = useState(false);
  const [paymentSdkError, setPaymentSdkError] = useState<string | null>(null);
  const [paymentSdkReady, setPaymentSdkReady] = useState(false);
  const [paymentSdkStarted, setPaymentSdkStarted] = useState(false);
  const paymentElementRef = useRef<HTMLDivElement>(null);
  const paymentSdkRef = useRef<{ handlePayment: () => void; destroy?: () => void } | null>(null);
  const [reviews, setReviews] = useState<HotelReview[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState(false);
  const [facilitiesExpanded, setFacilitiesExpanded] = useState(false);
  const initialHotelRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !leadId) {
      setLeadGuestPrefill(null);
      return;
    }

    let active = true;
    leadAPI.getLead(leadId)
      .then((response: any) => {
        const lead = response?.data?.data ?? response?.data ?? response;
        const name = String(lead?.name || '').trim();
        const [firstName = '', ...lastNameParts] = name.split(/\s+/).filter(Boolean);
        if (active) {
          setLeadGuestPrefill({
            name,
            firstName,
            lastName: lastNameParts.join(' '),
            email: String(lead?.email || ''),
            phone: String(lead?.phone || ''),
          });
        }
      })
      .catch(() => {
        if (active) setLeadGuestPrefill(null);
      });

    return () => { active = false; };
  }, [isOpen, leadId]);

  useEffect(() => {
    if (bookingStep !== 'guests' || !leadGuestPrefill) return;
    setGuests((current) => current.map((guest, index) => (
      index === 0 && !guest.firstName && !guest.lastName
        ? { ...guest, firstName: leadGuestPrefill.firstName, lastName: leadGuestPrefill.lastName }
        : guest
    )));
    setContact((current) => ({
      name: current.name || leadGuestPrefill.name,
      email: current.email || leadGuestPrefill.email,
      phone: current.phone || leadGuestPrefill.phone,
    }));
    setHolder((current) => ({
      firstName: current.firstName || leadGuestPrefill.firstName,
      lastName: current.lastName || leadGuestPrefill.lastName,
    }));
  }, [bookingStep, leadGuestPrefill]);

  useEffect(() => {
    let active = true;
    HotelService.getCountries()
      .then((response) => { if (active) setCountries(response.data || []); })
      .catch(() => { if (active) setCountriesError(true); })
      .finally(() => { if (active) setCountriesLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!searchForm.country) {
      setCities([]);
      setCitiesError(false);
      return;
    }
    let active = true;
    setCities([]);
    setCitiesLoading(true);
    setCitiesError(false);
    HotelService.getCities(searchForm.country)
      .then((response) => { if (active) setCities(response.data || []); })
      .catch(() => { if (active) setCitiesError(true); })
      .finally(() => { if (active) setCitiesLoading(false); });
    return () => { active = false; };
  }, [searchForm.country]);

  useEffect(() => {
    if (bookingStep !== 'guests' || !searchForm.country || searchForm.currency !== 'USD') {
      setEsimPackages([]);
      setEsimPackagesError(false);
      setSelectedEsimPackageId(null);
      return;
    }

    let active = true;
    setEsimPackagesLoading(true);
    setEsimPackagesError(false);
    HotelService.getEsimPackages(searchForm.country)
      .then((response) => { if (active) setEsimPackages(response.data || []); })
      .catch(() => { if (active) setEsimPackagesError(true); })
      .finally(() => { if (active) setEsimPackagesLoading(false); });
    return () => { active = false; };
  }, [bookingStep, searchForm.country, searchForm.currency]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setSearchResults([]);
      setHasSearched(false);
      setSearchError(null);
      setBookingStep('form');
      setSelectedOffer(null);
      setSelectedRate(null);
      setPrebookResult(null);
      setClientReference(null);
      setBookingFor('self');
      setSpecialRequests('');
      setUberVoucherAmount(null);
      setSelectedEsimPackageId(null);
      setPromoCode('');
      setPromoApplied(false);
      setPromoFeedback(null);
      setPaymentSdkReady(false);
      setPaymentSdkStarted(false);
      setReviews([]);
      setReviewTotal(0);
      setReviewOffset(0);
      setReviewsError(false);
      setConfirmedBooking(null);
      setHotelDetailsError(null);
      // Pre-fill city from destination
      if (destination) {
        setSearchForm(prev => ({
          ...prev,
          city: typeof destination === 'string' ? destination : '',
          checkin: initialCheckin || todayStr(),
          checkout: initialCheckout || tomorrowStr(),
          occupancies: initialOccupancies?.map((room) => ({ ...room })) || [{
            adults: typeof initialTravelers === 'number' ? initialTravelers : 1,
            childAges: initialChildAges.length
              ? initialChildAges
              : Array.from({ length: initialChildren }, () => null),
          }],
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const performSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!(searchForm.city || destination).trim()) {
      toast.error('Please enter a city or destination');
      return;
    }
    if (!searchForm.country) {
      toast.error('Select the destination country');
      return;
    }
    const requestedCity = (searchForm.city || destination).trim().toLocaleLowerCase();
    const selectedCity = cities.find((city) => city.toLocaleLowerCase() === requestedCity);
    if (!selectedCity) {
      toast.error('Select a city from LiteAPI locations for this country');
      return;
    }
    if (!searchForm.checkin || !searchForm.checkout || searchForm.checkout <= searchForm.checkin) {
      toast.error('Check-out must be after check-in');
      return;
    }
    if (searchForm.occupancies.some((room) => room.childAges.some((age) => age == null))) {
      toast.error('Enter the age of every child');
      return;
    }

    setSearching(true);
    setHasSearched(true);
    setSearchResults([]);
    setSearchError(null);
    setBookingStep('results');

    try {
      // Both modes use the real hotel search API for concrete results
      const searchCity = selectedCity;
      const response = await HotelService.search({
        city: searchCity || undefined,
        country: searchForm.country,
        checkin: searchForm.checkin,
        checkout: searchForm.checkout,
        occupancies: searchForm.occupancies.map((room) => ({
          adults: room.adults,
          children: room.childAges as number[],
        })),
        currency: searchForm.currency,
        guestNationality: searchForm.country,
        limit: 5000,
      });
      const data = response.data || [];
      setSearchResults(data);
      if (!data.length) toast('No hotels found', { type: 'info' });
    } catch (error: any) {
      setSearchError(apiErrorMessage(error));
      toast.error(apiErrorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (hotel: Hotel) => {
    setSelectedOffer(hotel);
    setSelectedRate(null);
    setReviews([]);
    setReviewTotal(0);
    setReviewOffset(0);
    setReviewsError(false);
    setHotelDetailsError(null);
    setHotelDetailsLoading(true);
    setBookingStep('hotel');

    const rateRequest = hotel.hotelId
      ? HotelService.search({
          hotelIds: [hotel.hotelId],
          checkin: searchForm.checkin,
          checkout: searchForm.checkout,
          occupancies: searchForm.occupancies.map((room) => ({
            adults: room.adults,
            children: room.childAges as number[],
          })),
          currency: searchForm.currency,
          guestNationality: searchForm.country,
          limit: 1,
          maxRatesPerHotel: 500,
        })
      : Promise.reject(new Error('This hotel has no provider ID for live room rates.'));

    const [detailsResult, ratesResult, reviewsResult] = await Promise.allSettled([
      hotel.hotelId ? HotelService.getDetails(hotel.hotelId) : Promise.resolve(null),
      rateRequest,
      hotel.hotelId ? HotelService.getReviews({ hotelId: hotel.hotelId, limit: 1, offset: 0 }) : Promise.resolve(null),
    ]);
    const details = detailsResult.status === 'fulfilled' ? detailsResult.value?.data : null;
    const rates = ratesResult.status === 'fulfilled'
      ? ratesResult.value?.data?.find((item: Hotel) => item.hotelId === hotel.hotelId)?.rates || []
      : [];
    setSelectedOffer({ ...hotel, ...(details || {}), rates });
    const reviewData = reviewsResult.status === 'fulfilled' ? reviewsResult.value?.data : null;
    setReviews(reviewData?.reviews || []);
    setReviewTotal(reviewData?.total || 0);
    setReviewOffset(reviewData?.reviews?.length || 0);
    setReviewsError(reviewsResult.status === 'rejected');

    if (detailsResult.status === 'rejected' || ratesResult.status === 'rejected') {
      setHotelDetailsError('Some hotel information or live room rates could not be loaded. Retry the search to refresh provider availability.');
    }
    setHotelDetailsLoading(false);
  };

  useEffect(() => {
    if (!isOpen || !initialHotel) return;
    const hotelKey = initialHotel.hotelId || initialHotel.name || 'unknown';
    if (initialHotelRequestRef.current === hotelKey) return;
    initialHotelRequestRef.current = hotelKey;
    void handleSelect(initialHotel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialHotel]);

  const handleSelectRate = (rate: HotelRate) => {
    if (!selectedOffer) return;
    setSelectedRate(rate);
    if (isSuggestMode) {
      onSelectHotel?.({ ...selectedOffer, cheapestRate: rate });
      onClose();
      return;
    }
    setGuests(searchForm.occupancies.map((_, index) => ({
      occupancyNumber: index + 1,
      firstName: index === 0 ? leadGuestPrefill?.firstName || '' : '',
      lastName: index === 0 ? leadGuestPrefill?.lastName || '' : '',
      title: 'Mr',
    })));
    setContact(leadGuestPrefill
      ? { name: leadGuestPrefill.name, email: leadGuestPrefill.email, phone: leadGuestPrefill.phone }
      : { name: '', email: '', phone: '' });
    setHolder(leadGuestPrefill
      ? { firstName: leadGuestPrefill.firstName, lastName: leadGuestPrefill.lastName }
      : { firstName: '', lastName: '' });
    setBookingFor('self');
    setSpecialRequests('');
    setUberVoucherAmount(null);
    setSelectedEsimPackageId(null);
    setPromoCode('');
    setPromoApplied(false);
    setPromoFeedback(null);
    setPrebookResult(null);
    setClientReference(null);
    setBookingStep('guests');
  };

  const selectedEsimPackage = esimPackages.find((item) => item.packageId === selectedEsimPackageId);
  const selectedAddons = buildHotelAddons(
    uberVoucherAmount,
    selectedEsimPackage,
    searchForm.country,
    searchForm.checkin,
    searchForm.checkout,
  );

  const applyPromoCode = async () => {
    const normalizedCode = promoCode.trim();
    if (!normalizedCode || !selectedRate?.offerId || promoLoading) return;
    setPromoLoading(true);
    setPromoFeedback(null);
    try {
      const response = await HotelService.prebook({
        offerId: selectedRate.offerId,
        voucherCode: normalizedCode,
        ...(selectedAddons.length ? { addons: selectedAddons } : {}),
        usePaymentSdk: false,
      });
      setPromoApplied(true);
      setPromoFeedback(response.data?.voucherTotalAmount
        ? `Promo applied: ${fmtMoney(Number(response.data.voucherTotalAmount), response.data.currency || 'USD')} off.`
        : 'Promo accepted. LiteAPI will confirm the final amount before payment.');
    } catch (error) {
      setPromoApplied(false);
      setPromoFeedback(apiErrorMessage(error));
    } finally {
      setPromoLoading(false);
    }
  };

  const loadMoreReviews = async () => {
    if (!selectedOffer?.hotelId || reviewsLoading) return;
    setReviewsLoading(true);
    try {
      const response = await HotelService.getReviews({ hotelId: selectedOffer.hotelId, limit: REVIEW_PAGE_SIZE, offset: reviewOffset });
      const page = response.data?.reviews || [];
      setReviews((current) => [...current, ...page]);
      setReviewOffset((offset) => offset + page.length);
      setReviewTotal(response.data?.total || 0);
      setReviewsError(false);
    } catch {
      setReviewsError(true);
    } finally {
      setReviewsLoading(false);
    }
  };

  const validateSelectedRate = async () => {
    setBooking(true);
    try {
      const offerId = selectedRate?.offerId;
      if (!offerId || !selectedOffer) throw new Error('Choose an available room rate before continuing.');
      const pre = await HotelService.prebook({
        offerId,
        ...(promoApplied && promoCode.trim() ? { voucherCode: promoCode.trim() } : {}),
        ...(selectedAddons.length ? { addons: selectedAddons } : {}),
        usePaymentSdk: true,
      });
      if (!pre.data?.prebookId) throw new Error('The selected rate could not be confirmed. Search again for current availability.');
      setPrebookResult(pre.data);
      setClientReference(crypto.randomUUID());
      setPaymentSdkError(null);
      setPaymentSdkReady(false);
      setPaymentSdkStarted(false);
      setBookingStep('prebook');
    } catch (err: any) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBooking(false);
    }
  };

  useEffect(() => {
    if (bookingStep !== 'prebook' || !prebookResult || !selectedOffer || !selectedRate || !clientReference) return;

    let active = true;
    paymentSdkRef.current = null;
    setPaymentSdkLoading(true);
    setPaymentSdkError(null);
    setPaymentSdkReady(false);

    const loadPaymentSdk = () => new Promise<void>((resolve, reject) => {
      if (window.LiteAPIPayment) {
        resolve();
        return;
      }
      let script = document.querySelector<HTMLScriptElement>('script[data-liteapi-payment]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://payment-wrapper.liteapi.travel/dist/liteAPIPayment.js?v=a1';
        script.async = true;
        script.dataset.liteapiPayment = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('LiteAPI payment checkout could not be loaded.')), { once: true });
    });

    const startPayment = async () => {
      try {
        await loadPaymentSdk();
        if (!active) return;
        if (!window.LiteAPIPayment || !prebookResult.secretKey || !prebookResult.transactionId) {
          throw new Error('LiteAPI did not return the payment session needed for checkout.');
        }
        if (!['sandbox', 'live'].includes(prebookResult.paymentEnvironment)) {
          throw new Error('LiteAPI payment environment is not configured correctly.');
        }

        const paymentPayload = {
          prebookId: prebookResult.prebookId,
          clientReference,
          guests: guests.map((guest) => ({
            ...guest,
            email: contact.email,
            phone: contact.phone,
            ...(specialRequests.trim() && { remarks: specialRequests.trim() }),
          })),
          contact,
          holder,
          offer: {
            hotelId: selectedOffer.hotelId,
            name: selectedOffer.name,
            address: selectedOffer.address,
            images: selectedOffer.images?.slice(0, 1),
            cheapestRate: selectedRate,
            checkin: prebookResult.checkin || searchForm.checkin,
            checkout: prebookResult.checkout || searchForm.checkout,
          },
          ...leadContext,
          payment: { method: 'TRANSACTION_ID', transactionId: prebookResult.transactionId },
        };
        sessionStorage.setItem(HOTEL_PAYMENT_SESSION_KEY, JSON.stringify({
          createdAt: Date.now(),
          returnPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          paymentPayload,
          prebookId: prebookResult.prebookId,
          transactionId: prebookResult.transactionId,
        }));

        const returnUrl = new URL('/hotel-payment', window.location.origin);
        returnUrl.searchParams.set('pid', prebookResult.prebookId);
        returnUrl.searchParams.set('tid', prebookResult.transactionId);
        paymentSdkRef.current = new window.LiteAPIPayment({
          publicKey: prebookResult.paymentEnvironment,
          appearance: { theme: 'flat' },
          options: { business: { name: 'Travel CRM' } },
          submitButton: { text: 'Pay securely' },
          targetElement: '#liteapi-payment-element',
          secretKey: prebookResult.secretKey,
          returnUrl: returnUrl.toString(),
        });
        setPaymentSdkReady(true);
      } catch (error) {
        if (active) setPaymentSdkError(apiErrorMessage(error));
      } finally {
        if (active) setPaymentSdkLoading(false);
      }
    };

    void startPayment();
    return () => {
      active = false;
      paymentSdkRef.current?.destroy?.();
      paymentSdkRef.current = null;
    };
  }, [bookingStep, prebookResult, selectedOffer, selectedRate, clientReference, guests, contact, holder, specialRequests, searchForm.checkin, searchForm.checkout, leadContext]);

  const startLiteApiPayment = () => {
    if (!paymentSdkRef.current || paymentSdkStarted) return;
    try {
      paymentSdkRef.current.handlePayment();
      setPaymentSdkStarted(true);
      setPaymentSdkError(null);
    } catch (error) {
      setPaymentSdkError(apiErrorMessage(error));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-none sm:max-w-7xl max-h-[92vh] overflow-y-auto flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {bookingStep === 'confirmed'
              ? 'Booking Confirmed'
              : bookingStep === 'guests' || bookingStep === 'review' || bookingStep === 'prebook'
                ? 'Complete Booking'
                : bookingStep === 'hotel'
                  ? 'Hotel Details & Rooms'
                : 'Search Hotels'}
          </DialogTitle>
          <DialogDescription>
            {isSuggestMode
              ? 'Select a hotel for this itinerary day'
              : bookingStep === 'confirmed'
                ? 'Hotel booked successfully'
                : 'Search and book hotels worldwide'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* ═══════ SEARCH FORM ═══════ */}
          {(bookingStep === 'form' || (isSuggestMode && bookingStep === 'results' && searchResults.length === 0 && !searching)) && (
            <form onSubmit={performSearch} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Destination country</label>
                  <CountrySelect
                    value={searchForm.country}
                    countries={countries}
                    disabled={countriesLoading || countriesError || countries.length === 0}
                    inputClassName="h-10 rounded-lg border border-input bg-background focus-visible:ring-2 focus-visible:ring-ring/50"
                    onChange={(code: string) => setSearchForm({ ...searchForm, country: code, city: '' })}
                    placeholder={countriesLoading ? 'Loading countries...' : countriesError ? 'Country list unavailable' : 'Select destination country...'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{isSuggestMode ? 'City / Destination' : 'City'}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      list={`hotel-cities-${searchForm.country}`}
                      value={searchForm.city}
                      onChange={(e) => setSearchForm({ ...searchForm, city: e.target.value })}
                      disabled={!searchForm.country || citiesLoading || cities.length === 0}
                      placeholder={citiesError ? 'City list unavailable' : citiesLoading ? 'Loading cities...' : 'Select or type a city...'}
                      className="h-10 pl-9"
                    />
                  </div>
                  <datalist id={`hotel-cities-${searchForm.country}`}>
                    {cities.map((city) => <option key={city} value={city} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Check-in</label>
                  <Input type="date" value={searchForm.checkin} min={todayStr()}
                    onChange={(e) => setSearchForm({ ...searchForm, checkin: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Check-out</label>
                  <Input type="date" value={searchForm.checkout} min={searchForm.checkin || todayStr()}
                    onChange={(e) => setSearchForm({ ...searchForm, checkout: e.target.value })} />
                </div>
              </div>
              <HotelOccupancyFields
                occupancies={searchForm.occupancies}
                onChange={(occupancies) => setSearchForm({ ...searchForm, occupancies })}
              />
              <Button type="submit" disabled={searching}>
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {searching ? 'Searching...' : isSuggestMode ? 'Find Hotels' : 'Search Hotels'}
              </Button>
            </form>
          )}

          {/* ═══════ RESULTS ═══════ */}
          {(bookingStep === 'results' && !isSuggestMode) || (isSuggestMode && bookingStep === 'results') ? (
            <>
              {searching && (
                <div className="text-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary mb-3" />
                  <p className="text-muted-foreground">{isSuggestMode ? 'Finding best hotels...' : 'Searching hotels...'}</p>
                </div>
              )}

              {searchError && !searching && (
                <div className="text-center py-8">
                  <p className="text-destructive mb-3">{searchError}</p>
                  <Button variant="ghost" size="sm" onClick={() => performSearch()}>Try again</Button>
                </div>
              )}

              {!searching && !searchError && searchResults.length === 0 && hasSearched && (
                <div className="text-center py-12">
                  <Building2 className="w-12 h-12 text-muted mx-auto mb-3" />
                  <p className="text-muted-foreground mb-3">No hotels found. Try a different city or dates.</p>
                </div>
              )}

              {!searching && !searchError && searchResults.length > 0 && (
                <>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-semibold text-foreground">{searchResults.length} hotel{searchResults.length !== 1 ? 's' : ''} found</h3>
                    <Button variant="outline" size="sm" disabled={searching} onClick={() => performSearch()}>
                      <RefreshCw className={`w-3.5 h-3.5 ${searching ? 'animate-spin' : ''}`} /> Search Again
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {searchResults.map((hotel, i) => (
                      <HotelCard
                        key={hotel.hotelId || hotel.name || i}
                        hotel={hotel}
                        isBest={Boolean(isSuggestMode && bestMatch && hotel.name === bestMatch.name)}
                        rank={i + 1}
                        onSelect={handleSelect}
                        mode={mode}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : null}

          {/* ═══════ HOTEL DETAILS AND LIVE ROOM RATES ═══════ */}
          {bookingStep === 'hotel' && selectedOffer && (
            <section className="space-y-5">
              <Button variant="ghost" size="sm" onClick={() => setBookingStep('results')}>
                <ArrowLeft className="w-4 h-4" /> Back to hotels
              </Button>
              {hotelDetailsLoading ? (
                <div className="py-12 text-center">
                  <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading hotel details and available room rates...</p>
                </div>
              ) : (
                <>
                  {hotelDetailsError && <p role="status" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">{hotelDetailsError}</p>}
                  <div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {(selectedOffer.images || []).slice(0, 4).map((image, index) => (
                        <div key={`${image}-${index}`} className={`h-32 overflow-hidden bg-muted ${index === 0 ? 'col-span-2 row-span-2 h-full min-h-44 md:min-h-64' : ''}`}>
                          <img src={image} alt={`${selectedOffer.name || 'Hotel'} ${index + 1}`} className="h-full w-full object-cover" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-semibold text-foreground">{selectedOffer.name}</h2>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <StarRating rating={selectedOffer.starRating} />
                          {selectedOffer.address && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{selectedOffer.address}</span>}
                          {selectedOffer.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selectedOffer.phone}</span>}
                        </div>
                        {selectedOffer.rating != null && <p className="mt-1 text-xs text-muted-foreground">Guest score {selectedOffer.rating}/10{selectedOffer.reviewCount ? ` · ${selectedOffer.reviewCount.toLocaleString()} reviews` : ''}</p>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {selectedOffer.checkinTime && <span>Check-in {selectedOffer.checkinTime}</span>}
                        {selectedOffer.checkoutTime && <span>Check-out {selectedOffer.checkoutTime}</span>}
                      </div>
                    </div>
                  </div>

                  {cleanProviderDescription(selectedOffer.description) && (
                    <div className="border-t border-border pt-4">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">About this hotel</h3>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{cleanProviderDescription(selectedOffer.description)}</p>
                    </div>
                  )}

                  {!!selectedOffer.amenities?.length && (
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <h3>Hotel facilities</h3>
                        <span className="text-xs font-normal text-muted-foreground">{selectedOffer.amenities.length}</span>
                      </div>
                      <div className="mt-2">
                        <div className="flex min-w-0 flex-nowrap gap-2 overflow-hidden">
                          {selectedOffer.amenities.slice(0, 3).map((amenity, index) => {
                            const name = typeof amenity === 'string' ? amenity : amenity.name;
                            return name ? <Badge key={`${name}-${index}`} variant="outline" className="max-w-40 truncate">{name}</Badge> : null;
                          })}
                        </div>
                        {selectedOffer.amenities.length > 3 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-expanded={facilitiesExpanded}
                            aria-controls="hotel-facilities-list"
                            className="mt-3"
                            onClick={() => setFacilitiesExpanded((expanded) => !expanded)}
                          >
                            <Plus className="h-4 w-4" />
                            {facilitiesExpanded ? 'Show fewer facilities' : 'Load more facilities'}
                          </Button>
                        )}
                      </div>
                      {facilitiesExpanded && (
                        <div id="hotel-facilities-list" className="mt-2 flex flex-wrap gap-2">
                          {selectedOffer.amenities.slice(3).map((amenity, index) => {
                            const name = typeof amenity === 'string' ? amenity : amenity.name;
                            return name ? <Badge key={`${name}-${index + 3}`} variant="outline">{name}</Badge> : null;
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {!!selectedOffer.importantInformation && (
                    <div className="rounded-md border border-border bg-muted/50 p-3">
                      <h3 className="mb-1 text-sm font-semibold text-foreground">Important information</h3>
                      <p className="whitespace-pre-line text-sm text-muted-foreground">{cleanProviderDescription(selectedOffer.importantInformation)}</p>
                    </div>
                  )}
                  {!!selectedOffer.policies?.length && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Policies</h3>
                      <div className="space-y-2">
                        {selectedOffer.policies.map((policy, index) => (
                          <p key={index} className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{typeof policy === 'string' ? policy : policy.name}</span>
                            {typeof policy !== 'string' && policy.description ? `: ${policy.description}` : ''}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <section className="border-t border-border pt-4">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-base font-semibold text-foreground">Guest reviews</h3>
                      <span className="text-xs text-muted-foreground">
                        {selectedOffer.rating != null ? `${selectedOffer.rating}/10` : 'No aggregate score'}
                        {reviewTotal ? ` · ${reviewTotal.toLocaleString()} reviews` : ''}
                      </span>
                    </div>
                    {reviewsError && <p role="status" className="text-sm text-muted-foreground">Reviews could not be loaded.</p>}
                    {!reviewsError && reviews.length === 0 && <p className="text-sm text-muted-foreground">No guest reviews are available for this hotel.</p>}
                    <div className="space-y-3">
                      {reviews.map((review) => (
                        <article key={review.reviewId} className="border-b border-border pb-3 last:border-0">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h4 className="text-sm font-medium text-foreground">{review.headline || 'Guest review'}</h4>
                            <span className="text-xs font-semibold text-foreground">{review.averageScore}/10</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {[review.name, review.type, review.date, review.source].filter(Boolean).join(' · ')}
                          </p>
                          {review.pros && <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">Pros:</span> {review.pros}</p>}
                          {review.cons && <p className="mt-1 text-sm text-muted-foreground"><span className="font-medium text-foreground">Cons:</span> {review.cons}</p>}
                        </article>
                      ))}
                    </div>
                    {reviewOffset < reviewTotal && (
                      <Button variant="outline" size="sm" className="mt-3" onClick={loadMoreReviews} disabled={reviewsLoading}>
                        {reviewsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Load more reviews
                      </Button>
                    )}
                  </section>

                  <div className="border-t border-border pt-4">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">Available rooms</h3>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(searchForm.checkin)} – {fmtDate(searchForm.checkout)} · {searchForm.occupancies.length} room{searchForm.occupancies.length !== 1 ? 's' : ''} · {searchForm.occupancies.reduce((total, room) => total + room.adults + room.childAges.length, 0)} guests · rates for your dates
                        </p>
                      </div>
                    </div>
                    {selectedOffer.rates?.length ? (
                      searchForm.occupancies.length === 1 ? (
                        <div className="space-y-4">
                          {groupOffersByRoom(selectedOffer.rates, selectedOffer.rooms).map((roomGroup, roomIndex) => {
                            const room = roomGroup.room;
                            const roomDescription = cleanProviderDescription(room?.description);
                            const nights = getNightCount(searchForm.checkin, searchForm.checkout);
                            return (
                              <Card key={`${room?.roomId || roomGroup.roomType || 'room'}-${roomIndex}`} className="overflow-hidden">
                                <div className="grid grid-cols-1 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,2.2fr)]">
                                  <aside className="space-y-3 border-b border-border p-4 lg:border-b-0 lg:border-r">
                                    <RoomImageGallery room={room} />
                                    <div>
                                      <h4 className="font-semibold text-foreground">{roomGroup.roomType || room?.name || 'Available room'} · {roomGroup.options.length} rates</h4>
                                      {room?.name && roomGroup.roomType !== room.name && <p className="mt-1 text-xs text-muted-foreground">Mapped room: {room.name}</p>}
                                    </div>
                                    <div>
                                      <h5 className="text-sm font-semibold text-foreground">Room details</h5>
                                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                        {room?.size && <span>{room.size} {room.sizeUnit || 'm²'}</span>}
                                        {(room?.maxOccupancy || room?.maxAdults) && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />Sleeps {room.maxOccupancy || room.maxAdults}</span>}
                                      </div>
                                      {!!room?.bedTypes?.length && <p className="mt-1 flex items-start gap-1 text-sm text-muted-foreground"><Bed className="mt-0.5 h-3.5 w-3.5 shrink-0" />{room.bedTypes.map((bed) => `${bed.quantity ? `${bed.quantity} × ` : ''}${bed.bedType}`).join(', ')}</p>}
                                      {roomDescription && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{roomDescription}</p>}
                                    </div>
                                    {!!room?.amenities?.length && (
                                      <div>
                                        <h5 className="text-sm font-semibold text-foreground">Amenities</h5>
                                        <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                          {room.amenities.slice(0, 8).map((amenity, amenityIndex) => <li key={`${amenity}-${amenityIndex}`}>{amenity}</li>)}
                                        </ul>
                                        {room.amenities.length > 8 && <p className="mt-1 text-xs text-muted-foreground">+{room.amenities.length - 8} more</p>}
                                      </div>
                                    )}
                                  </aside>

                                  <div className="divide-y divide-border">
                                    {roomGroup.options.map((rate, optionIndex) => {
                                      const roomRate = rate.offerRates?.[0] || rate;
                                      const totalAmount = rate.totalAmount ?? roomRate.totalAmount ?? 0;
                                      const freeCancellation = roomRate.cancellationPolicies?.cancelPolicyInfos?.find((policy) => Number(policy.amount) === 0);
                                      return (
                                        <article key={`${rate.offerId}-${optionIndex}`} className="grid grid-cols-1 items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_150px_132px] sm:gap-4">
                                          <div className="min-w-0">
                                            <h5 className="font-semibold text-foreground">{roomRate.boardType || 'Room rate'}</h5>
                                            {roomRate.roomType && roomRate.roomType !== roomGroup.roomType && <p className="mt-1 text-xs text-muted-foreground">{roomRate.roomType}</p>}
                                            {freeCancellation?.cancelTime ? (
                                              <p className="mt-1 text-sm text-success">Free cancellation before {freeCancellation.cancelTime}</p>
                                            ) : roomRate.refundable === true ? (
                                              <p className="mt-1 text-sm text-success">Refundable rate</p>
                                            ) : roomRate.refundable === false ? (
                                              <p className="mt-1 text-sm text-muted-foreground">Non-refundable rate</p>
                                            ) : null}
                                            {roomRate.perks?.length > 0 && <p className="mt-1 text-xs text-success">{roomRate.perks.map((perk) => perk.name).filter(Boolean).join(' · ')}</p>}
                                            {roomRate.remarks && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{cleanProviderDescription(roomRate.remarks)}</p>}
                                            {roomRate.cancellationPolicies?.cancelPolicyInfos?.length > 0 && (
                                              <details className="mt-1 text-xs text-muted-foreground">
                                                <summary className="cursor-pointer">Cancellation terms</summary>
                                                <ul className="mt-1 space-y-1">
                                                  {roomRate.cancellationPolicies.cancelPolicyInfos.map((policy, policyIndex) => (
                                                    <li key={policyIndex}>{policy.cancelTime ? `After ${policy.cancelTime}` : 'Cancellation fee'}{policy.amount != null ? ` · ${fmtMoney(policy.amount, policy.currency)}` : ''}</li>
                                                  ))}
                                                </ul>
                                              </details>
                                            )}
                                            {!!roomRate.taxes?.length && (
                                              <details className="mt-1 text-xs text-muted-foreground">
                                                <summary className="cursor-pointer">Taxes and fees</summary>
                                                <ul className="mt-1 space-y-1">
                                                  {roomRate.taxes.map((tax, taxIndex) => <li key={taxIndex}>{tax.description}: {fmtMoney(tax.amount, tax.currency)}{tax.included === true ? ' · included' : tax.included === false ? ' · payable separately' : ''}</li>)}
                                                </ul>
                                              </details>
                                            )}
                                          </div>
                                          <div className="sm:text-right">
                                            <p className="text-lg font-bold tabular-nums text-foreground">{fmtMoney(totalAmount / nights, rate.currency || roomRate.currency)}<span className="ml-1 text-xs font-normal text-muted-foreground">/ night</span></p>
                                            <p className="mt-1 text-xs text-muted-foreground">{nights} night{nights !== 1 ? 's' : ''} · total {fmtMoney(totalAmount, rate.currency || roomRate.currency)}</p>
                                          </div>
                                          <Button onClick={() => handleSelectRate(rate)} disabled={!rate.offerId} className="w-full gap-1.5">
                                            Choose room <ChevronRight className="h-4 w-4" />
                                          </Button>
                                        </article>
                                      );
                                    })}
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {groupRatesByOffer(selectedOffer.rates).map((rate, index) => {
                            const roomRates = rate.offerRates || [rate];
                            const firstRoom = selectedOffer.rooms?.find((item) => String(item.roomId) === String(roomRates[0].mappedRoomId));
                            return (
                              <Card key={`${rate.offerId}-${index}`} className="overflow-hidden p-4">
                                <div className="flex flex-col gap-4 md:flex-row">
                                  {firstRoom?.images?.[0] && <img src={firstRoom.images[0]} alt={firstRoom.name || rate.roomType || 'Room'} className="h-32 w-full rounded-md object-cover md:w-44" />}
                                  <div className="min-w-0 flex-1">
                                    {roomRates.map((roomRate, roomIndex) => {
                                      const room = selectedOffer.rooms?.find((item) => String(item.roomId) === String(roomRate.mappedRoomId));
                                      const roomDescription = cleanProviderDescription(room?.description);
                                      return (
                                        <div key={`${roomRate.occupancyNumber || roomIndex}-${roomRate.roomTypeId || roomRate.roomType}`} className="border-b border-border py-3 first:pt-0 last:border-0">
                                          <h4 className="font-semibold text-foreground">Room {roomRate.occupancyNumber || roomIndex + 1}: {roomRate.roomType || room?.name || 'Available room'}</h4>
                                          {room?.name && roomRate.roomType && room.name !== roomRate.roomType && <p className="mt-1 text-xs text-muted-foreground">Mapped room: {room.name}</p>}
                                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            {roomRate.boardType && <span>{roomRate.boardType}</span>}
                                            {room?.size && <span>{room.size} {room.sizeUnit || 'm²'}</span>}
                                            {(room?.maxOccupancy || roomRate.maxOccupancy) && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />Up to {room?.maxOccupancy || roomRate.maxOccupancy} guests</span>}
                                            {room?.bedTypes?.length ? <span className="flex items-center gap-1"><Bed className="h-3.5 w-3.5" />{room.bedTypes.map((bed) => `${bed.quantity ? `${bed.quantity} × ` : ''}${bed.bedType}`).join(', ')}</span> : null}
                                          </div>
                                          <p className="mt-1 text-xs text-muted-foreground">Room total: {fmtMoney(roomRate.totalAmount, roomRate.currency)}</p>
                                          {roomDescription && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{roomDescription}</p>}
                                          {roomRate.refundable === true && <p className="mt-2 text-xs text-success">Refundable rate</p>}
                                          {roomRate.refundable === false && <p className="mt-2 text-xs text-muted-foreground">Non-refundable rate</p>}
                                          {roomRate.cancellationPolicies?.cancelPolicyInfos?.map((policy, policyIndex) => (
                                            <p key={policyIndex} className="mt-1 text-xs text-muted-foreground">
                                              {policy.cancelTime ? `Cancel by ${policy.cancelTime}` : 'Cancellation terms'}
                                              {policy.amount != null ? ` · fee ${fmtMoney(policy.amount, policy.currency)}` : ''}
                                            </p>
                                          ))}
                                          {roomRate.remarks && <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{cleanProviderDescription(roomRate.remarks)}</p>}
                                          {!!room?.amenities?.length && <p className="mt-2 text-xs text-muted-foreground">{room.amenities.join(' · ')}</p>}
                                          {!!roomRate.perks?.length && <p className="mt-2 text-xs text-success">{roomRate.perks.map((perk) => perk.name).filter(Boolean).join(' · ')}</p>}
                                          {!!roomRate.taxes?.length && <details className="mt-2 text-xs text-muted-foreground">
                                            <summary className="cursor-pointer">Taxes and fees</summary>
                                            <ul className="mt-1 space-y-1">
                                              {roomRate.taxes.map((tax, taxIndex) => <li key={taxIndex}>{tax.description}: {fmtMoney(tax.amount, tax.currency)}{tax.included === true ? ' · included' : tax.included === false ? ' · payable separately' : ''}</li>)}
                                            </ul>
                                          </details>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-border pt-3 md:w-40 md:flex-col md:items-end md:justify-center md:border-l md:border-t-0 md:pl-4 md:pt-0">
                                    <div className="md:text-right">
                                      <div className="text-lg font-bold tabular-nums text-foreground">{fmtMoney(rate.totalAmount, rate.currency)}</div>
                                      <div className="text-xs text-muted-foreground">total for stay</div>
                                    </div>
                                    <Button onClick={() => handleSelectRate(rate)} disabled={!rate.offerId} className="gap-1.5">
                                      Continue <ChevronRight className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div className="rounded-md border border-border bg-muted/40 p-5 text-center">
                        <p className="text-sm font-medium text-foreground">No live room rates found for these dates</p>
                        <p className="mt-1 text-xs text-muted-foreground">Try different dates or guest numbers. Room availability is confirmed by the provider during prebooking.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ═══════ GUEST DETAILS (search mode) ═══════ */}
          {!isSuggestMode && bookingStep === 'guests' && selectedOffer && (
            <section className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setBookingStep('hotel')}>
                <ChevronLeft className="h-4 w-4" /> Back to room options
              </Button>

              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
                <div className="space-y-3">
                  <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Fields marked with * are required.</p>

                  <section className="rounded-lg border border-border p-4">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Your details</h3>
                    <div className="space-y-3">
                      {guests.map((guest, index) => (
                        <div key={guest.occupancyNumber} className="rounded-md border border-border p-3">
                          <p className="mb-2 text-sm font-medium text-foreground">Guest {index + 1}</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[96px_1fr_1fr]">
                            <Select value={guest.title} onValueChange={(value) => {
                              setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: String(value) } : item));
                            }}>
                              <SelectTrigger aria-label={`Guest ${index + 1} title`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {['Mr', 'Mrs', 'Ms', 'Miss'].map((title) => <SelectItem key={title} value={title}>{title}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Input aria-label={`Guest ${index + 1} first name`} placeholder="First name *" value={guest.firstName}
                              onChange={(event) => {
                                const firstName = event.target.value;
                                setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, firstName } : item));
                                if (bookingFor === 'self' && index === 0) setHolder((current) => ({ ...current, firstName }));
                              }} />
                            <Input aria-label={`Guest ${index + 1} last name`} placeholder="Last name *" value={guest.lastName}
                              onChange={(event) => {
                                const lastName = event.target.value;
                                setGuests((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, lastName } : item));
                                if (bookingFor === 'self' && index === 0) setHolder((current) => ({ ...current, lastName }));
                              }} />
                          </div>
                        </div>
                      ))}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input aria-label="Booking email" placeholder="Email *" type="email" value={contact.email}
                          onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))} />
                        <Input aria-label="Booking phone" placeholder="Phone *" type="tel" value={contact.phone}
                          onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))} />
                      </div>
                      <fieldset>
                        <legend className="mb-2 text-xs font-medium text-foreground">Are you traveling for work?</legend>
                        <div className="flex gap-4 text-sm">
                          {[false, true].map((value) => (
                            <label key={String(value)} className="flex cursor-pointer items-center gap-2 text-foreground">
                              <input type="radio" name="hotel-work-travel" checked={travelingForWork === value}
                                onChange={() => setTravelingForWork(value)} />
                              {value ? 'Yes' : 'No'}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </section>

                  <section className="rounded-lg border border-border p-4">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Who is booking for?</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant={bookingFor === 'self' ? 'default' : 'outline'} className="justify-between"
                        onClick={() => {
                          setBookingFor('self');
                          setHolder({ firstName: guests[0]?.firstName || '', lastName: guests[0]?.lastName || '' });
                        }}>
                        Myself {bookingFor === 'self' && <CheckCircle2 className="h-4 w-4" />}
                      </Button>
                      <Button type="button" variant={bookingFor === 'someone-else' ? 'default' : 'outline'} className="justify-between"
                        onClick={() => setBookingFor('someone-else')}>
                        Someone else {bookingFor === 'someone-else' && <CheckCircle2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </section>

                  <section className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Any special requests?</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Requests are sent to the hotel and are not guaranteed.</p>
                      </div>
                      <Plus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <textarea value={specialRequests} onChange={(event) => setSpecialRequests(event.target.value)} maxLength={500}
                      placeholder="Add a request (optional)" className="mt-3 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
                  </section>

                  <section className="rounded-lg border border-border p-4">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Add-ons</h3>
                    {searchForm.currency === 'USD' ? (
                      <div className="space-y-2">
                        <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                          <span>Uber voucher</span>
                          <select aria-label="Uber voucher value" value={uberVoucherAmount ?? ''}
                            onChange={(event) => setUberVoucherAmount(event.target.value ? Number(event.target.value) : null)}
                            className="h-9 max-w-36 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                            <option value="">No voucher</option>
                            {Array.from({ length: 10 }, (_, index) => (index + 1) * 10).map((amount) => <option key={amount} value={amount}>${amount} USD</option>)}
                          </select>
                        </label>
                        {esimPackagesLoading ? (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading eSIM options...</p>
                        ) : esimPackagesError ? (
                          <p role="status" className="text-sm text-muted-foreground">LiteAPI eSIM options are unavailable right now.</p>
                        ) : esimPackages.length > 0 ? (
                          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                            <span>eSIM package</span>
                            <select aria-label="eSIM package" value={selectedEsimPackageId ?? ''}
                              onChange={(event) => setSelectedEsimPackageId(event.target.value ? Number(event.target.value) : null)}
                              className="h-9 max-w-48 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                              <option value="">No eSIM</option>
                              {esimPackages.map((pack) => <option key={pack.packageId} value={pack.packageId}>{pack.name} · {pack.validityDays} days · {fmtMoney(pack.price, pack.currency)}</option>)}
                            </select>
                          </label>
                        ) : (
                          <p className="text-sm text-muted-foreground">No eSIM packages are available for this destination.</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">LiteAPI add-ons are currently priced in USD. Choose USD to add Uber or eSIM options.</p>
                    )}
                  </section>

                  <section className="rounded-lg border border-border p-4">
                    <h3 className="mb-2 text-sm font-semibold text-foreground">Redeem a promo code <span className="font-normal text-muted-foreground">(optional)</span></h3>
                    <div className="flex gap-2">
                      <Input value={promoCode} onChange={(event) => {
                        setPromoCode(event.target.value);
                        setPromoApplied(false);
                        setPromoFeedback(null);
                      }} placeholder="Enter promo code" aria-label="Promo code" />
                      <Button type="button" variant="outline" onClick={applyPromoCode} disabled={!promoCode.trim() || promoLoading}>
                        {promoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                      </Button>
                    </div>
                    {promoFeedback && <p role="status" className={`mt-2 text-xs ${promoApplied ? 'text-success' : 'text-muted-foreground'}`}>{promoFeedback}</p>}
                  </section>

                  <section className="rounded-lg border border-border p-4">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Payment information</h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input aria-label="Payer first name" placeholder="Payer first name *" value={holder.firstName}
                        onChange={(event) => setHolder((current) => ({ ...current, firstName: event.target.value }))} />
                      <Input aria-label="Payer last name" placeholder="Payer last name *" value={holder.lastName}
                        onChange={(event) => setHolder((current) => ({ ...current, lastName: event.target.value }))} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Card details are collected securely by LiteAPI on the next step.</p>
                  </section>

                  <Button className="h-11 w-full gap-2" onClick={() => {
                    for (const guest of guests) {
                      if (!guest.firstName.trim() || !guest.lastName.trim()) { toast.error('Enter a first and last name for every guest'); return; }
                    }
                    if (!contact.email.trim()) { toast.error('Contact email is required'); return; }
                    if (!contact.phone.trim()) { toast.error('Contact phone is required'); return; }
                    const payer = bookingFor === 'self'
                      ? { firstName: guests[0]?.firstName || holder.firstName, lastName: guests[0]?.lastName || holder.lastName }
                      : holder;
                    if (!payer.firstName.trim() || !payer.lastName.trim()) { toast.error('Payer first and last name are required'); return; }
                    setHolder(payer);
                    setContact((current) => ({ ...current, name: `${payer.firstName} ${payer.lastName}`.trim() }));
                    setBookingStep('review');
                  }}>
                    Continue to review <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <aside className="space-y-3 rounded-lg border border-border p-4 lg:sticky lg:top-0">
                  {selectedOffer.images?.[0] && <img src={selectedOffer.images[0]} alt={selectedOffer.name || 'Hotel'} className="h-36 w-full rounded-md object-cover" />}
                  <div>
                    <h3 className="font-semibold text-foreground">{selectedOffer.name}</h3>
                    <StarRating rating={selectedOffer.starRating} />
                    {selectedOffer.address && <p className="mt-1 text-xs text-muted-foreground">{selectedOffer.address}</p>}
                  </div>
                  <div className="border-t border-border pt-3 text-sm">
                    <p className="font-medium text-foreground">Check-in & check-out</p>
                    <p className="mt-1 text-muted-foreground">{fmtDate(searchForm.checkin)} – {fmtDate(searchForm.checkout)} ({getNightCount(searchForm.checkin, searchForm.checkout)} nights)</p>
                  </div>
                  <div className="border-t border-border pt-3 text-sm">
                    <p className="font-medium text-foreground">Cancellation policy</p>
                    {selectedRate?.cancellationPolicies?.cancelPolicyInfos?.length ? (
                      selectedRate.cancellationPolicies.cancelPolicyInfos.map((policy, index) => (
                        <p key={index} className="mt-1 text-xs text-muted-foreground">
                          {policy.cancelTime ? `Cancel by ${policy.cancelTime}` : 'Cancellation terms'}
                          {policy.amount != null ? ` · fee ${fmtMoney(policy.amount, policy.currency)}` : ''}
                        </p>
                      ))
                    ) : <p className="mt-1 text-xs text-muted-foreground">See rate terms before payment.</p>}
                  </div>
                  <div className="border-t border-border pt-3 text-sm">
                    <p className="font-medium text-foreground">{selectedRate?.roomType}</p>
                    <p className="mt-1 text-muted-foreground">{selectedRate?.boardType} · {guests.length} room{guests.length !== 1 ? 's' : ''}</p>
                    <p className="mt-2 flex justify-between gap-2"><span>Room total</span><span>{fmtMoney(selectedRate?.totalAmount, selectedRate?.currency)}</span></p>
                    {uberVoucherAmount && <p className="mt-1 flex justify-between gap-2"><span>Uber voucher</span><span>{fmtMoney(uberVoucherAmount, 'USD')}</span></p>}
                    {selectedEsimPackage && <p className="mt-1 flex justify-between gap-2"><span>{selectedEsimPackage.name} eSIM</span><span>{fmtMoney(selectedEsimPackage.price, selectedEsimPackage.currency)}</span></p>}
                    {promoApplied && <p className="mt-1 text-right text-xs text-success">Promo will be confirmed by LiteAPI</p>}
                  </div>
                  <div className="rounded-md bg-primary/5 p-3">
                    <div className="flex justify-between font-semibold text-foreground">
                      <span>Estimated total</span>
                      <span>{fmtMoney((selectedRate?.totalAmount || 0) + (uberVoucherAmount || 0) + (selectedEsimPackage?.price || 0), selectedRate?.currency)}</span>
                    </div>
                    <p className="mt-1 text-right text-[11px] text-muted-foreground">Final total confirmed by LiteAPI</p>
                  </div>
                </aside>
              </div>
            </section>
          )}

          {/* ═══════ REVIEW + CONFIRM ═══════ */}
          {!isSuggestMode && bookingStep === 'review' && selectedOffer && (
            <>
              <Button variant="ghost" size="sm" className="mb-4" onClick={() => setBookingStep('guests')}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <h3 className="text-lg font-semibold text-foreground mb-3">Review & Confirm</h3>
              <div className="bg-muted rounded-lg p-3 mb-3">
                <div className="font-semibold text-foreground">{selectedOffer.name}</div>
                <div className="text-sm text-muted-foreground">{selectedRate?.roomType} · {selectedRate?.boardType}</div>
                <p className="text-sm text-muted-foreground">{fmtDate(searchForm.checkin)} → {fmtDate(searchForm.checkout)} · {guests.length} guest{guests.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="mb-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Guests</div>
                {guests.map((g, i) => <div key={i} className="text-sm text-foreground">{g.title} {g.firstName} {g.lastName}</div>)}
              </div>
              <div className="border-t border-border pt-3 mb-4">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3"><span>Room total</span><span>{fmtMoney(selectedRate?.totalAmount, selectedRate?.currency)}</span></div>
                  {uberVoucherAmount && <div className="flex justify-between gap-3"><span>Uber voucher</span><span>{fmtMoney(uberVoucherAmount, 'USD')}</span></div>}
                  {selectedEsimPackage && <div className="flex justify-between gap-3"><span>{selectedEsimPackage.name} eSIM</span><span>{fmtMoney(selectedEsimPackage.price, selectedEsimPackage.currency)}</span></div>}
                  {promoApplied && <p className="text-xs text-success">Promo code will be validated with the final price.</p>}
                </div>
                <div className="mt-3 flex justify-between border-t border-border pt-3 text-lg font-bold text-foreground">
                  <span>Estimated total</span><span className="font-mono tabular-nums">{fmtMoney((selectedRate?.totalAmount || 0) + (uberVoucherAmount || 0) + (selectedEsimPackage?.price || 0), selectedRate?.currency)}</span>
                </div>
              </div>
              <Button onClick={validateSelectedRate} disabled={booking}>
                {booking ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {booking ? 'Checking live availability...' : 'Check live price & continue to payment'}
              </Button>
            </>
          )}

          {!isSuggestMode && bookingStep === 'prebook' && selectedOffer && (
            <section className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setBookingStep('review')}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
              <h3 className="text-lg font-semibold text-foreground">Live rate confirmed</h3>
              <div className="rounded-md border border-border bg-muted/40 p-4">
                <p className="font-semibold text-foreground">{selectedOffer.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{selectedRate?.roomType} · {selectedRate?.boardType}</p>
                <p className="mt-3 text-xs text-muted-foreground">Final total for {fmtDate(prebookResult?.checkin || searchForm.checkin)} – {fmtDate(prebookResult?.checkout || searchForm.checkout)}</p>
                <p className="text-xs text-muted-foreground">Search price: {fmtMoney(selectedRate?.totalAmount, selectedRate?.currency)}</p>
                <p className="text-xl font-bold tabular-nums text-foreground">{fmtMoney(prebookResult?.price, prebookResult?.currency || selectedRate?.currency)}</p>
              </div>
              {prebookResult?.priceDifferencePercent !== 0 && prebookResult?.priceDifferencePercent != null && (
                <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                  The final price changed by {prebookResult.priceDifferencePercent}%. Review the updated total before booking.
                </p>
              )}
              {prebookResult?.cancellationChanged && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">Cancellation terms changed since the search. Review the current rate terms before booking.</p>}
              {prebookResult?.boardChanged && <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">The meal plan changed since the search. Review the current room details before booking.</p>}
              {prebookResult?.termsAndConditions && <p className="whitespace-pre-line text-sm text-muted-foreground">{cleanProviderDescription(prebookResult.termsAndConditions)}</p>}
              {!!prebookResult?.addonsRequest?.length && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <h4 className="font-medium text-foreground">Selected add-ons</h4>
                  {prebookResult.addonsRequest.map((addon: any, index: number) => (
                    <p key={`${addon.addon}-${index}`} className="mt-1 flex justify-between gap-3 text-muted-foreground">
                      <span>{addon.addon === 'uber' ? `Uber voucher ${fmtMoney(addon.value, addon.currency)}` : `${selectedEsimPackage?.name || 'eSIM'} package`}</span>
                      <span>{fmtMoney(addon.value, addon.currency)}</span>
                    </p>
                  ))}
                </div>
              )}
              {prebookResult?.voucherCode && <p className="text-sm text-success">Promo {prebookResult.voucherCode} applied · {fmtMoney(prebookResult.voucherTotalAmount, prebookResult.currency)}</p>}
              <p className="text-xs text-muted-foreground">Availability, promo, add-ons, and final price were checked by LiteAPI.</p>
              {paymentSdkError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{paymentSdkError}</p>}
              {paymentSdkLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading LiteAPI secure checkout...</p>}
              <Button type="button" className="h-11 w-full gap-2" onClick={startLiteApiPayment} disabled={!paymentSdkReady || paymentSdkStarted}>
                {paymentSdkStarted ? <CheckCircle2 className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                {paymentSdkStarted ? 'Secure payment form opened below' : 'Pay securely with LiteAPI'}
              </Button>
              <div id="liteapi-payment-element" ref={paymentElementRef} className="min-h-24" />
              <p className="text-xs text-muted-foreground">Card details are entered directly into LiteAPI’s secure payment form and are not stored by the CRM.</p>
            </section>
          )}

          {/* ═══════ CONFIRMED ═══════ */}
          {!isSuggestMode && bookingStep === 'confirmed' && confirmedBooking && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-1">Booking Confirmed</h3>
              <p className="text-muted-foreground mb-4">{confirmedBooking.hotelName || 'Hotel'} · {confirmedBooking.id}</p>
              <Button onClick={onClose}>Done</Button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center -mx-4 -mb-4 mt-2 px-4 py-3 border-t bg-muted/50 rounded-b-xl">
          Search powered by hotel provider API.
        </p>
      </DialogContent>
    </Dialog>
  );
}

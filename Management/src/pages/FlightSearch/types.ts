import type { CreateOrder, Offer, SeatMap } from '@duffel/components';

// Offer/segment shapes are the normalized Travelport response
// (flight-service's /flights/search) - loosely typed since the service
// itself is untyped JS with no response contract to check against, same
// precedent as every other untyped-API-boundary page in this app.

export interface FlightSegmentOffer {
  sequence?: number;
  origin?: string;
  destination?: string;
  departureAt?: string;
  arrivalAt?: string;
  durationMinutes?: number;
  stops?: number;
  marketingCarrier?: string;
  operatingCarrierName?: string;
  flightNumber?: string;
  aircraft?: string | null;
  originTerminal?: string | null;
  destinationTerminal?: string | null;
  cabinMarketingName?: string | null;
}

export interface FlightOffer {
  offerId: string;
  airline?: string;
  airlineCode?: string;
  airlineLogo?: string | null;
  cabinClass?: string;
  cabinMarketingName?: string | null;
  fareBrandName?: string | null;
  refundable?: boolean;
  changeable?: boolean;
  refundPenalty?: string | null;
  changePenalty?: string | null;
  baggageAllowance?: {
    checkedBags: number;
    carryOnBags: number;
  } | null;
  baseFare?: number;
  taxes?: number;
  fareTotal: number;
  currency?: string;
  /** Journey legs (Duffel slices): 2 for a round trip. Absent on providers that do not report it. */
  legCount?: number;
  /** Provider (Duffel) passenger ids, in the adults → children → infants order the forms are built in. */
  passengerIds?: string[];
  segments?: FlightSegmentOffer[];
}

export interface DuffelCheckoutData {
  offer: Offer;
  seatMaps: SeatMap[];
  upsellOffers: Offer[];
  clientKey: string;
  cardCheckoutEnabled: boolean;
}

export type DuffelPassenger = CreateOrder['passengers'][number];

export interface SelectedDuffelService {
  id: string;
  quantity: number;
}

export type TravelerType = 'adult' | 'child' | 'infant';

export interface TravelerForm {
  type: TravelerType;
  title: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  passportNumber: string;
  passportExpiry: string;
  nationality: string;
  frequentFlyerNumber: string;
  mealPreference?: string;
  specialAssistance?: string;
  passengerId?: string;
  infantPassengerId?: string;
}

export interface ContactForm {
  name: string;
  email: string;
  phone: string;
}

export type TripType = 'oneWay' | 'roundTrip';

/** The search that produced the displayed offers — what the traveler form and the booking are built from. */
export interface FlightSearchContext {
  origin: string;
  destination: string;
  tripType: TripType;
  adults: number;
  children: number;
  infants: number;
}

export interface SearchFormState {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  adults: number;
  children: number;
  infants: number;
  childAges: string[];
  infantAges: string[];
  cabinClass: string;
}

// Mirrors the provider-backed booking states persisted by flight-service.
export type FlightBookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed';

export interface FlightBookingTraveler {
  title?: string;
  firstName?: string;
  lastName?: string;
  type?: TravelerType;
  dob?: string;
  gender?: string;
}

export interface FlightBookingProviderDetails {
  availableActions?: string[];
  documents?: Array<{ unique_identifier?: string; type?: string }>;
  services?: Array<{
    id?: string;
    type?: string;
    quantity?: number;
    total_amount?: string;
    total_currency?: string;
  }>;
  paymentStatus?: {
    awaiting_payment?: boolean;
    paid_at?: string | null;
    payment_required_by?: string | null;
    price_guarantee_expires_at?: string | null;
  } | null;
  conditions?: {
    refund_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null } | null;
    change_before_departure?: { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null } | null;
  } | null;
}

export interface FlightCancellationCredit {
  credit_name?: string;
  credit_amount?: string;
  credit_currency?: string;
  credit_code?: string | null;
}

export interface FlightBookingRecord {
  id: string;
  pnr?: string;
  status: FlightBookingStatus | string;
  totalAmount?: number;
  baseFare?: number;
  taxes?: number;
  currency?: string;
  tripType?: string;
  cabinClass?: string;
  travelportOrderId?: string | null;
  ticketingDeadline?: string | null;
  bookedAt?: string | null;
  createdAt?: string;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  canCancel?: boolean;
  searchSnapshot?: Record<string, unknown> & {
    refundable?: boolean;
    changeable?: boolean;
    selectedServices?: Array<{ id: string; quantity: number }>;
  };
  providerOrder?: FlightBookingProviderDetails | null;
  segments?: FlightSegmentOffer[];
  travelers?: FlightBookingTraveler[];
}

export interface FlightCancellationQuote {
  quoteAvailable: boolean;
  cancellationId?: string | null;
  orderId?: string | null;
  refundAmount?: string | number | null;
  refundCurrency?: string | null;
  refundTo?: string | null;
  expiresAt?: string | null;
  airlineCredits?: FlightCancellationCredit[];
}

export type BookingStep = 'results' | 'travelers' | 'ancillaries' | 'review' | 'confirmation';

export type FlightTab = 'search' | 'bookings';

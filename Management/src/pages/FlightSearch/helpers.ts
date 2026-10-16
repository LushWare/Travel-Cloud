import type { DuffelPassenger, TravelerForm, TravelerType } from './types';

export const CABIN_CLASSES = ['Economy', 'Premium Economy', 'Business', 'First'];

export const TRIP_TYPES: { id: 'oneWay' | 'roundTrip'; label: string }[] = [
  { id: 'oneWay', label: 'One Way' },
  { id: 'roundTrip', label: 'Round Trip' },
];

export const SORT_OPTIONS: { id: string; label: string }[] = [
  { id: 'price', label: 'Price (lowest)' },
  { id: 'departure', label: 'Departure (earliest)' },
  { id: 'duration', label: 'Duration (shortest)' },
  { id: 'stops', label: 'Stops (fewest)' },
];

export const STATUS_TABS: { id: 'all' | 'confirmed' | 'pending' | 'cancelled' | 'failed'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'pending', label: 'Pending' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'failed', label: 'Failed' },
];

export const todayStr = (): string => new Date().toISOString().split('T')[0];

export const emptyTraveler = (type: TravelerType = 'adult'): TravelerForm => ({
  type,
  title: 'Mr',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dob: '',
  gender: '',
  passportNumber: '',
  passportExpiry: '',
  nationality: '',
  frequentFlyerNumber: '',
  mealPreference: 'None',
  specialAssistance: 'None',
});

export function buildDuffelPassengers(travelers: TravelerForm[], providerPassengerIds: string[]): DuffelPassenger[] {
  const infantPassengerIds = travelers
    .filter((traveler) => traveler.type === 'infant')
    .map((traveler) => traveler.passengerId)
    .filter((id): id is string => Boolean(id));
  let infantIndex = 0;

  return travelers.map((traveler, index) => {
    const infantPassengerId = traveler.type === 'adult' ? infantPassengerIds[infantIndex++] : undefined;
    return {
      id: providerPassengerIds[index],
      given_name: traveler.firstName,
      family_name: traveler.lastName,
      born_on: traveler.dob,
      email: traveler.email,
      phone_number: traveler.phone,
      gender: (traveler.gender || 'M').toLowerCase() as NonNullable<DuffelPassenger['gender']>,
      title: (traveler.title || 'Mr').toLowerCase() as NonNullable<DuffelPassenger['title']>,
      ...(infantPassengerId && { infant_passenger_id: infantPassengerId }),
    };
  });
}

export function sanitizeTravelerForBooking(traveler: TravelerForm) {
  const normalized = { ...traveler };
  if (typeof normalized.dob === 'string' && normalized.dob.trim()) {
    const dob = normalized.dob.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      normalized.dob = dob;
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dob)) {
      const [month, day, year] = dob.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      normalized.dob = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
  }

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== '' && value !== null && value !== undefined),
  );
}

export function fmtDate(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(mins?: number): string {
  if (mins == null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m > 0 ? `${m}m` : ''}`;
}

export function fmtMoney(amount?: number, currency?: string): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
}

// How many offers/bookings the page renders at a time. A live Duffel search
// answers with hundreds of offers (772 on one round trip), so rendering stops
// at a page and the caller asks for the next one explicitly.
export const OFFERS_PAGE_SIZE = 20;
export const BOOKINGS_PAGE_SIZE = 25;

// Each tab matches one persisted provider-backed booking state.
export const STATUS_BUCKETS = {
  confirmed: ['confirmed'],
  pending: ['pending'],
  cancelled: ['cancelled'],
  failed: ['failed'],
} as const;
export type StatusBucket = keyof typeof STATUS_BUCKETS;
export function statusBucket(bucket: string): StatusBucket | null {
  return (Object.keys(STATUS_BUCKETS) as StatusBucket[]).find((b) =>
    (STATUS_BUCKETS[b] as readonly string[]).includes(bucket),
  ) ?? null;
}

export function stopsLabel(stops: number): string {
  return stops === 0 ? 'Nonstop' : `${stops} stop${stops > 1 ? 's' : ''}`;
}

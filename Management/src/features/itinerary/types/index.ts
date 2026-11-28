/**
 * Type definitions and constants for the Package feature.
 * Aligned with package-service relational schema.
 */

// Enums are owned by @travel-crm/constants — re-exported here so existing
// importers keep working with a single source of truth.
export {
  TRANSPORT_MODE,
  PRICING_MODEL,
  ROUTE_TYPE,
} from '@travel-crm/constants';

export const PACKAGE_CATEGORY = {
  HONEYMOON: 'HONEYMOON',
  COUPLE: 'COUPLE',
  FAMILY: 'FAMILY',
  GROUP: 'GROUP',
  WILD_SAFARI: 'WILD_SAFARI',
} as const;
export type PackageCategory = (typeof PACKAGE_CATEGORY)[keyof typeof PACKAGE_CATEGORY];

export const MARGIN_TYPE = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
} as const;
export type MarginType = (typeof MARGIN_TYPE)[keyof typeof MARGIN_TYPE];

export const PLACE_TYPE = {
  CITY: 'CITY',
  ATTRACTION: 'ATTRACTION',
  REGION: 'REGION',
  AIRPORT: 'AIRPORT',
} as const;
export type PlaceType = (typeof PLACE_TYPE)[keyof typeof PLACE_TYPE];

export interface SelectOption {
  value: string;
  label: string;
  [key: string]: unknown;
}

// Legacy display-friendly category labels (mapped to enum values)
export const CATEGORY_OPTIONS: SelectOption[] = [
  { value: 'HONEYMOON', label: 'Honeymoon' },
  { value: 'COUPLE', label: 'Couple' },
  { value: 'FAMILY', label: 'Family' },
  { value: 'GROUP', label: 'Group' },
  { value: 'WILD_SAFARI', label: 'Wild Safari' },
];

// Transport display labels
export const TRANSPORT_OPTIONS: SelectOption[] = [
  { value: 'CAR', label: 'Car', icon: '🚗' },
  { value: 'VAN', label: 'Van', icon: '🚐' },
  { value: 'FLIGHT', label: 'Flight', icon: '✈️' },
  { value: 'TRAIN', label: 'Train', icon: '🚂' },
  { value: 'BOAT', label: 'Boat', icon: '⛵' },
];

export interface DayMeals {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
}

export interface DayAccommodation {
  name: string;
  type: string;
  rating: number;
  address: string;
  contactNumber: string;
  hotelId: string | null;
  hotelImage: string | null;
  roomType: string | null;
  boardType: string | null;
  totalAmount: number | null;
  currency: string;
  refundable: boolean | null;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  description: string;
  meals: DayMeals;
  // Cost fields — source of truth for the pricing engine. The `meals`
  // booleans above mirror these for the legacy toggle UI (kept in sync).
  breakfastCount: number;
  lunchCount: number;
  dinnerCount: number;
  mealPriceOverride: number | null;
  breakfastPriceOverride?: number | null;
  lunchPriceOverride?: number | null;
  dinnerPriceOverride?: number | null;
  places: DefaultPlace[];
  activities: DefaultActivity[];
  // Per-activity cost data keyed by activity name so the display-name based
  // ActivitySelector keeps working while costs live alongside it.
  activityCosts: Record<string, unknown>;
  locations: unknown[];
  // Each day books its own per-night stay for now (see tech-debt note in the
  // ItineraryEditor accommodation costs subsection).
  accommodation: DayAccommodation;
  images: unknown[];
  notes: string;
  transports: unknown[];
  // Per-day flights selected via the Flight Booking section. Each flight may
  // carry a client-side id used to link it to its FLIGHT transport row.
  flights: unknown[];
}

// Relational day shape matching backend ItineraryDay + junctions
export const createDefaultDay = (dayNumber = 1): ItineraryDay => ({
  dayNumber,
  title: '',
  description: '',
  meals: { breakfast: true, lunch: false, dinner: true },
  breakfastCount: 1,
  lunchCount: 0,
  dinnerCount: 1,
  mealPriceOverride: null,
  places: [],
  activities: [],
  activityCosts: {},
  locations: [],
  accommodation: {
    name: '',
    type: '',
    rating: 0,
    address: '',
    contactNumber: '',
    hotelId: null,
    hotelImage: null,
    roomType: null,
    boardType: null,
    totalAmount: null,
    currency: 'USD',
    refundable: null,
  },
  images: [],
  notes: '',
  transports: [],
  flights: [],
});

export interface DefaultPlace {
  placeId: string | null;
  customName: string;
  orderIndex: number;
}

// Default place entry
export const createDefaultPlace = (orderIndex = 0): DefaultPlace => ({
  placeId: null,
  customName: '',
  orderIndex,
});

export interface DefaultActivity {
  activityId: string | null;
  name: string;
  defaultCost: number;
  costOverride: number | null;
  orderIndex: number;
}

// Default activity entry
export const createDefaultActivity = (orderIndex = 0): DefaultActivity => ({
  activityId: null,
  name: '',
  defaultCost: 0,
  costOverride: null,
  orderIndex,
});

export interface PackageDefaults {
  images: unknown[];
  coverImage: string | null;
  inclusions: string[];
  exclusions: string[];
  termsAndConditions: string;
  itineraryDays: ItineraryDay[];
  bookings: number;
  rating: number;
  numReviews: number;
  views: number;
  isActive: boolean;
  isFeatured: boolean;
  defaultMarginType: MarginType;
  defaultMarginInput: number;
  currency: string;
}

export const PACKAGE_DEFAULTS: PackageDefaults = {
  images: [],
  coverImage: null,
  inclusions: [],
  exclusions: [],
  termsAndConditions: '',
  itineraryDays: [],
  bookings: 0,
  rating: 0,
  numReviews: 0,
  views: 0,
  isActive: true,
  isFeatured: false,
  defaultMarginType: 'PERCENTAGE',
  defaultMarginInput: 0,
  currency: 'USD',
};

export interface Package extends PackageDefaults {
  id?: string;
  title: string;
  description: string;
  destination: string;
  durationDays: number;
  category: PackageCategory;
  basePrice: number;
  [key: string]: unknown;
}

// New package blueprint
export const createDefaultPackage = (overrides: Partial<Package> = {}): Package => ({
  title: '',
  description: '',
  destination: '',
  durationDays: 1,
  category: PACKAGE_CATEGORY.FAMILY,
  basePrice: 0,
  ...PACKAGE_DEFAULTS,
  ...overrides,
});

// Legacy compat helpers (deprecated — use new field names directly)
export const LEGACY_CATEGORY_MAP: Record<string, PackageCategory> = {
  adventure: 'FAMILY', budget: 'FAMILY', luxury: 'FAMILY',
  religious: 'FAMILY', wildlife: 'WILD_SAFARI', beach: 'FAMILY',
  heritage: 'FAMILY', other: 'FAMILY', honeymoon: 'HONEYMOON',
  couple: 'COUPLE', family: 'FAMILY', group: 'GROUP',
  'wild safari': 'WILD_SAFARI',
};

export const mapLegacyCategory = (cat?: string | null): PackageCategory =>
  LEGACY_CATEGORY_MAP[cat?.toLowerCase() ?? ''] || 'FAMILY';

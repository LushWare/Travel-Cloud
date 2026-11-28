/**
 * Helper functions for itinerary calculations and transformations
 * Aligned with backend data structure
 */

import { createDefaultDay, type ItineraryDay } from '../types/index';
import { formatCurrency } from '../../../utils/currency.js';
import { PRICING_MODEL } from '@travel-crm/constants';

/** Generate days array based on duration. */
export const generateDaysArray = (days: number | string, currentDays: ItineraryDay[] = []): ItineraryDay[] => {
  const daysCount = parseInt(String(days), 10) || 0;

  if (daysCount <= 0) return [];

  let newDays = [...currentDays];

  // Add new days if needed
  if (currentDays.length < daysCount) {
    for (let i = currentDays.length + 1; i <= daysCount; i++) {
      newDays.push(createDefaultDay(i));
    }
  }
  // Remove extra days if needed
  else if (currentDays.length > daysCount) {
    newDays = newDays.slice(0, daysCount);
  }

  return newDays;
};

/** Format duration string from days count -> number of nights. */
export const formatDuration = (days: number | string): number => {
  return parseInt(String(days), 10) || 1;
};

/** Parse duration string to extract days. */
export const parseDurationToDays = (duration: string | number | null | undefined): number => {
  if (typeof duration === 'number') return duration;
  const match = duration?.match(/(\d+)\s*Days?/);
  return match ? parseInt(match[1], 10) : 1;
};

/** Validate itinerary data (days array). Returns an errors object. */
export const validateItinerary = (days: ItineraryDay[]): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (!Array.isArray(days) || days.length === 0) {
    errors.days = 'At least one day is required in itinerary.';
    return errors;
  }

  days.forEach((day) => {
    if (!day.title) {
      errors[`day${day.dayNumber}_title`] = `Day ${day.dayNumber} title is required.`;
    }
    if (!day.description) {
      errors[`day${day.dayNumber}_description`] = `Day ${day.dayNumber} description is required.`;
    }
  });

  return errors;
};

// ═══════════════════════════════════════════════════════════════════
// Pricing normalization helpers — shared by the ItineraryEditor cost
// subsections and the Price Calculation breakdown so both always use the
// exact same numbers.
// ═══════════════════════════════════════════════════════════════════

const getLegacyMealBooleans = (day: any) => {
  const meals = day?.meals && typeof day.meals === 'object' ? day.meals : null;
  if (!meals) return null;
  return {
    breakfast: Boolean(meals.breakfast),
    lunch: Boolean(meals.lunch),
    dinner: Boolean(meals.dinner),
  };
};

/**
 * Resolve a day's meal counts. Explicit count fields (written by the Costs &
 * Pricing subsection) win; otherwise fall back to the legacy boolean toggles.
 */
export const getMealCounts = (day: any) => {
  const booleans = getLegacyMealBooleans(day);
  return {
    breakfastCount: day?.breakfastCount ?? (booleans ? (booleans.breakfast ? 1 : 0) : 0),
    lunchCount: day?.lunchCount ?? (booleans ? (booleans.lunch ? 1 : 0) : 0),
    dinnerCount: day?.dinnerCount ?? (booleans ? (booleans.dinner ? 1 : 0) : 0),
    mealPriceOverride: optionalPrice(day?.mealPriceOverride),
    breakfastPriceOverride: optionalPrice(day?.breakfastPriceOverride),
    lunchPriceOverride: optionalPrice(day?.lunchPriceOverride),
    dinnerPriceOverride: optionalPrice(day?.dinnerPriceOverride),
  };
};

const optionalPrice = (value: unknown) => (value == null || value === '' ? null : Number(value));

/**
 * Resolve a day's activities into [{ name, defaultCost, costOverride }].
 * Editor activities are display-name strings (or objects); cost overrides and
 * catalog default costs live in `day.activityCosts` and `_relational.activities`.
 */
export const getDayActivities = (day: any) => {
  const raw = Array.isArray(day?.activities)
    ? day.activities
    : (typeof day.activities === 'string'
      ? day.activities.split(',').map((s: string) => s.trim()).filter(Boolean)
      : []);
  const relational = Array.isArray(day?._relational?.activities) ? day._relational.activities : [];
  const costMap = day?.activityCosts && typeof day.activityCosts === 'object' ? day.activityCosts : {};

  return raw.map((a: any) => {
    const isObj = a && typeof a === 'object';
    const name = isObj ? (a.name || a.activity?.name || '') : (a || '');
    const stored = relational.find(
      (row: any) =>
        (row.activity?.name || row.name) === name ||
        (isObj && a.activityId && row.activityId === a.activityId)
    );
    const fromMap = name ? costMap[name] : null;

    return {
      name,
      defaultCost: Number(
        fromMap?.defaultCost ??
        (isObj ? a.defaultCost ?? a.activity?.defaultCost : undefined) ??
        stored?.activity?.defaultCost ??
        0
      ),
      costOverride:
        fromMap?.costOverride != null && fromMap.costOverride !== ''
          ? Number(fromMap.costOverride)
          : (isObj && a.costOverride != null ? Number(a.costOverride) : null),
    };
  }).filter((a: any) => a.name);
};

/**
 * Resolve a day's transport rows (editor rows win over relational rows loaded
 * from the API). Each row keeps the pricingModel/unitCost/distanceKm fields.
 */
export const getDayTransports = (day: any) => {
  let rows;
  const hasEditorRows = Array.isArray(day?.transports);
  if (hasEditorRows && day.transports.length > 0) {
    rows = day.transports.map(normalizeTransportRow);
  } else if (Array.isArray(day?._relational?.transports) && day._relational.transports.length > 0) {
    rows = day._relational.transports.map(normalizeTransportRow);
  } else {
    rows = [];
  }

  // Freshly loaded days have no editor flightRefs on their rows — re-link
  // FLIGHT rows to the persisted flights (by order) so rows and flights
  // reconnect. Editor-written rows keep their own flightRefs, so orphan
  // FLIGHT rows (added manually in Costs & Pricing) stay unlinked.
  if (!hasEditorRows) {
    const flights = Array.isArray(day?.flights) ? day.flights : [];
    if (flights.length > 0) {
      let flightIndex = 0;
      rows = rows.map((row: any) => {
        if (row.transportMode === 'FLIGHT' && !row.flightRef && flights[flightIndex]) {
          return { ...row, flightRef: flights[flightIndex++].id };
        }
        return row;
      });
    }
  }

  return rows;
};

function normalizeTransportRow(t: any) {
  return {
    routeType: t.routeType || 'DAILY_ROUTING',
    transportMode: t.transportMode || 'CAR',
    pricingModel: t.pricingModel || 'PER_VEHICLE',
    unitCost: t.unitCost == null || t.unitCost === '' ? 0 : Number(t.unitCost),
    distanceKm: t.distanceKm == null || t.distanceKm === '' ? null : Number(t.distanceKm),
    // Editor-only link to the flight that created this row; dropped by the
    // save payload/backend mappers so it never reaches the API.
    flightRef: t.flightRef || null,
  };
}

/** Compute one transport row's cost using the pricing engine's PER_* rules. */
export const getTransportRowCost = (transport: any, groupSize = 1): number => {
  const unitCost = transport.unitCost || 0;
  switch (transport.pricingModel) {
    case PRICING_MODEL.PER_KM:
      return unitCost * (transport.distanceKm || 0);
    case PRICING_MODEL.PER_PERSON:
      return unitCost * groupSize;
    case PRICING_MODEL.PER_VEHICLE:
    default:
      return unitCost;
  }
};

/** Total accommodation cost for one day (each day books one per-night stay). */
export const getAccommodationTotal = (day: any): number => {
  const amount = Number(day?.accommodation?.totalAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** Filter packages based on search term. */
export const filterPackages = (packages: any[], searchTerm: string): any[] => {
  if (!searchTerm.trim()) return packages;

  const term = searchTerm.toLowerCase();
  return packages.filter(
    (pkg) =>
      pkg.name?.toLowerCase().includes(term) ||
      pkg.destination?.toLowerCase().includes(term) ||
      pkg.category?.toLowerCase().includes(term)
  );
};

/** Calculate package statistics. */
export const calculatePackageStats = (packages: any[]) => {
  return {
    total: packages.length,
    published: packages.filter((p) => p.status === 'published').length,
    draft: packages.filter((p) => p.status === 'draft').length,
    archived: packages.filter((p) => p.status === 'archived').length,
    totalBookings: packages.reduce((sum, p) => sum + (p.bookings || 0), 0),
    avgRating: packages.length > 0
      ? (packages.reduce((sum, p) => sum + (p.rating || 0), 0) / packages.length).toFixed(1)
      : 0,
  };
};

/** Format price value into Indian Rupees currency. */
export const formatPriceINR = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  let numericValue: number;

  if (typeof value === 'number') {
    numericValue = value;
  } else {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    numericValue = cleaned ? Number(cleaned) : Number.NaN;
  }

  if (!Number.isFinite(numericValue)) {
    return typeof value === 'string' ? value : '';
  }

  // Determine decimal places based on value
  const hasDecimals = !Number.isInteger(numericValue);

  return formatCurrency(numericValue, {
    minimumFractionDigits: hasDecimals ? 2 : 0,
  });
};

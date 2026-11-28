import { useEffect, useState } from 'react';
import { PEOPLE_PER_ROOM } from '@travel-crm/pricing-engine';
import { adminAPI } from '../../../services/api';

export type MealKey = 'breakfast' | 'lunch' | 'dinner';
export type MarginType = 'PERCENTAGE' | 'FIXED';

export type PricingModel = 'PER_VEHICLE' | 'PER_KM' | 'PER_PERSON';
export const PRICING_MODELS: PricingModel[] = ['PER_VEHICLE', 'PER_KM', 'PER_PERSON'];

export interface TransportRate {
  pricingModel: PricingModel;
  unitCost: number;
}

/** A vehicle's rate for each pricing model, and the model a new row starts with. */
export type TransportRates = { pricingModel: PricingModel; seats?: number } & Partial<Record<PricingModel, number>>;

export interface PricingDefaults {
  mealPrices: Record<MealKey, number>;
  margin: { type: MarginType; percentage: number; fixed: number };
  transportRates: Partial<Record<string, TransportRates>>;
  peoplePerRoom: number;
  /** False until an admin saves meal prices in Settings — meals then cost 0, never a made-up price. */
  mealPricesSet: boolean;
}

// Nothing saved in Settings: no prices at all. Twin sharing (2 per room) is the package price basis, not a price.
export const BUILT_IN_PRICING_DEFAULTS: PricingDefaults = {
  mealPrices: { breakfast: 0, lunch: 0, dinner: 0 },
  margin: { type: 'PERCENTAGE', percentage: 0, fixed: 0 },
  transportRates: {},
  peoplePerRoom: PEOPLE_PER_ROOM,
  mealPricesSet: false,
};

const finite = (value: unknown, fallback: number) => {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function normalizePricingDefaults(raw: any): PricingDefaults {
  const base = BUILT_IN_PRICING_DEFAULTS;
  const meals = raw?.mealPrices || {};
  return {
    mealPrices: {
      breakfast: finite(meals.breakfast, base.mealPrices.breakfast),
      lunch: finite(meals.lunch, base.mealPrices.lunch),
      dinner: finite(meals.dinner, base.mealPrices.dinner),
    },
    margin: {
      type: raw?.margin?.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
      percentage: finite(raw?.margin?.percentage, base.margin.percentage),
      fixed: finite(raw?.margin?.fixed, base.margin.fixed),
    },
    transportRates: raw?.transportRates && typeof raw.transportRates === 'object' ? raw.transportRates : {},
    peoplePerRoom: Number(raw?.peoplePerRoom) >= 1 ? Math.floor(Number(raw.peoplePerRoom)) : base.peoplePerRoom,
    mealPricesSet: ['breakfast', 'lunch', 'dinner'].every((meal) => finite(meals[meal], -1) >= 0),
  };
}

let request: Promise<PricingDefaults> | null = null;
let current: PricingDefaults | null = null;

export function loadPricingDefaults(): Promise<PricingDefaults> {
  request ||= adminAPI.getPricingDefaults()
    .then((response: any) => {
      current = normalizePricingDefaults(response?.data?.pricingDefaults);
      return current;
    })
    .catch(() => {
      request = null;
      return BUILT_IN_PRICING_DEFAULTS;
    });
  return request;
}

/** Call after Settings change so the next editor reads the new prices. */
export function invalidatePricingDefaults() {
  request = null;
  current = null;
}

export function usePricingDefaults(): PricingDefaults {
  const [defaults, setDefaults] = useState<PricingDefaults>(current ?? BUILT_IN_PRICING_DEFAULTS);
  useEffect(() => {
    let active = true;
    loadPricingDefaults().then((value) => { if (active) setDefaults(value); });
    return () => { active = false; };
  }, []);
  return defaults;
}

export const marginValueFor = (defaults: PricingDefaults, type: MarginType) =>
  (type === 'FIXED' ? defaults.margin.fixed : defaults.margin.percentage);

/**
 * Value for a package margin switched to `nextType`: the number last used for that type
 * while editing, else the Settings value for it. Remembers the current number under its type.
 */
export function switchMarginValue(
  current: { type: MarginType; value: number },
  nextType: MarginType,
  remembered: Partial<Record<MarginType, number>>,
  defaults: PricingDefaults,
) {
  remembered[current.type] = current.value;
  return remembered[nextType] ?? marginValueFor(defaults, nextType);
}

/**
 * Settings rate for a vehicle: for `pricingModel`, or its default model when omitted.
 * Null for FLIGHT, unset vehicles, and models without a rate.
 */
export function transportRateFor(defaults: PricingDefaults, mode: string, pricingModel?: string): TransportRate | null {
  const rates = defaults.transportRates?.[mode];
  if (!rates) return null;
  const model = (pricingModel || rates.pricingModel) as PricingModel;
  const unitCost = Number(rates[model]);
  return unitCost > 0 ? { pricingModel: model, unitCost } : null;
}

/** Passengers one vehicle carries, from Settings; null when not set there. */
export function seatsFor(defaults: PricingDefaults, mode: string): number | null {
  const seats = Number(defaults.transportRates?.[mode]?.seats);
  return seats > 0 ? seats : null;
}

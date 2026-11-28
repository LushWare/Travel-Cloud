import { DEFAULTS } from './config.js';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
const NO_PRICES = { breakfast: 0, lunch: 0, dinner: 0 };

const price = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Default price of each meal: the agency's Settings prices, else one flat
 * `mealCostPerPerson` for all three, else 0 (never a made-up price).
 */
export function resolveMealPrices({ mealPrices, mealCostPerPerson } = {}) {
  const flat = price(mealCostPerPerson);
  return Object.fromEntries(MEALS.map((meal) => [
    meal,
    price(mealPrices?.[meal]) ?? flat ?? 0,
  ]));
}

/** One day's price per meal: its own price for that meal, else its old single price, else the default. */
export function dayMealPrices(day = {}, defaults = NO_PRICES) {
  const legacy = price(day.mealPriceOverride);
  return Object.fromEntries(MEALS.map((meal) => [
    meal,
    price(day[`${meal}PriceOverride`]) ?? legacy ?? defaults[meal],
  ]));
}

export function dayMealCostPerPerson(day = {}, defaults = NO_PRICES) {
  const prices = dayMealPrices(day, defaults);
  return MEALS.reduce((sum, meal) => sum + (Number(day[`${meal}Count`]) || 0) * prices[meal], 0);
}

/**
 * @param {Array<{breakfastCount?, lunchCount?, dinnerCount?, breakfastPriceOverride?, lunchPriceOverride?, dinnerPriceOverride?, mealPriceOverride?}>} days
 * @param {{ mealPrices?: {breakfast?, lunch?, dinner?}, mealCostPerPerson?: number, groupSize?: number }} config
 */
export function calculateMealCosts(days, config = {}) {
  const defaults = resolveMealPrices(config);
  const groupSize = config.groupSize ?? DEFAULTS.defaultGroupSize;
  const totals = { breakfast: 0, lunch: 0, dinner: 0 };

  for (const day of days) {
    const prices = dayMealPrices(day, defaults);
    for (const meal of MEALS) {
      totals[meal] += (Number(day[`${meal}Count`]) || 0) * prices[meal] * groupSize;
    }
  }

  return {
    total: totals.breakfast + totals.lunch + totals.dinner,
    breakfastCost: totals.breakfast,
    lunchCost: totals.lunch,
    dinnerCost: totals.dinner,
  };
}

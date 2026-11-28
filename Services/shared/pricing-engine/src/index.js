import { calculateMealCosts, resolveMealPrices, dayMealPrices, dayMealCostPerPerson, MEALS } from './meals.js';
import { calculateAccommodationCosts } from './accommodation.js';
import { calculateTransportCosts } from './transport.js';
import { calculateActivityCosts } from './activities.js';
import { computeMargin } from './margin.js';
import { DEFAULTS } from './config.js';

/**
 * @param {Object} params
 * @param {Array} params.days — day objects with breakfastCount/lunchCount/dinnerCount/mealPriceOverride
 * @param {Array} params.activities — [{defaultCost, costOverride?}]
 * @param {Array} params.transports — [{pricingModel, unitCost, distanceKm?}]
 * @param {Array} params.accommodation — per-day amounts (number or { totalAmount })
 * @param {number} [params.groupSize] — defaults to 1
 * @param {number} [params.mealCostPerPerson] — one price for every meal (no default)
 * @param {'PERCENTAGE'|'FIXED'} [params.marginType] — if omitted, margin not computed
 * @param {number} [params.marginValue]
 * @returns {{ basePrice: number, breakdown: { meals, activities, transports, margin? } }}
 */
export function calculateBasePrice({
  days = [],
  activities = [],
  transports = [],
  accommodation = [],
  groupSize,
  mealCostPerPerson,
  mealPrices,
  marginType,
  marginValue,
} = {}) {
  const config = {
    groupSize: groupSize ?? DEFAULTS.defaultGroupSize,
    mealCostPerPerson,
    mealPrices,
  };

  const meals = calculateMealCosts(days, config);
  const activityResult = calculateActivityCosts(activities, config);
  const transportResult = calculateTransportCosts(transports, config);
  const accommodationResult = calculateAccommodationCosts(accommodation);

  const basePrice =
    Math.round(
      (meals.total + activityResult.total + transportResult.total + accommodationResult.total) * 100,
    ) / 100;

  const result = {
    basePrice,
    breakdown: {
      meals,
      activities: activityResult,
      transports: transportResult,
      accommodation: accommodationResult,
    },
  };

  if (marginType != null && marginValue != null) {
    result.breakdown.margin = computeMargin(basePrice, marginType, marginValue);
  }

  return result;
}

export { calculatePackagePrice, STANDARD_OCCUPANCY, PEOPLE_PER_ROOM } from './package-price.js';
export { mealsIncludedByBoard, chargeableMealDays } from './board.js';
export { packagePriceFromDays } from './itinerary-price.js';

export {
  calculateMealCosts,
  resolveMealPrices,
  dayMealPrices,
  dayMealCostPerPerson,
  MEALS,
  calculateAccommodationCosts,
  calculateTransportCosts,
  calculateActivityCosts,
  computeMargin,
  DEFAULTS,
};
export { singleSupplementFromDays } from './single-supplement.js';

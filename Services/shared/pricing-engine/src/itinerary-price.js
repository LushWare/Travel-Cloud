import { calculatePackagePrice } from './package-price.js';
import { chargeableMealDays } from './board.js';
import { resolveMealPrices, dayMealPrices, dayMealCostPerPerson } from './meals.js';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const toOverride = (value) => (value === null || value === undefined || value === '' ? null : toNumber(value));

/**
 * @param {Array<any>} [days]
 * @param {{ marginType?: 'PERCENTAGE'|'FIXED'|null, marginValue?: number, mealCostPerPerson?: number, mealPrices?: {breakfast?: number, lunch?: number, dinner?: number} }} [options]
 */
export function packagePriceFromDays(days = [], { marginType = null, marginValue = 0, mealCostPerPerson, mealPrices } = {}) {
  const list = (days || []).filter(Boolean);
  const defaultMealPrices = resolveMealPrices({ mealPrices, mealCostPerPerson });

  const mealDays = list.map((d) => ({
    dayNumber: d.dayNumber,
    breakfastCount: toNumber(d.breakfastCount),
    lunchCount: toNumber(d.lunchCount),
    dinnerCount: toNumber(d.dinnerCount),
    mealPriceOverride: toOverride(d.mealPriceOverride),
    breakfastPriceOverride: toOverride(d.breakfastPriceOverride),
    lunchPriceOverride: toOverride(d.lunchPriceOverride),
    dinnerPriceOverride: toOverride(d.dinnerPriceOverride),
    accommodation: { totalAmount: toNumber(d.accommodation?.totalAmount), boardType: d.accommodation?.boardType ?? null },
  }));

  const activities = list.flatMap((d) => (d.activities || []).map((a) => {
    const item = typeof a === 'string' ? { name: a } : (a || {});
    const defaultCost = toNumber(item.defaultCost ?? item.activity?.defaultCost);
    const costOverride = toOverride(item.costOverride);
    return {
      dayNumber: d.dayNumber,
      name: item.name || item.activity?.name || 'Activity',
      defaultCost,
      costOverride,
      costPerPerson: costOverride ?? defaultCost,
    };
  }));

  const transports = list.flatMap((d) => (d.transports || []).map((t) => ({
    dayNumber: d.dayNumber,
    transportMode: t.transportMode ?? null,
    pricingModel: t.pricingModel || 'PER_VEHICLE',
    unitCost: toNumber(t.unitCost),
    distanceKm: t.distanceKm === null || t.distanceKm === undefined || t.distanceKm === '' ? null : toNumber(t.distanceKm),
  })));

  const hotels = list.map((d) => ({
    dayNumber: d.dayNumber,
    name: d.accommodation?.name || 'Accommodation',
    roomPrice: toNumber(d.accommodation?.totalAmount),
    roomType: d.accommodation?.roomType || null,
    boardType: d.accommodation?.boardType || null,
    hasHotel: Boolean(d.accommodation?.name),
  }));

  const price = calculatePackagePrice({
    days: mealDays,
    activities: activities.map(({ defaultCost, costOverride }) => ({ defaultCost, costOverride })),
    transports,
    accommodation: hotels.map((h) => h.roomPrice),
    mealPrices: defaultMealPrices,
    marginType,
    marginValue,
  });

  const meals = chargeableMealDays(mealDays).map((d) => ({
    ...d,
    mealPrices: dayMealPrices(d, defaultMealPrices),
    costPerPerson: dayMealCostPerPerson(d, defaultMealPrices),
  }));

  return {
    ...price,
    // A named hotel without a price is listed too, so a missing price is visible rather than silently skipped.
    rows: { meals, activities, transports, hotels: hotels.filter((h) => h.roomPrice > 0 || h.hasHotel).map(({ hasHotel, ...h }) => h) },
  };
}

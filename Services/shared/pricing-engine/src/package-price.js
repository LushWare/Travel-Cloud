import { calculateMealCosts } from './meals.js';
import { calculateActivityCosts } from './activities.js';
import { calculateTransportCosts } from './transport.js';
import { calculateAccommodationCosts } from './accommodation.js';
import { computeMargin } from './margin.js';
import { DEFAULTS } from './config.js';
import { chargeableMealDays } from './board.js';

/** People per room assumed for the advertised ("twin sharing") price. */
export const STANDARD_OCCUPANCY = 2;
export const PEOPLE_PER_ROOM = 2;

const round2 = (n) => Math.round(n * 100) / 100;
function costForParty({ days, activities, transports, accommodation, travelers, mealCostPerPerson, mealPrices }) {
  const config = { groupSize: travelers, mealCostPerPerson, mealPrices };
  const meals = calculateMealCosts(days, config);
  const activityResult = calculateActivityCosts(activities, config);
  const transportResult = calculateTransportCosts(transports, config);
  const rooms = Math.ceil(travelers / PEOPLE_PER_ROOM);
  const roomNights = calculateAccommodationCosts(accommodation);
  const accommodationTotal = round2(roomNights.total * rooms);

  const total = round2(meals.total + activityResult.total + transportResult.total + accommodationTotal);
  return {
    travelers,
    rooms,
    total,
    perPerson: round2(total / travelers),
    breakdown: {
      meals: round2(meals.total),
      activities: round2(activityResult.total),
      transports: round2(transportResult.total),
      accommodation: accommodationTotal,
    },
  };
}

/**
 * Package price the way agencies advertise it: per person, based on two people
 * sharing a room ("twin sharing"), with hotel and vehicle costs split between
 * them. Also returns the single-traveller price (one person pays the whole
 * room and vehicle), so the editor can show both.
 *
 * Accommodation entries are each day's price for ONE room for that night
 * (a number or { totalAmount }).
 *
 * `perPerson` (cost per person, twin sharing) is what gets stored as the
 * package basePrice; `sellPerPerson` adds the margin; `party` holds the
 * totals for the two people sharing.
 *
 * @param {Object} [params]
 * @param {Array} [params.days]
 * @param {Array} [params.activities]
 * @param {Array} [params.transports]
 * @param {Array<number|{totalAmount?: number}>} [params.accommodation]
 * @param {number} [params.mealCostPerPerson]
 * @param {{breakfast?: number, lunch?: number, dinner?: number}} [params.mealPrices]
 * @param {'PERCENTAGE'|'FIXED'|null} [params.marginType]
 * @param {number} [params.marginValue]
 * @returns {{
 *   perPerson: number,
 *   sellPerPerson: number,
 *   occupancy: number,
 *   party: {
 *     travelers: number,
 *     rooms: number,
 *     total: number,
 *     perPerson: number,
 *     breakdown: { meals: number, activities: number, transports: number, accommodation: number },
 *   },
 *   single: { perPerson: number, sellPerPerson: number, total: number },
 *   margin: { type: string|null, value: number, amountPerPerson: number },
 * }}
 */
export function calculatePackagePrice({
  days = [],
  activities = [],
  transports = [],
  accommodation = [],
  mealCostPerPerson,
  mealPrices,
  marginType = null,
  marginValue = 0,
} = {}) {
  // Meals the hotel's meal plan already includes are not charged again.
  // Days carry `boardType` (or `accommodation.boardType`) for that night.
  const inputs = { days: chargeableMealDays(days), activities, transports, accommodation, mealCostPerPerson, mealPrices };
  const party = costForParty({ ...inputs, travelers: STANDARD_OCCUPANCY });
  const single = costForParty({ ...inputs, travelers: 1 });

  const applyMargin = (cost) => (marginType ? computeMargin(cost, marginType, Number(marginValue) || 0) : { sellPrice: cost, marginAmount: 0 });
  const twin = applyMargin(party.perPerson);
  const solo = applyMargin(single.perPerson);

  return {
    perPerson: party.perPerson,
    sellPerPerson: twin.sellPrice,
    occupancy: STANDARD_OCCUPANCY,
    party,
    single: { perPerson: single.perPerson, sellPerPerson: solo.sellPrice, total: single.total },
    margin: { type: marginType, value: Number(marginValue) || 0, amountPerPerson: twin.marginAmount },
  };
}

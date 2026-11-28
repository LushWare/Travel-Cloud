import { chargeableMealDays } from '../../pricing-engine/src/board.js';
import { resolveMealPrices, dayMealCostPerPerson } from '../../pricing-engine/src/meals.js';
import { vehiclesNeeded } from '../../constants/src/index.js';
import { toCents, fromCents } from './money.js';

/** People per standard hotel room when a room price is quoted per room. */
const PEOPLE_PER_ROOM = 2;

/**
 * Resolve the effective quantity of a line:
 *  - PER_PERSON lines scale with travelers;
 *  - PER_KM uses the distance as quantity;
 *  - PER_VEHICLE / PER_ROOM / FIXED use their own quantity (default 1).
 */
export function resolveQuantity(line, travelers) {
  if (line.basis === 'PER_PERSON') {
    return Math.max(1, Number(travelers) || 1);
  }
  return Number(line.quantity) || 1;
}

/**
 * Compute a single cost line. Margin is applied to the unit price:
 *  - PERCENTAGE: estimatedUnit * (1 + value/100)
 *  - FIXED:      estimatedUnit + value
 * A line without marginType is priced at cost.
 */
export function computeLine(line, { travelers = 1 } = {}) {
  const quantity = resolveQuantity(line, travelers);
  const estimatedUnitCents = toCents(line.estimatedUnit);
  const marginType = line.marginType || null;
  const marginValue = Number(line.marginValue) || 0;

  let quotedUnitCents = estimatedUnitCents;
  if (marginType === 'PERCENTAGE') {
    quotedUnitCents = Math.round((estimatedUnitCents * (100 + marginValue)) / 100);
  } else if (marginType === 'FIXED') {
    quotedUnitCents = estimatedUnitCents + toCents(marginValue);
  }

  const actualTotal =
    line.actualUnit != null
      ? fromCents(toCents(line.actualUnit) * quantity)
      : null;

  return {
    ...line,
    quantity,
    estimatedUnitPrice: fromCents(estimatedUnitCents),
    quotedUnitPrice: fromCents(quotedUnitCents),
    estimatedTotal: fromCents(estimatedUnitCents * quantity),
    actualTotal,
    sellTotal: fromCents(quotedUnitCents * quantity),
    margin: marginType ? { type: marginType, value: marginValue } : null,
  };
}

/**
 * Map a lead's itinerary (days/activities/transports/accommodation) into AUTO
 * cost lines for a party of `travelers`:
 *  - meals and activities are per person (meals the hotel's meal plan already
 *    includes are left out);
 *  - a vehicle (PER_VEHICLE / PER_KM) is shared, and a party too big for one
 *    gets as many vehicles as it needs;
 *  - a hotel price the rep searched for the whole party
 *    (`accommodation.priceCovers === 'PARTY'`) is charged once as is; any other
 *    room price is one room for the night, charged per room needed
 *    (`peoplePerRoom`, default two). Vehicle seats come from `vehicleSeats`
 *    (Settings), else the built-in capacity.
 *
 * Room and vehicle counts depend on `travelers`, so the lines must be rebuilt
 * when the party size changes.
 */
export function buildItineraryCostLines({
  days = [],
  activities = [],
  transports = [],
  mealCostPerPerson,
  mealPrices,
  vehicleSeats,
  peoplePerRoom,
  travelers = 1,
} = {}) {
  const defaultMealPrices = resolveMealPrices({ mealPrices, mealCostPerPerson });
  const party = Math.max(1, Number(travelers) || 1);
  const roomSize = Number(peoplePerRoom) >= 1 ? Math.floor(Number(peoplePerRoom)) : PEOPLE_PER_ROOM;
  const lines = [];

  // Per-person meal estimate: each meal at the day's own price for it, else the default.
  const mealEstimate = chargeableMealDays(days)
    .reduce((sum, d) => sum + dayMealCostPerPerson(d, defaultMealPrices), 0);
  if (mealEstimate > 0) {
    lines.push({
      category: 'food',
      description: 'Meals',
      basis: 'PER_PERSON',
      estimatedUnit: mealEstimate,
      source: 'AUTO',
    });
  }

  (activities || []).forEach((a, i) => {
    lines.push({
      category: 'activity',
      description: a.name || `Activity ${i + 1}`,
      basis: 'PER_PERSON',
      estimatedUnit: a.costOverride ?? a.defaultCost ?? 0,
      source: 'AUTO',
    });
  });

  (transports || []).forEach((t, i) => {
    const isPerPerson = t.pricingModel === 'PER_PERSON';
    const isPerKm = t.pricingModel === 'PER_KM';
    const label = `Transport ${i + 1}`;
    const unitCost = Number(t.unitCost) || 0;
    if (isPerPerson) {
      lines.push({ category: 'transportation', description: label, basis: 'PER_PERSON', estimatedUnit: unitCost, source: 'AUTO' });
      return;
    }
    const vehicles = vehiclesNeeded(t.transportMode, party, vehicleSeats);
    const suffix = vehicles > 1 ? ` (${vehicles} vehicles)` : '';
    lines.push(isPerKm
      ? {
          // Quantity is the distance, so extra vehicles go into the per-km rate.
          category: 'transportation',
          description: `${label}${suffix}`,
          basis: 'PER_KM',
          estimatedUnit: unitCost * vehicles,
          quantity: Number(t.distanceKm) || 0,
          source: 'AUTO',
        }
      : {
          category: 'transportation',
          description: `${label}${suffix}`,
          basis: 'PER_VEHICLE',
          estimatedUnit: unitCost,
          quantity: vehicles,
          source: 'AUTO',
        });
  });

  const rooms = Math.ceil(party / roomSize);
  (days || []).forEach((d, i) => {
    const amount = Number(d.accommodation?.totalAmount || 0);
    if (amount <= 0) return;
    const coversParty = d.accommodation?.priceCovers === 'PARTY';
    lines.push(coversParty
      ? {
          category: 'accommodation',
          description: `Accommodation day ${i + 1} (whole party)`,
          basis: 'FIXED',
          estimatedUnit: amount,
          quantity: 1,
          source: 'AUTO',
        }
      : {
          category: 'accommodation',
          description: `Accommodation day ${i + 1}${rooms > 1 ? ` (${rooms} rooms)` : ''}`,
          basis: 'PER_ROOM',
          estimatedUnit: amount,
          quantity: rooms,
          source: 'AUTO',
        });
  });

  return lines;
}

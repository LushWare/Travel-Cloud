import { STANDARD_OCCUPANCY } from './package-price.js';

const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100 + 0;

/**
 * Extra a traveller alone pays over the advertised twin-sharing price: the
 * other half of every room and vehicle, plus margin on it when the margin is
 * a percentage. Meals, activities and per-person tickets don't change.
 */
export function singleSupplementFromDays(days = [], { marginType = null, marginValue = 0 } = {}) {
  const share = (STANDARD_OCCUPANCY - 1) / STANDARD_OCCUPANCY;
  let rooms = 0;
  let vehicles = 0;
  for (const day of days || []) {
    if (!day) continue;
    rooms += amount(day.accommodation?.totalAmount) * share;
    for (const t of day.transports || []) {
      if (t.pricingModel === 'PER_VEHICLE') vehicles += amount(t.unitCost) * share;
      else if (t.pricingModel === 'PER_KM') vehicles += amount(t.unitCost) * amount(t.distanceKm) * share;
    }
  }
  const extra = rooms + vehicles;
  const margin = marginType === 'PERCENTAGE' ? extra * (Number(marginValue) || 0) / 100 : 0;
  return { rooms: round2(rooms), vehicles: round2(vehicles), margin: round2(margin), total: round2(extra + margin) };
}

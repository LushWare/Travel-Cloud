/**
 * Shared travel-CRM constants — single source of truth.
 *
 * The Prisma schema (package-service) mirrors these values; a consistency test
 * in this package asserts they never drift. Consumers:
 *   - Management frontend (@travel-crm/constants file dependency)
 *   - package-service validators (relative import)
 *   - pricing-engine (relative import for PRICING_MODEL)
 */

// ─── Enums ────────────────────────────────────────────────────

export const ROUTE_TYPE = {
  DAILY_ROUTING: 'DAILY_ROUTING',
  POINT_TO_POINT: 'POINT_TO_POINT',
};

export const TRANSPORT_MODE = {
  FLIGHT: 'FLIGHT',
  CAR: 'CAR',
  TRAIN: 'TRAIN',
  BOAT: 'BOAT',
  VAN: 'VAN',
  BUS: 'BUS',
};

export const PRICING_MODEL = {
  PER_KM: 'PER_KM',
  PER_PERSON: 'PER_PERSON',
  PER_VEHICLE: 'PER_VEHICLE',
};

export const PRICING_BASIS = {
  PER_PERSON: 'PER_PERSON',
  PER_ROOM: 'PER_ROOM',
  PER_VEHICLE: 'PER_VEHICLE',
  PER_KM: 'PER_KM',
  FIXED: 'FIXED',
};

export const MARGIN_TYPE = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
};

export const COST_LINE_SOURCE = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
};

export const OPTIONAL_FLIGHT_TYPE = {
  TO_START: 'TO_START',
  RETURN_HOME: 'RETURN_HOME',
};

export const ACTOR = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
};

// Tax comes from Settings (OrganizationSettings.defaultTaxRate), never a built-in rate.
export const PRICING = {
  DEFAULT_CURRENCY: 'USD',
};

/**
 * Cost line categories — must stay aligned with the billing-service
 * ItemCategory enum (asserted by test). FLIGHT lines use 'transportation'.
 */
export const COST_LINE_CATEGORY = {
  ACCOMMODATION: 'accommodation',
  TRANSPORTATION: 'transportation',
  ACTIVITY: 'activity',
  FOOD: 'food',
  GUIDE: 'guide',
  INSURANCE: 'insurance',
  VISA: 'visa',
  PACKAGE: 'package',
  OTHER: 'other',
};

// ─── Labels ───────────────────────────────────────────────────

export const TRANSPORT_MODE_LABELS = {
  CAR: 'Car',
  VAN: 'Van',
  FLIGHT: 'Flight',
  TRAIN: 'Train',
  BUS: 'Bus',
  BOAT: 'Boat',
};

export const PRICING_MODEL_LABELS = {
  PER_VEHICLE: 'Per vehicle',
  PER_PERSON: 'Per person',
  PER_KM: 'Per km',
};

export const PRICING_BASIS_LABELS = {
  PER_PERSON: 'Per person',
  PER_ROOM: 'Per room',
  PER_VEHICLE: 'Per vehicle',
  PER_KM: 'Per km',
  FIXED: 'Fixed',
};

export const MARGIN_TYPE_LABELS = {
  PERCENTAGE: 'Percentage',
  FIXED: 'Fixed amount',
};

export const COST_LINE_SOURCE_LABELS = {
  AUTO: 'Auto',
  MANUAL: 'Manual',
};

export const OPTIONAL_FLIGHT_TYPE_LABELS = {
  TO_START: 'To start',
  RETURN_HOME: 'Return home',
};

export const COST_LINE_CATEGORY_LABELS = {
  ACCOMMODATION: 'Accommodation',
  TRANSPORTATION: 'Transportation',
  ACTIVITY: 'Activity',
  FOOD: 'Food',
  GUIDE: 'Guide',
  INSURANCE: 'Insurance',
  VISA: 'Visa',
  PACKAGE: 'Package',
  OTHER: 'Other',
};

// ─── Per-mode pricing defaults ────────────────────────────────

export const TRANSPORT_PRICING_DEFAULTS = {
  CAR: 'PER_KM',
  VAN: 'PER_KM',
  FLIGHT: 'PER_PERSON',
  TRAIN: 'PER_PERSON',
  BUS: 'PER_PERSON',
  BOAT: 'PER_PERSON',
};

/**
 * How many vehicles of `mode` a party of `travelers` needs (at least 1).
 * `seats` is the agency's Settings seats per vehicle; a vehicle without seats
 * set is counted once.
 */
export const vehiclesNeeded = (mode, travelers, seats = {}) => {
  const capacity = Number(seats?.[mode]) > 0 ? Number(seats[mode]) : null;
  const people = Math.max(1, Number(travelers) || 1);
  return capacity ? Math.ceil(people / capacity) : 1;
};

export const getDefaultPricingModel = (mode) =>
  TRANSPORT_PRICING_DEFAULTS[mode] || 'PER_VEHICLE';

export const createDefaultTransportRow = () => ({
  routeType: 'DAILY_ROUTING',
  transportMode: 'CAR',
  pricingModel: getDefaultPricingModel('CAR'),
  unitCost: 0,
  distanceKm: null,
});

/**
 * Switching a row's mode: apply the mode's default pricing model, keep the
 * unit cost, and clear distance when the new pricing isn't PER_KM. Same-mode
 * changes are a no-op.
 */
export const applyTransportModeDefault = (row, mode) => {
  if (!row || row.transportMode === mode) return row;
  const nextPricing = getDefaultPricingModel(mode);
  return {
    ...row,
    transportMode: mode,
    pricingModel: nextPricing,
    distanceKm: nextPricing === 'PER_KM' ? row.distanceKm : null,
  };
};

/**
 * Manually changing the pricing model: keep the unit cost, clear distance when
 * leaving PER_KM.
 */
export const applyPricingModelChange = (row, pricingModel) => {
  if (!row || row.pricingModel === pricingModel) return row;
  return {
    ...row,
    pricingModel,
    distanceKm: pricingModel === 'PER_KM' ? row.distanceKm : null,
  };
};

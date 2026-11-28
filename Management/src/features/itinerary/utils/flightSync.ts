/**
 * Pure flight ↔ transport reconciliation helpers.
 *
 * Each flight links to its FLIGHT transport row through the editor-only
 * `flightRef`. These helpers keep flights[] and transports[] in sync without
 * side effects so the behavior can be exhaustively unit-tested. They are used
 * by ItineraryEditor (add/edit/remove) and by the save payload builder.
 */

import { getDefaultPricingModel } from '@travel-crm/constants';

export interface Flight {
  origin: string;
  destination: string;
  cabinClass: string;
  departureTime: string;
  airlinePreference: string;
  totalAmount: number;
  id: string;
  [key: string]: unknown;
}

export interface TransportRow {
  routeType: string;
  transportMode: string;
  pricingModel: string;
  unitCost: number;
  distanceKm: number | null;
  flightRef?: string | null;
  [key: string]: unknown;
}

export const isFlightIncomplete = (flight: Partial<Flight> | null | undefined): boolean => {
  if (!flight) return true;
  return !flight.origin || !flight.destination;
};

const createFlightId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `flight-${Date.now()}`;

const normalizeFlight = (flightData: Record<string, any> = {}): Flight => ({
  origin: flightData.origin || '',
  destination: flightData.destination || '',
  cabinClass: flightData.cabinClass || 'Economy',
  departureTime: flightData.departureTime || '',
  airlinePreference: flightData.airlinePreference || '',
  // A package has no dates or passengers yet, so its flight form asks for an
  // "Estimated Cost (per person)" — that estimate IS the flight's price here.
  totalAmount: Number(flightData.totalAmount ?? flightData.fareTotal ?? flightData.estimatedUnitPrice ?? 0) || 0,
  // Kept so the flight form shows the estimate again when the flight is edited.
  estimatedUnitPrice: Number(flightData.estimatedUnitPrice ?? flightData.totalAmount ?? flightData.fareTotal ?? 0) || 0,
  id: flightData.id || createFlightId(),
});

/**
 * Real price only: totalAmount > 0. Until the flight component returns real
 * prices (totalAmount is 0), manual costs typed in Costs & Pricing are the
 * working numbers and must be preserved.
 */
const flightPrice = (flight: Partial<Flight> | null | undefined): number | null => {
  const price = Number(flight?.totalAmount) || 0;
  return price > 0 ? price : null;
};

/**
 * Update the FLIGHT row for a flight: update its linked row's cost when a real
 * price exists; otherwise claim the first unlinked FLIGHT row (setting the
 * flightRef and the price when real); otherwise append a new linked row.
 */
const syncRowForFlight = (transports: TransportRow[], flight: Flight): TransportRow[] => {
  const price = flightPrice(flight);
  const linkedIndex = transports.findIndex(
    (row) => row.transportMode === 'FLIGHT' && row.flightRef === flight.id
  );

  if (linkedIndex >= 0) {
    if (price == null) return transports;
    return transports.map((row, i) =>
      i === linkedIndex ? { ...row, unitCost: price } : row
    );
  }

  const orphanIndex = transports.findIndex(
    (row) => row.transportMode === 'FLIGHT' && !row.flightRef
  );
  if (orphanIndex >= 0) {
    return transports.map((row, i) =>
      i === orphanIndex
        ? { ...row, flightRef: flight.id, ...(price == null ? {} : { unitCost: price }) }
        : row
    );
  }

  return [...transports, {
    routeType: 'DAILY_ROUTING',
    transportMode: 'FLIGHT',
    pricingModel: getDefaultPricingModel('FLIGHT'),
    unitCost: price ?? 0,
    distanceKm: null,
    flightRef: flight.id,
  }];
};

export interface FlightsTransportsState {
  flights: Flight[];
  transports: TransportRow[];
}

/**
 * Adding a flight: if an incomplete flight (missing origin/destination) exists,
 * replace it in place (keeping its id so any linked row stays attached);
 * otherwise append. The FLIGHT transport row is then synced (claim orphan or
 * append). Returns { flights, transports }.
 */
export const resolveFlightAdd = ({
  flights = [],
  transports = [],
  flightData = {},
}: {
  flights?: Flight[];
  transports?: TransportRow[];
  flightData?: Record<string, any>;
}): FlightsTransportsState => {
  const flight = normalizeFlight(flightData);
  const incompleteIndex = flights.findIndex(isFlightIncomplete);

  let nextFlights: Flight[];
  let targetFlight: Flight;
  if (incompleteIndex >= 0) {
    targetFlight = { ...flight, id: flights[incompleteIndex].id };
    nextFlights = flights.map((f, i) => (i === incompleteIndex ? targetFlight : f));
  } else {
    targetFlight = flight;
    nextFlights = [...flights, flight];
  }

  return {
    flights: nextFlights,
    transports: syncRowForFlight(transports, targetFlight),
  };
};

/**
 * Editing a flight: replace the flight at index in place (id unchanged) and
 * re-sync its row. Unknown/out-of-range index is a no-op.
 */
export const resolveFlightEdit = ({
  flights = [],
  transports = [],
  index,
  patch = {},
}: {
  flights?: Flight[];
  transports?: TransportRow[];
  index?: number | null;
  patch?: Partial<Flight>;
}): FlightsTransportsState => {
  if (index == null || index < 0 || index >= flights.length) {
    return { flights, transports };
  }
  const flight = { ...flights[index], ...patch, id: flights[index].id };
  // A new estimate from the flight form replaces the flight's price.
  if (patch.estimatedUnitPrice !== undefined) {
    flight.totalAmount = Number(patch.estimatedUnitPrice) || 0;
  }
  return {
    flights: flights.map((f, i) => (i === index ? flight : f)),
    transports: syncRowForFlight(transports, flight),
  };
};

/**
 * Removing a flight removes the flight and every transport row linked to it.
 */
export const resolveFlightRemove = ({
  flights = [],
  transports = [],
  flightId,
}: {
  flights?: Flight[];
  transports?: TransportRow[];
  flightId?: string | null;
}): FlightsTransportsState => {
  if (!flightId) return { flights, transports };
  return {
    flights: flights.filter((f) => f.id !== flightId),
    transports: transports.filter((row) => !(row.flightRef && row.flightRef === flightId)),
  };
};

/**
 * Number of FLIGHT rows with no linked flight — powers the "add flight
 * details" callout in Costs & Pricing.
 */
export const countUnlinkedFlightRows = (transports: TransportRow[] = []): number =>
  transports.filter((row) => row.transportMode === 'FLIGHT' && !row.flightRef).length;

/**
 * Save-time reconciliation ("flight price wins on save", preserving manual
 * costs until a real price exists): manual non-flight rows and orphan FLIGHT
 * rows are kept untouched; each linked flight contributes one FLIGHT row with
 * unitCost = real price when > 0, else the row's existing manual cost, else 0.
 */
/**
 * Link FLIGHT rows that have lost their editor link (every row of a package
 * loaded from the API) to the day's flights, in order — the same pairing the
 * editor shows. Without this, reconcileFlightsForSave treats the old row as a
 * separate manual cost AND adds a row for the flight, so the flight is counted
 * twice and every save appends another FLIGHT row.
 */
export const linkFlightRows = <T extends Partial<TransportRow>>(rows: T[] = [], flights: Flight[] = []): T[] => {
  const alreadyLinked = new Set(rows.map((row) => row.flightRef).filter(Boolean));
  const freeFlights = flights.filter((flight) => flight?.id && !alreadyLinked.has(flight.id));
  let next = 0;
  return rows.map((row) => (
    row.transportMode === 'FLIGHT' && !row.flightRef && freeFlights[next]
      ? { ...row, flightRef: freeFlights[next++].id }
      : row
  ));
};

/**
 * The transport rows a day is priced and saved with: FLIGHT rows linked to
 * their flights, each flight counted once at its real fare when it has one.
 * The price panel and the save/price payload both use this, so they agree.
 */
export const pricedDayTransports = (flights: Flight[] = [], transports: TransportRow[] = []): TransportRow[] =>
  reconcileFlightsForSave({ flights, transports: linkFlightRows(transports, flights) });

export const reconcileFlightsForSave = ({
  flights = [],
  transports = [],
}: {
  flights?: Flight[];
  transports?: TransportRow[];
}): TransportRow[] => {
  const linkedFlightRefs = new Set(flights.map((f) => f.id));
  const manualTransports = transports.filter(
    (row) => row.transportMode !== 'FLIGHT' || !(row.flightRef && linkedFlightRefs.has(row.flightRef))
  );

  const flightTransports = flights.map((flight) => {
    const price = flightPrice(flight);
    const linkedRow = transports.find(
      (row) => row.transportMode === 'FLIGHT' && row.flightRef && row.flightRef === flight.id
    );
    return {
      routeType: 'DAILY_ROUTING',
      transportMode: 'FLIGHT',
      pricingModel: linkedRow?.pricingModel || getDefaultPricingModel('FLIGHT'),
      unitCost: price != null ? price : (linkedRow ? (Number(linkedRow.unitCost) || 0) : 0),
      distanceKm: null,
    };
  });

  return [...manualTransports, ...flightTransports];
};

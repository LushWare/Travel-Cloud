/**
 * Leg/route derivation for a normalized offer's flat segment list.
 *
 * A round trip arrives as one flat list (outbound segments then return
 * segments); the outbound leg ends the first time the journey reaches the
 * searched destination — reaching it ends the slice, so that is the only
 * place the list can turn around.
 */
export interface FlightSegmentLike {
  origin?: string;
  destination?: string;
  originTerminal?: string | null;
  destinationTerminal?: string | null;
  departureAt?: string;
  arrivalAt?: string;
  durationMinutes?: number;
  stops?: number;
  sequence?: number;
  marketingCarrier?: string;
  flightNumber?: string;
}

export function splitLegs(
  segments: FlightSegmentLike[] | undefined,
  turnPoint?: string,
): FlightSegmentLike[][] {
  const list = segments ?? [];
  if (list.length === 0) return [];
  if (!turnPoint) return [list];
  const end = list.findIndex((s) => s.destination === turnPoint);
  if (end < 0 || end === list.length - 1) return [list];
  return [list.slice(0, end + 1), list.slice(end + 1)];
}

export function legStops(leg: FlightSegmentLike[]): number {
  return Math.max(leg.length - 1, 0);
}

export function legDurationMinutes(leg: FlightSegmentLike[]): number {
  return leg.reduce((sum, seg) => sum + (seg.durationMinutes || 0), 0);
}

/** Stops for the whole journey: every connection, on every leg. */
export function journeyStops(legs: FlightSegmentLike[][]): number {
  return legs.reduce((sum, leg) => sum + legStops(leg), 0);
}

/** The cities the journey touches, in order: "CMB → DXB → CMB". */
export function routeChain(segments: FlightSegmentLike[] | undefined): string {
  const path: string[] = [];
  for (const seg of segments ?? []) {
    if (seg.origin && path[path.length - 1] !== seg.origin) path.push(seg.origin);
    if (seg.destination && path[path.length - 1] !== seg.destination) path.push(seg.destination);
  }
  return path.join(' → ');
}

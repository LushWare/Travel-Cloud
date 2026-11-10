/**
 * crm_flights — the air bookings attached to the working book of business.
 *
 * A booking is only written for a lead that has crossed the pricing line, and
 * it is built as a return trip on one of the trunk routes this agency actually
 * sells (fixtures.ROUTES), so the Management Flights→Bookings tab, the lead's
 * Flight Bookings panel and the voucher Flight Segments section all read the
 * same itinerary rather than three loosely related rows.
 *
 * The lead side is deliberately edited last, by raw SQL, because
 * LeadOptionalFlight/LeadCostLine live in another service's schema and a
 * booking the lead cannot see would show up on the flights board but nowhere
 * else. Only rows still pointing at nothing are claimed; a link a human has
 * already set is left alone.
 */
import { addDays, addMinutes, isoDay, money } from '../lib/rng.mjs';

// ─── Fixture lookups ────────────────────────────────────────────────────────

/** Catalogue destination → the airport the traveller actually lands at. */
const ARRIVAL_AIRPORT = {
  'Sri Lanka': 'CMB',
  Maldives: 'MLE',
  Thailand: 'BKK',
  'Bali, Indonesia': 'DPS',
  'Dubai, UAE': 'DXB',
  Japan: 'NRT',
  Singapore: 'SIN',
  Vietnam: 'SGN',
  Nepal: 'KTM',
  Turkey: 'IST',
  'Türkiye': 'IST',
  Egypt: 'CAI',
  Morocco: 'CMN',
  Kenya: 'NBO',
  Bhutan: 'PBH',
  'Europe (UK, France, Netherlands, Italy)': 'LHR',
};

/**
 * A Sri Lanka itinerary ends where we live, so its flight is home → Colombo and
 * the mirror image of every other destination we sell. The gateway is the
 * nearest airport to the source market that appears on a trunk route.
 */
const HOME_GATEWAY = {
  'United Kingdom': 'LHR',
  Ireland: 'LHR',
  France: 'CDG',
  Germany: 'CDG',
  Netherlands: 'AMS',
  Italy: 'FCO',
  Spain: 'CDG',
  Sweden: 'AMS',
  Norway: 'AMS',
  Switzerland: 'FCO',
  'United Arab Emirates': 'DXB',
  'Saudi Arabia': 'DXB',
  India: 'DEL',
  China: 'SIN',
  Japan: 'NRT',
  'South Korea': 'NRT',
  Australia: 'SYD',
  'New Zealand': 'SYD',
  'United States': 'JFK',
  Canada: 'JFK',
  Kenya: 'NBO',
  Singapore: 'SIN',
  Malaysia: 'KUL',
};

/** Where each carrier connects through — used to shape long-haul itineraries. */
const CARRIER_HUB = {
  EK: 'DXB', QR: 'DOH', SQ: 'SIN', TK: 'IST', EY: 'AUH', BA: 'LHR', AF: 'CDG',
  KL: 'AMS', ET: 'ADD', KQ: 'NBO', CX: 'HKG', LH: 'FRA', TG: 'BKK', MH: 'KUL',
  AI: 'DEL', '6E': 'DEL', AK: 'KUL', D7: 'KUL', GF: 'BAH', WY: 'MCT',
  UL: 'CMB', '8D': 'CMB',
};

// ─── Booking policy ─────────────────────────────────────────────────────────

/** Leads whose paperwork is far enough along to have a real ticket behind it. */
const PREFERRED_LEAD_STATUSES = new Set(['CONFIRMED', 'APPROVED', 'BOOKING_IN_PROGRESS']);
/** Leads still being worked, used only to top the sample back up to 20–28. */
const SECONDARY_LEAD_STATUSES = new Set(['DRAFTING', 'QUOTED']);

// Must match FlightBookingStatus in flight-service's schema.
const ALL_FLIGHT_STATUSES = ['pending', 'confirmed', 'cancelled', 'failed'];
const FLIGHT_STATUS_WEIGHTS = [
  ['confirmed', 11],
  ['pending', 4],
  ['cancelled', 2],
  ['failed', 1],
];
/** A cancelled booking was confirmed once, so it keeps bookedAt. */
const HAS_BOOKED_AT = new Set(['confirmed', 'cancelled']);
/** Only live bookings get an airline record locator. */
const HAS_PNR = new Set(['confirmed']);

const CABIN_WEIGHTS = [['economy', 6], ['premium_economy', 2], ['business', 1]];
/** USD per km, plus a fixed sector fee — business ≈ 3.2× the economy rate. */
const CABIN_RATE = { economy: 0.09, premium_economy: 0.1575, business: 0.288 };

const PAX_CAP = 4;
const LONG_HAUL_KM = 4000;

const NOTES_FOR_STATUS = {
  pending: 'Order submitted to the airline; awaiting the supplier confirmation.',
  confirmed: 'Ticketed — e-ticket numbers were sent with the final travel documents.',
  cancelled: 'Cancelled before departure. Airline cancellation reference recorded on the file.',
  failed: 'Supplier rejected the order at ticketing; no ticket was issued and the fare was released.',
};

const CANCELLATION_REASONS = [
  'Traveller moved the holiday dates and rebooked on the new departure.',
  'Airline schedule change left a nine-hour connection; traveller declined the alternative.',
  'Visa application refused, so the ticket was cancelled before the deadline.',
  'Duplicate booking made in error and voided within the cooling-off window.',
];

const FALLBACK_NAMES = ['Alex Morgan', 'Sam Rivera', 'Jordan Blake', 'Taylor Reed', 'Casey Quinn'];
const SURNAMES = ['Perera', 'Fernando', 'Silva', 'Jayasuriya', 'Bennett', 'Müller'];

// ─── Seed entry point ───────────────────────────────────────────────────────

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('flights');
  const fx = ctx.fx;
  const plan = ctx.data?.leads?.plan ?? [];
  const customers = ctx.data?.users?.customers ?? [];
  const reps = ctx.data?.users?.reps ?? [];
  const admins = ctx.data?.users?.admins ?? [];

  if (!plan.length) throw new Error('flights: no leads available — run the leads step first');
  const staff = reps.length ? reps : admins;
  if (!staff.length) throw new Error('flights: no staff available to attribute bookings to');

  const customerByEmail = new Map(customers.map((c) => [String(c.email ?? '').toLowerCase(), c.id]));

  // Manual-itinerary leads have no package to sit behind the booking, so the
  // Flights tab would show a booking whose package link resolves to nothing.
  const bookable = (lead) => lead.selections?.some((s) => s.primary && s.packageId);

  const preferred = plan.filter((l) => PREFERRED_LEAD_STATUSES.has(l.status) && bookable(l));
  const secondary = plan.filter((l) => SECONDARY_LEAD_STATUSES.has(l.status) && bookable(l));

  const target = rng.int(20, 28);
  const chosen = rng.sample(preferred, Math.min(preferred.length, target));
  if (chosen.length < target) {
    chosen.push(...rng.sample(secondary, Math.min(secondary.length, target - chosen.length)));
  }

  // One of each status is seeded then shuffled, so the board never renders a
  // single-status column no matter where the weighted draws land.
  const statuses = [...ALL_FLIGHT_STATUSES];
  while (statuses.length < chosen.length) statuses.push(rng.weighted(FLIGHT_STATUS_WEIGHTS));
  statuses.length = chosen.length;
  shuffle(statuses, rng);

  const bookingRows = [];
  const segmentRows = [];
  const travelerRows = [];
  const links = []; // { bookingId, selectionId } for the lead-side back-fill

  for (let i = 0; i < chosen.length; i += 1) {
    const lead = chosen[i];
    const selection = lead.selections.find((s) => s.primary);
    const bookingId = ids.next('flightBooking');
    const status = statuses[i];

    const route = routeFor(lead, fx, rng);
    const cabinClass = rng.weighted(CABIN_WEIGHTS);
    const pax = Math.min(Math.max(Number(lead.pax) || 1, 1), PAX_CAP);

    // baseFare is the whole booking's fare, not a per-seat price: keeping one
    // number means the fare, tax and total cannot drift apart in the demo.
    const baseFare = money(route.km * CABIN_RATE[cabinClass] + 60);
    const taxes = money(baseFare * rng.money(0.18, 0.28));
    const totalAmount = money(baseFare + taxes);

    const bookedAt = HAS_BOOKED_AT.has(status) ? pastDate(lead.travelDate, rng.int(14, 60), now, rng) : null;
    const createdAt = bookedAt ? addDays(bookedAt, -rng.int(1, 6)) : addDays(now, -rng.int(1, 25));
    const ticketingDeadline = bookedAt ? ticketingDeadlineFor(bookedAt, status, now, rng) : null;

    const segments = buildSegments(route, lead, cabinClass, rng);

    bookingRows.push({
      id: bookingId,
      pnr: HAS_PNR.has(status) ? makePnr(rng) : null,
      travelportOrderId: status === 'pending' || status === 'failed'
        ? null
        : `TVP-${rng.int(10000000, 99999999)}`,
      createdById: lead.assignedToId ?? rng.pick(staff).id,
      customerId: customerByEmail.get(String(lead.email ?? '').toLowerCase()) ?? null,
      invoiceId: null,
      tripType: 'roundTrip',
      cabinClass,
      currency: 'USD',
      baseFare,
      taxes,
      totalAmount,
      status,
      searchSnapshot: buildSnapshot({
        bookingId,
        airline: airlineName(fx, segments),
        route,
        segments,
        cabinClass,
        baseFare,
        taxes,
        totalAmount,
        pax,
        capturedAt: bookedAt ?? now,
      }),
      ticketingDeadline,
      bookedAt,
      cancelledAt: status === 'cancelled' ? pastDate(bookedAt, rng.int(1, 20), now, rng) : null,
      cancellationReason: status === 'cancelled' ? rng.pick(CANCELLATION_REASONS) : null,
      notes: NOTES_FOR_STATUS[status],
      leadId: lead.id,
      packageId: selection.packageId,
      customizedPackageId: null,
      dayNumber: 1,
      flightType: 'itinerary',
      createdAt,
    });

    for (const segment of segments) segmentRows.push({ id: ids.next('flightSegment'), flightBookingId: bookingId, ...segment });
    for (const traveler of buildTravelers({ lead, pax, ids, rng, now })) {
      travelerRows.push({ flightBookingId: bookingId, ...traveler });
    }

    links.push({ bookingId, selectionId: selection.id });
  }

  // ── Write ────────────────────────────────────────────────────────────────
  for (const row of bookingRows) {
    const { id, ...rest } = row;
    await db.flight.flightBooking.upsert({ where: { id }, update: rest, create: row });
  }

  // Segments and travelers have no unique key, so clear ours and rebuild rather
  // than letting a re-run double every leg.
  const bookingIds = bookingRows.map((r) => r.id);
  await db.flight.flightSegment.deleteMany({ where: { flightBookingId: { in: bookingIds } } });
  await db.flight.flightTraveler.deleteMany({ where: { flightBookingId: { in: bookingIds } } });
  if (segmentRows.length) await db.flight.flightSegment.createMany({ data: segmentRows, skipDuplicates: true });
  if (travelerRows.length) await db.flight.flightTraveler.createMany({ data: travelerRows, skipDuplicates: true });

  // ── Lead-side back-fill ───────────────────────────────────────────────────
  // Cross-schema, so raw SQL: point the lead's open optional flights and its
  // transportation cost line at the booking we just made, but never overwrite
  // a link that already exists.
  for (const link of links) {
    await db.sql.query(
      `UPDATE crm_leads."LeadOptionalFlight"
          SET "flightBookingId" = $1
        WHERE "leadPackageSelectionId" = $2
          AND "flightBookingId" IS NULL
          AND status IN ('PENDING', 'QUOTED')`,
      [link.bookingId, link.selectionId],
    );
    await db.sql.query(
      `UPDATE crm_leads."LeadCostLine"
          SET "flightBookingId" = $1
        WHERE "leadPackageSelectionId" = $2
          AND "flightBookingId" IS NULL
          AND category = 'transportation'`,
      [link.bookingId, link.selectionId],
    );
  }

  const summary = `${bookingRows.length} bookings · ${segmentRows.length} segments · ${travelerRows.length} travellers`;
  log(`    flights: ${summary}`);

  return {
    summary,
    bookings: bookingRows.map((b) => ({
      id: b.id,
      leadId: b.leadId,
      pnr: b.pnr,
      status: b.status,
      totalAmount: b.totalAmount,
      tripType: b.tripType,
      dayNumber: b.dayNumber,
    })),
  };
}

// ─── Route selection ────────────────────────────────────────────────────────

/** The trunk route this lead flies, mirrored for Sri Lanka departures. */
function routeFor(lead, fx, rng) {
  const arrival = ARRIVAL_AIRPORT[lead.destination] ?? 'CMB';
  if (arrival !== 'CMB') {
    const trunk = fx.ROUTES.find(([, to]) => to === arrival);
    if (trunk) return trunkPlan('CMB', arrival, trunk, rng);
  }
  // Traveller lands in Colombo: the sellable sector is their gateway into CMB.
  const gateway = HOME_GATEWAY[lead.fromCountry] ?? 'LHR';
  const trunk = fx.ROUTES.find(([, to]) => to === gateway) ?? rng.pick(fx.ROUTES);
  return trunkPlan(trunk[1], 'CMB', trunk, rng);
}

function trunkPlan(from, to, trunk, rng) {
  const [, , km, minutes, carriers] = trunk;
  const plan = { from, to, km, minutes, carriers };
  if (km < LONG_HAUL_KM) return plan;

  // Long-haul is sold as a through-ticket on the carrier's own hub, so the two
  // legs stay on one ticket instead of inventing a nonstop we do not operate.
  const connecting = carriers.filter((c) => CARRIER_HUB[c] && CARRIER_HUB[c] !== from && CARRIER_HUB[c] !== to);
  if (!connecting.length) return plan;
  const carrier = rng.pick(connecting);
  return { ...plan, carrier, hub: CARRIER_HUB[carrier] };
}

// ─── Itinerary construction ─────────────────────────────────────────────────

function buildSegments(route, lead, cabinClass, rng) {
  const outboundAt = atTime(lead.travelDate, rng.int(6, 22), rng.pick(['00', '15', '30', '45']));
  const inboundAt = atTime(lead.endDate, rng.int(6, 22), rng.pick(['00', '15', '30', '45']));

  const legs = [
    ...oneWay(route, route.from, route.to, outboundAt, rng),
    ...oneWay(route, route.to, route.from, inboundAt, rng),
  ];

  return legs.map((leg, index) => ({
    sequence: index + 1,
    marketingCarrier: leg.carrier,
    operatingCarrier: leg.operating,
    flightNumber: `${leg.carrier} ${rng.int(100, 999)}`,
    bookingClass: bookingClassFor(cabinClass, rng),
    origin: leg.origin,
    destination: leg.destination,
    departureAt: leg.departureAt,
    arrivalAt: leg.arrivalAt,
    durationMinutes: leg.minutes,
    stops: 0,
  }));
}

function oneWay(route, from, to, departAt, rng) {
  const carrier = route.carrier ?? rng.pick(route.carriers);
  const operating = rng.chance(0.85) ? carrier : rng.pick(route.carriers);

  if (!route.hub) {
    return [{ origin: from, destination: to, carrier, operating, minutes: route.minutes, departureAt: departAt, arrivalAt: addMinutes(departAt, route.minutes) }];
  }

  const firstMinutes = Math.round(route.minutes * rng.money(0.35, 0.5));
  const secondMinutes = route.minutes - firstMinutes + rng.int(5, 30);
  const firstArrival = addMinutes(departAt, firstMinutes);
  const secondDeparture = addMinutes(firstArrival, rng.int(60, 180));

  return [
    { origin: from, destination: route.hub, carrier, operating, minutes: firstMinutes, departureAt: departAt, arrivalAt: firstArrival },
    { origin: route.hub, destination: to, carrier, operating, minutes: secondMinutes, departureAt: secondDeparture, arrivalAt: addMinutes(secondDeparture, secondMinutes) },
  ];
}

/** The validating carrier is the one on the first segment, not whichever name happens to resolve. */
function airlineName(fx, segments) {
  const code = segments[0].marketingCarrier;
  return fx.AIRLINES[code] ?? code; // a handful of route codes predate AIRLINES
}

/** Mirrors the normalized Travelport offer the flight service stores at booking time. */
function buildSnapshot({ bookingId, airline, route, segments, cabinClass, baseFare, taxes, totalAmount, pax, capturedAt }) {
  return {
    provider: 'travelport',
    offerId: `TVP-${bookingId.slice(-10)}`,
    capturedAt: isoDay(capturedAt),
    airline,
    airlineCode: segments[0].marketingCarrier,
    cabinClass,
    currency: 'USD',
    baseFare,
    taxes,
    fareTotal: totalAmount,
    legCount: segments.length,
    tripType: 'roundTrip',
    passengers: pax,
    route: `${route.from}-${route.to}`,
    segments: segments.map((s) => ({
      sequence: s.sequence,
      marketingCarrier: s.marketingCarrier,
      operatingCarrier: s.operatingCarrier,
      flightNumber: s.flightNumber,
      bookingClass: s.bookingClass,
      origin: s.origin,
      destination: s.destination,
      departureAt: s.departureAt.toISOString(),
      arrivalAt: s.arrivalAt.toISOString(),
      durationMinutes: s.durationMinutes,
      stops: s.stops,
    })),
  };
}

// ─── Travellers ─────────────────────────────────────────────────────────────

function buildTravelers({ lead, pax, ids, rng, now }) {
  const travelers = [];
  for (let i = 0; i < pax; i += 1) {
    // Family bookings carry one child; a lone traveller or a couple does not.
    const isChild = pax >= PAX_CAP && i === pax - 1;
    const { firstName, lastName } = splitName(lead.name, rng);
    const years = isChild ? rng.int(4, 15) : rng.int(26, 64);

    travelers.push({
      id: ids.next('flightTraveler'),
      type: isChild ? 'child' : 'adult',
      title: isChild ? rng.pick(['Mstr', 'Miss']) : rng.pick(['Mr', 'Ms', 'Mrs', 'Mx']),
      firstName,
      lastName,
      dob: addDays(now, -(years * 365 + rng.int(0, 364))),
      gender: rng.pick(['male', 'female']),
      passportNumber: `${rng.pick(['N', 'P', 'L', 'K'])}${rng.int(1000000, 9999999)}`,
      passportExpiry: addDays(lead.endDate, rng.int(200, 2500)),
      nationality: lead.fromCountry ?? 'Sri Lanka',
      frequentFlyerNumber: rng.chance(0.4) ? `${rng.pick(['UL', 'EK', 'QR', 'SQ'])}${rng.int(10000000, 99999999)}` : null,
    });
  }
  return travelers;
}

function splitName(name, rng) {
  const source = String(name ?? '').trim() || rng.pick(FALLBACK_NAMES);
  const parts = source.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || rng.pick(SURNAMES) };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function bookingClassFor(cabinClass, rng) {
  return cabinClass === 'business'
    ? rng.pick(['J', 'C', 'D', 'I'])
    : rng.pick(['Y', 'M', 'K', 'B', 'H', 'Q', 'V', 'W', 'S', 'L']);
}

/**
 * A confirmed booking's deadline is already behind it — a future ticketing
 * deadline beside an issued ticket is the kind of detail that makes a demo
 * look machine-written.
 */
function ticketingDeadlineFor(bookedAt, status, now, rng) {
  const deadline = addDays(bookedAt, rng.int(2, 7));
  return status === 'confirmed' && deadline > now ? now : deadline;
}

/** A date `days` before `anchor`, but never in the future. */
function pastDate(anchor, days, now, rng) {
  const candidate = addDays(anchor, -days);
  return candidate < now ? candidate : addDays(now, -rng.int(1, 10));
}

function atTime(date, hours, minutes) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, Number(minutes), 0, 0));
}

function makePnr(rng) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — real PNRs avoid look-alikes
  let pnr = '';
  for (let i = 0; i < 6; i += 1) pnr += alphabet[rng.int(0, alphabet.length - 1)];
  return pnr;
}

function shuffle(values, rng) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

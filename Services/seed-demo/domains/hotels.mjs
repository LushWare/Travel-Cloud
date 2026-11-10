/**
 * crm_packages.HotelBooking — the room-level bookings behind a lead.
 *
 * Distinct from booking-service's `Booking`, which is the commercial booking
 * for a whole itinerary: this is the per-hotel reservation an agent places with
 * a supplier, and it is what the Management Hotels screen and the lead's Hotel
 * Bookings section render. Nothing else in the seed creates one, so without
 * this the Hotels tab is permanently empty.
 *
 * HotelBooking has no unique key besides its primary key, so rows are removed
 * by the deterministic id prefix before being written — otherwise every re-run
 * would add a second stay per traveller.
 */
import { DESTINATIONS } from '../lib/destinations.mjs';
import { addDays, money } from '../lib/rng.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';

/** Statuses whose leads have had rooms held with a supplier. */
const STAY_STATUSES = { CONFIRMED: 'confirmed', BOOKING_IN_PROGRESS: 'confirmed', APPROVED: 'pending', CANCELLED: 'cancelled', BOOKING_FAILED: 'failed' };

const LABEL_TO_KEY = new Map(Object.entries(DESTINATIONS).map(([key, d]) => [d.label, key]));

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('hotels');
  const { plan } = ctx.data.leads;
  const { reps, admins } = ctx.data.users;

  // Own the whole table's demo range, so a re-run replaces rather than appends.
  await db.sql.query(`DELETE FROM crm_packages."HotelBooking" WHERE id LIKE $1`, [`${ownedPrefix('hotelBooking')}%`]);

  const eligible = plan.filter((l) => STAY_STATUSES[l.status]);
  const rows = [];

  for (const lead of eligible) {
    const selection = lead.selections.find((s) => s.packageId) ?? lead.selections[0];
    const destKey = LABEL_TO_KEY.get(lead.destination) ?? null;
    const profile = destKey ? DESTINATIONS[destKey] : null;
    if (!profile) continue;

    const assignedToId = lead.assignedToId ?? rng.pick(reps).id;
    // A stay per hotel change: most itineraries move two or three times.
    const stayCount = rng.weighted([[1, 5], [2, 4], [3, 1]]);
    const hotels = rng.sample(profile.hotels, Math.min(stayCount, profile.hotels.length));
    let cursor = lead.travelDate;

    for (let i = 0; i < hotels.length; i += 1) {
      const hotel = hotels[i];
      const nights = Math.max(1, Math.min(4, Math.round((profile.hotels.length && lead.endDate - lead.travelDate) / 86400000 / hotels.length) || 2));
      const checkin = cursor;
      const checkout = addDays(checkin, nights);
      cursor = checkout;

      const rooms = Math.max(1, Math.ceil(lead.pax / 2));
      const totalAmount = money(hotel.nightly * nights * rooms);
      const status = STAY_STATUSES[lead.status];

      const { first, last } = splitName(lead.name);
      rows.push({
        id: ids.next('hotelBooking'),
        liteapiBookingId: status === 'confirmed' ? `LTA-${rng.int(100000, 999999)}` : null,
        hotelId: `lp_${slugify(hotel.name)}`,
        hotelName: hotel.name,
        hotelAddress: `${hotel.city}, ${profile.country}`,
        hotelImage: `https://picsum.photos/seed/${slugify(hotel.name)}/800/500`,
        checkin,
        checkout,
        currency: 'USD',
        totalAmount,
        status,
        createdById: assignedToId,
        customerId: lead.customerId ?? null,
        guestInfo: Array.from({ length: Math.min(lead.pax, 4) }, (_, g) => ({
          firstName: g === 0 ? first : rng.pick(['Priya', 'Emma', 'Liam', 'Sofia', 'Daniel', 'Maya', 'Noah', 'Hana']),
          lastName: last,
          title: rng.pick(['Mr', 'Mrs', 'Ms']),
        })),
        roomDetails: {
          roomType: hotel.roomType,
          boardType: rng.weighted([['Bed & Breakfast', 4], ['Half Board', 3], ['Full Board', 1]]),
          rooms,
          adults: lead.pax,
          children: 0,
          bedType: rng.pick(['Double', 'Twin', 'King']),
        },
        // Raw supplier offer, kept by the service for audit and re-pricing. The
        // shape mirrors what the hotel search returns so the UI's re-open path
        // has something coherent to show.
        searchSnapshot: {
          offer: {
            id: `offer_${rng.int(1000000, 9999999)}`,
            name: hotel.name,
            checkin: checkin.toISOString().slice(0, 10),
            checkout: checkout.toISOString().slice(0, 10),
            currency: 'USD',
            total: totalAmount,
            roomType: hotel.roomType,
          },
          provider: rng.pick(['LiteAPI', 'Hotelbeds']),
          quotedAt: addDays(now, -rng.int(20, 120)).toISOString(),
        },
        cancellationReason: status === 'cancelled' ? rng.pick(['Traveller changed plans', 'Supplier could not honour the rate']) : null,
        cancelledAt: status === 'cancelled' ? addDays(checkin, -rng.int(5, 30)) : null,
        supplierPortalUrl: `https://supplier.lushtravelcloud.com/bookings/${rng.int(100000, 999999)}`,
        pnrCode: status === 'confirmed' ? `${rng.int(100000, 999999)}` : null,
        leadId: lead.id,
        packageId: selection.packageId ?? null,
        customizedPackageId: null,
        dayNumber: Math.min(i + 1, 3),
        createdAt: addDays(lead.createdAt, rng.int(2, 20)),
        updatedAt: addDays(lead.createdAt, rng.int(3, 25)),
      });
    }
  }

  await db.pkg.hotelBooking.createMany({ data: rows, skipDuplicates: true });

  log(`    hotels: ${rows.length} hotel bookings across ${new Set(rows.map((r) => r.leadId)).size} leads`);

  return {
    summary: `${rows.length} hotel bookings`,
    count: rows.length,
    list: rows.map((r) => ({ id: r.id, leadId: r.leadId, hotelName: r.hotelName, status: r.status, totalAmount: r.totalAmount })),
  };
}

function splitName(name) {
  if (!name) return { first: 'Alex', last: 'Traveller' };
  const parts = String(name).trim().split(/\s+/);
  return parts.length === 1 ? { first: parts[0], last: 'Traveller' } : { first: parts[0], last: parts[parts.length - 1] };
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

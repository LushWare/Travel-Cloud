/**
 * crm_bookings — confirmed travel.
 *
 * Created for the leads that reached booking, one per lead, with the
 * traveller manifest. The invoice is written later (invoices step runs after
 * this one), so `Booking.invoiceId` is left null here and back-filled by that
 * step — the alternative is a circular dependency between two schemas that
 * have no foreign key to resolve it.
 */
import { addDays, money } from '../lib/rng.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';

const BOOKING_STATUS_FOR_LEAD = {
  CONFIRMED: 'confirmed',
  BOOKING_IN_PROGRESS: 'pending',
  CANCELLED: 'cancelled',
  BOOKING_FAILED: 'cancelled',
};

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('bookings');
  const { plan } = ctx.data.leads;
  const { customers, reps } = ctx.data.users;

  const eligible = plan.filter((l) => BOOKING_STATUS_FOR_LEAD[l.status] && l.selections.some((s) => s.packageId));
  const fallbackCustomer = customers[0]?.id ?? null;
  if (!fallbackCustomer) throw new Error('bookings: no customer users available — run the users step first');

  // Own the id prefix: a re-run must rewrite these rows, not append a second
  // set. Booking has no natural unique key, and BookingTraveler cascades.
  await db.sql.query(`DELETE FROM crm_bookings."Booking" WHERE id LIKE $1`, [`${ownedPrefix('booking')}%`]);

  const bookings = [];
  const travellers = [];
  const backfill = [];

  for (const lead of eligible) {
    const selection = lead.selections.find((s) => s.packageId) ?? lead.selections[0];
    const bookingId = ids.next('booking');
    const bookingStatus = BOOKING_STATUS_FOR_LEAD[lead.status];

    // Prefer the lead's own linked customer; fall back to a stable customer so
    // userId (a required column) is never null.
    const userId = lead.customerId ?? fallbackCustomer;
    const assignedToId = lead.assignedToId ?? rng.pick(reps).id;

    const totalAmount = money(selection.totalAmount ?? Number(rng.int(1200, 9500)));
    const deposit = money(selection.depositAmount ?? totalAmount * 0.25);
    const paidAmount = bookingStatus === 'cancelled'
      ? money(rng.chance(0.45) ? deposit : 0)
      : bookingStatus === 'confirmed'
        ? (lead.status === 'CONFIRMED' ? money(rng.weighted([[totalAmount, 5], [deposit, 3], [money(totalAmount * 0.5), 2]])) : deposit)
        : deposit;

    const paymentStatus = paidAmount >= totalAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';

    const createdAt = addDays(lead.createdAt, rng.int(3, 30));
    const booking = {
      id: bookingId,
      userId,
      packageId: selection.packageId,
      invoiceId: null, // invoices step back-fills
      assignedToId,
      travelDate: lead.travelDate,
      endDate: lead.endDate,
      numberOfTravelers: lead.pax,
      totalAmount,
      paidAmount,
      paymentStatus,
      bookingStatus,
      specialRequests: rng.chance(0.55) ? ctx.fx.SPECIAL_REQUESTS[rng.int(0, ctx.fx.SPECIAL_REQUESTS.length - 1)] : null,
      notes: bookingStatus === 'cancelled' ? 'Cancelled at the traveller\u2019s request before travel.' : null,
      cancelledAt: bookingStatus === 'cancelled' ? addDays(createdAt, rng.int(5, 40)) : null,
      cancellationReason: bookingStatus === 'cancelled' ? rng.pick(['Change of personal plans', 'Unable to obtain leave', 'Medical reasons']) : null,
      confirmedAt: bookingStatus === 'confirmed' ? addDays(createdAt, rng.int(0, 3)) : null,
      completedAt: bookingStatus === 'confirmed' && lead.endDate < now ? addDays(lead.endDate, 1) : null,
      createdAt,
      updatedAt: addDays(createdAt, rng.int(0, 6)),
    };
    bookings.push(booking);

    // Traveller manifest: the lead is the lead passenger; companions share the
    // surname so the manifest reads like a family or a couple.
    const { first, last } = splitName(lead.name);
    for (let t = 0; t < lead.pax; t += 1) {
      const isChild = lead.pax >= 4 && t === lead.pax - 1;
      const name = t === 0 ? `${first} ${last}` : `${rng.pick(['Priya', 'Arjun', 'Nimal', 'Emma', 'Liam', 'Sofia', 'Daniel', 'Maya', 'Noah', 'Hana', 'Omar', 'Elena'])} ${last}`;
      travellers.push({
        id: ids.next('bookingTraveler'),
        bookingId,
        name,
        age: isChild ? rng.int(4, 15) : rng.int(24, 68),
        gender: rng.weighted([['male', 1], ['female', 1], ['other', 0.05]]),
        idType: rng.weighted([['passport', 8], ['national_id', 2]]),
        idNumber: isChild ? null : `P${rng.int(1000000, 9999999)}`,
      });
    }

    backfill.push({
      id: bookingId,
      leadId: lead.id,
      bookingStatus,
      paymentStatus,
      totalAmount,
      paidAmount,
      userId,
      packageId: booking.packageId,
      assignedToId,
      travelDate: booking.travelDate,
      endDate: booking.endDate,
      pax: booking.numberOfTravelers,
    });
  }

  await db.book.booking.createMany({ data: bookings, skipDuplicates: true });
  await db.book.bookingTraveler.createMany({ data: travellers, skipDuplicates: true });

  for (const b of backfill) {
    await db.lead.lead.update({ where: { id: b.leadId }, data: { convertedBookingId: b.bookingId } });
  }

  log(`    bookings: ${bookings.length} (${travellers.length} travellers, ${bookings.filter((b) => b.bookingStatus === 'confirmed').length} confirmed)`);

  return {
    summary: `${bookings.length} bookings · ${travellers.length} travellers`,
    list: backfill,
  };
}

function splitName(name) {
  if (!name) return { first: 'Alex', last: 'Traveller' };
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: 'Traveller' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

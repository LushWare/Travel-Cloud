/**
 * crm_packages — the product catalogue.
 *
 * Additive by design: the seven original packages and anything the package
 * editor or the creation chatbot made are left exactly as they are. This step
 * creates the new demo packages, and gives every package in scope a complete
 * itinerary (days, places, activities, transport, images, reviews) so the
 * package details modal never renders "No itinerary specified".
 *
 * Everything is written in batches. The shared database is a remote Supabase
 * pooler, so a per-row loop costs ~150 ms per statement and turns a small seed
 * into a twenty-minute one; each package is therefore built in memory and
 * flushed as a handful of `createMany` calls inside a single `$transaction`.
 *
 * Master dictionaries (Place, Activity_Catalog) are shared across every package
 * in the database, so they are created-or-selected by their unique name — a
 * name a human already created is reused, never duplicated and never wiped.
 */
import { DESTINATIONS, EXISTING_PACKAGE_ITINERARIES, PACKAGE_BLUEPRINTS } from '../lib/destinations.mjs';
import { REVIEWER_NAMES, REVIEWS } from '../lib/fixtures.mjs';
import { addDays, money } from '../lib/rng.mjs';

const MEAL_RATE = { breakfast: 0.35, lunch: 0.5, dinner: 0.75 };

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('packages');

  // ── 1. Load and extend the shared dictionaries ────────────────────────────
  const places = new Map((await db.pkg.place.findMany()).map((p) => [p.name, p]));
  const activities = new Map((await db.pkg.activityCatalog.findMany()).map((a) => [a.name, a]));

  const wantedPlaces = new Map(); // name → type
  const wantedActivities = new Map(); // name → cost
  for (const dest of Object.values(DESTINATIONS)) {
    for (const p of dest.places) wantedPlaces.set(p.name, p.type);
    for (const a of dest.activities) wantedActivities.set(a.name, a.cost);
  }
  // Names referenced by an itinerary but not declared in the destination
  // profile still have to resolve, or the day would silently lose a stop.
  const allItineraries = [...PACKAGE_BLUEPRINTS.map((b) => b.itinerary), ...EXISTING_PACKAGE_ITINERARIES.map((e) => e.itinerary)];
  for (const itinerary of allItineraries) {
    for (const day of itinerary) {
      for (const name of day[2] ?? []) wantedPlaces.set(name, wantedPlaces.get(name) ?? 'CITY');
      for (const name of day[3] ?? []) wantedActivities.set(name, wantedActivities.get(name) ?? 0);
    }
  }

  const newPlaces = [...wantedPlaces].filter(([name]) => !places.has(name));
  if (newPlaces.length) {
    const rows = newPlaces.map(([name, type]) => ({ id: ids.next('place'), name, type, defaultCost: null }));
    await db.pkg.place.createMany({ data: rows, skipDuplicates: true });
    const created = await db.pkg.place.findMany({ where: { name: { in: newPlaces.map(([n]) => n) } } });
    for (const p of created) places.set(p.name, p);
  }
  // Any name still missing (a race with another writer) is resolved lazily below.
  for (const name of wantedPlaces.keys()) if (!places.has(name)) places.set(name, { id: null, name });

  const newActivities = [...wantedActivities].filter(([name]) => !activities.has(name));
  if (newActivities.length) {
    const rows = newActivities.map(([name, cost]) => ({
      id: ids.next('activity'),
      name,
      description: `${name} — arranged with a licensed local supplier.`,
      defaultCost: cost ?? 0,
    }));
    await db.pkg.activityCatalog.createMany({ data: rows, skipDuplicates: true });
    const created = await db.pkg.activityCatalog.findMany({ where: { name: { in: newActivities.map(([n]) => n) } } });
    for (const a of created) activities.set(a.name, a);
  }
  for (const name of wantedActivities.keys()) if (!activities.has(name)) activities.set(name, { id: null, name, defaultCost: 0 });

  // ── 2. Build every package ────────────────────────────────────────────────
  const scopeIds = [];
  const createdPackages = [];
  const reshapedPackages = [];

  for (const bp of PACKAGE_BLUEPRINTS) {
    const dest = DESTINATIONS[bp.dest];
    const pkgId = ids.next('package');
    const shared = {
      title: bp.title,
      slug: bp.key,
      description: buildDescription(bp),
      destination: dest.label,
      durationDays: bp.days,
      category: bp.category,
      coverImage: bp.cover,
      inclusions: bp.inclusions,
      exclusions: bp.exclusions,
      termsAndConditions: bp.terms,
      basePrice: bp.basePrice,
      defaultMarginType: bp.marginType,
      defaultMarginInput: bp.marginInput,
      currency: 'USD',
      isActive: true,
      isFeatured: bp.featured,
      views: bp.views,
      bookings: bp.bookings,
      createdBy: ctx.data.users.admins[0]?.id ?? null,
    };
    // `sellPrice` is a GENERATED column: Postgres rejects any INSERT or UPDATE
    // that supplies it, and Prisma cannot select it either. Read it back with
    // raw SQL at the end.
    await db.pkg.package.upsert({
      where: { id: pkgId },
      update: shared,
      create: { id: pkgId, rating: 0, numReviews: 0, ...shared },
    });

    await flushPackageContent(ctx, { pkgId, dest, itinerary: bp.itinerary, slug: bp.key, images: imagesFor(bp), places, activities, reviewSpec: { rating: bp.rating, bookings: bp.bookings } });
    scopeIds.push(pkgId);
    createdPackages.push({ ...bp, id: pkgId, destLabel: dest.label });
  }

  for (const ex of EXISTING_PACKAGE_ITINERARIES) {
    const pkg = await db.pkg.package.findUnique({ where: { id: ex.id }, select: { id: true, slug: true, rating: true, bookings: true, title: true } });
    if (!pkg) continue; // deleted by a human — respect that
    await flushPackageContent(ctx, {
      pkgId: ex.id,
      dest: DESTINATIONS[ex.dest],
      itinerary: ex.itinerary,
      slug: pkg.slug ?? ex.id,
      images: null, // the existing package keeps whatever gallery it has
      places,
      activities,
      reviewSpec: { rating: Number(pkg.rating) || 4.6, bookings: pkg.bookings || 8 },
    });
    scopeIds.push(ex.id);
    reshapedPackages.push({ id: ex.id, title: pkg.title });
  }

  // ── 3. Recompute derived counters in one statement ───────────────────────
  // The UI renders `rating` and `numReviews` beside the actual review list, so
  // letting them disagree with the rows a demo is about to scroll is the one
  // thing worse than empty data.
  await db.sql.query(
    `UPDATE crm_packages."Package" p
        SET rating = s.r, num_reviews = s.n
       FROM (SELECT "packageId", ROUND(AVG(rating)::numeric, 1)::float8 AS r, COUNT(*)::int AS n
               FROM crm_packages."Review" WHERE "isApproved" GROUP BY "packageId") s
      WHERE p.id = s."packageId" AND p.id = ANY($1)`,
    [scopeIds],
  );

  // ── 4. Read the catalogue back, including the generated sell_price ───────
  const { rows: list } = await db.sql.query(
    `SELECT id, title, slug, destination, category, duration_days AS "durationDays",
            base_price::float8 AS "basePrice", sell_price::float8 AS "sellPrice", currency,
            rating, num_reviews AS "numReviews", is_active AS "isActive", is_featured AS "isFeatured"
       FROM crm_packages."Package"
      WHERE id = ANY($1)
      ORDER BY "createdAt", id`,
    [scopeIds],
  );

  log(`    packages: ${createdPackages.length} created, ${reshapedPackages.length} existing reshaped, ${places.size} places, ${activities.size} activities`);

  return {
    summary: `${createdPackages.length} new · ${reshapedPackages.length} reshaped · ${places.size} places`,
    list,
    created: createdPackages,
    places,
    activities,
    scopeIds,
  };
}

// ─── package content ────────────────────────────────────────────────────────

/**
 * Write one package's itinerary, gallery and reviews.
 *
 * Days are deleted and rebuilt rather than upserted: Package_Day_Transport has
 * no unique key, so an upsert-style refresh would leave the previous run's
 * transport rows behind and double the drive on every day.
 */
async function flushPackageContent(ctx, { pkgId, dest, itinerary, slug, images, places, activities, reviewSpec }) {
  const { db, ids, rng, now, data } = ctx;

  const dayRows = [];
  const placeRows = [];
  const activityRows = [];
  const transportRows = [];

  for (let i = 0; i < itinerary.length; i += 1) {
    const [title, description, placeNames, activityNames, leg, meals, hotelIndex] = itinerary[i];
    const dayNumber = i + 1;
    const dayId = ids.next('itineraryDay');
    const hotel = hotelIndex >= 0 ? dest.hotels[hotelIndex] : null;

    const [bCount, lCount, dCount] = meals;
    const mealAmount = money(
      bCount * dest.meals.breakfast * MEAL_RATE.breakfast +
      lCount * dest.meals.lunch * MEAL_RATE.lunch +
      dCount * dest.meals.dinner * MEAL_RATE.dinner,
    );

    const accommodation = hotel
      ? {
          name: hotel.name,
          type: 'hotel',
          roomType: hotel.roomType,
          address: `${hotel.city}, ${dest.country}`,
          contactNumber: `+${rng.int(1, 99)} ${rng.int(100, 999)} ${rng.int(100000, 999999)}`,
          rating: Math.round((4 + rng.next()) * 10) / 10,
          hotelImage: `https://picsum.photos/seed/${slugify(hotel.name)}/800/500`,
          boardType: dCount ? 'Half Board' : 'Bed & Breakfast',
          totalAmount: money(hotel.nightly),
          currency: 'USD',
          checkin: null,
          checkout: null,
          mealAmount,
        }
      : { name: null, totalAmount: 0, currency: 'USD', mealAmount };

    dayRows.push({
      id: dayId,
      packageId: pkgId,
      dayNumber,
      title,
      description,
      breakfastCount: bCount,
      lunchCount: lCount,
      dinnerCount: dCount,
      mealPriceOverride: null,
      accommodation,
      flights: [],
      images: dayNumber === 1 ? [{ url: `https://picsum.photos/seed/${slug}-day1/1200/800`, publicId: null, altText: title }] : [],
      createdAt: now,
      updatedAt: now,
    });

    (placeNames ?? []).forEach((name, p) => {
      placeRows.push({ id: ids.next('packageDayPlace'), itineraryDayId: dayId, placeId: places.get(name)?.id ?? null, customName: places.get(name)?.id ? null : name, orderIndex: p });
    });

    (activityNames ?? []).forEach((name, a) => {
      const act = activities.get(name);
      activityRows.push({
        id: ids.next('packageDayActivity'),
        itineraryDayId: dayId,
        activityId: act?.id ?? activities.values().next().value?.id,
        orderIndex: a,
        costOverride: act?.defaultCost ? money(Number(act.defaultCost) * (rng.chance(0.75) ? 1 : 1.1)) : null,
      });
    });

    // An activity we could not resolve to a catalogue row is dropped rather
    // than written with a null activityId, which the schema forbids.
    for (let a = activityRows.length - 1; a >= 0; a -= 1) if (!activityRows[a].activityId) activityRows.splice(a, 1);

    if (leg) {
      const [from, to, km, mode] = leg;
      const perKm = { CAR: dest.rates.carPerKm, VAN: dest.rates.vanPerKm, BUS: dest.rates.busPerKm };
      const perPerson = { TRAIN: dest.rates.trainPerPerson, BOAT: dest.rates.boatPerPerson, FLIGHT: dest.rates.flightPerPerson };
      const isPerPerson = mode in perPerson;
      transportRows.push({
        id: ids.next('packageDayTransport'),
        itineraryDayId: dayId,
        routeType: 'POINT_TO_POINT',
        transportMode: mode,
        pricingModel: isPerPerson ? 'PER_PERSON' : 'PER_VEHICLE',
        unitCost: isPerPerson ? money(perPerson[mode]) : money(km * (perKm[mode] ?? dest.rates.carPerKm)),
        distanceKm: km,
        originPlaceId: places.get(from)?.id ?? null,
        destinationPlaceId: places.get(to)?.id ?? null,
      });
    }
  }

  const reviewRows = buildReviews({ rng, now, ids, packageId: pkgId, spec: reviewSpec, customers: data.users.customers });
  const imageRows = images?.map((url, i) => ({ id: ids.next('packageImage'), packageId: pkgId, url, altText: `${slug} — image ${i + 1}`, orderIndex: i })) ?? [];

  // One transaction: the deletes must land before the inserts, and batching
  // them keeps this to a single round trip instead of six.
  // Interactive form: a batch transaction cannot carry the agency (see shared/tenancy).
  await db.pkg.$transaction(async (tx) => {
    await tx.packageDayTransport.deleteMany({ where: { itineraryDay: { packageId: pkgId } } });
    await tx.packageDayPlace.deleteMany({ where: { itineraryDay: { packageId: pkgId } } });
    await tx.packageDayActivity.deleteMany({ where: { itineraryDay: { packageId: pkgId } } });
    await tx.itineraryDay.deleteMany({ where: { packageId: pkgId } });
    await tx.review.deleteMany({ where: { packageId: pkgId } });
    if (images) await tx.packageImage.deleteMany({ where: { packageId: pkgId } });

    await tx.itineraryDay.createMany({ data: dayRows, skipDuplicates: true });
    if (placeRows.length) await tx.packageDayPlace.createMany({ data: placeRows, skipDuplicates: true });
    if (activityRows.length) await tx.packageDayActivity.createMany({ data: activityRows, skipDuplicates: true });
    if (transportRows.length) await tx.packageDayTransport.createMany({ data: transportRows, skipDuplicates: true });
    if (imageRows.length) await tx.packageImage.createMany({ data: imageRows, skipDuplicates: true });
    await tx.review.createMany({ data: reviewRows, skipDuplicates: true });
  }, { timeout: 60_000 });
}

function imagesFor(bp) {
  const count = 3 + (bp.views % 2);
  return [bp.cover, ...Array.from({ length: count }, (_, i) => `https://picsum.photos/seed/${bp.key}-${i + 1}/1200/800`)];
}

function buildReviews({ rng, now, ids, packageId, spec, customers }) {
  const target = Math.max(6, Math.min(14, Math.round((spec.bookings ?? 10) * 0.6) + 4));
  const targetRating = spec.rating ?? 4.6;
  const used = new Set();
  const rows = [];
  for (let i = 0; i < target; i += 1) {
    const rating = rng.weighted([
      [5, targetRating >= 4.7 ? 6 : 4],
      [4, targetRating >= 4.7 ? 3 : 5],
      [3, 1],
      [2, targetRating >= 4.5 ? 0.3 : 0.8],
      [1, 0.2],
    ]);
    const template = rng.pick(REVIEWS.filter((x) => Math.abs(x.rating - rating) <= 1)) ?? rng.pick(REVIEWS);
    let name = rng.pick(REVIEWER_NAMES);
    for (let guard = 0; used.has(name) && guard < 12; guard += 1) name = rng.pick(REVIEWER_NAMES);
    used.add(name);
    const author = rng.chance(0.25) && customers.length ? rng.pick(customers) : null;
    const createdAt = addDays(now, -rng.int(10, 540));
    rows.push({
      id: ids.next('review'),
      packageId,
      authorId: author?.id ?? null,
      name: author?.name ?? name,
      email: author?.email ?? `${slugify(name)}@example.com`,
      rating,
      comment: template.comment,
      isApproved: true,
      helpful: rng.int(0, 48),
      createdAt,
      updatedAt: createdAt,
    });
  }
  return rows;
}

function buildDescription(bp) {
  const dest = DESTINATIONS[bp.dest];
  const days = bp.itinerary.map((d, i) => `${i + 1}. ${d[0]}`).join('  ·  ');
  return `${bp.title} — ${bp.days} days through ${dest.label}. ${bp.inclusions.slice(0, 3).join(', ')}. Day by day: ${days}`;
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

import slugify from 'slugify';
import { PackageCategory } from '@prisma/client';
import { z } from 'zod';
import prisma from '../db/client.js';
import { calculateBasePrice, computeMargin } from '../../../shared/pricing-engine/src/index.js';

const packageIdFilterSchema = z.string().min(1).max(255).regex(/^[a-zA-Z0-9_-]+$/);

// ── Include helpers ───────────────────────────────────────────

export function buildInclude() {
  return {
    images: { orderBy: { orderIndex: 'asc' } },
    itineraryDays: {
      orderBy: { dayNumber: 'asc' },
      include: {
        places: { orderBy: { orderIndex: 'asc' }, include: { place: true } },
        activities: { orderBy: { orderIndex: 'asc' }, include: { activity: true } },
        transports: true,
      },
    },
    reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
  };
}

// ── Serialize ─────────────────────────────────────────────────

export function serializePackage(pkg) {
  if (!pkg) return null;

  const itineraryDays = (pkg.itineraryDays || []).map((day) => ({
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    breakfastCount: day.breakfastCount,
    lunchCount: day.lunchCount,
    dinnerCount: day.dinnerCount,
    mealPriceOverride: day.mealPriceOverride ? Number(day.mealPriceOverride) : null,
    accommodation: day.accommodation || {},
    images: day.images || [],
    places: (day.places || []).map((dp) => ({
      id: dp.id,
      placeId: dp.placeId,
      place: dp.place ? { id: dp.place.id, name: dp.place.name, type: dp.place.type } : null,
      customName: dp.customName,
      orderIndex: dp.orderIndex,
    })),
    activities: (day.activities || []).map((da) => ({
      id: da.id,
      activityId: da.activityId,
      activity: da.activity ? { id: da.activity.id, name: da.activity.name, description: da.activity.description, defaultCost: Number(da.activity.defaultCost) } : null,
      costOverride: da.costOverride ? Number(da.costOverride) : null,
      orderIndex: da.orderIndex,
    })),
    transports: (day.transports || []).map((dt) => ({
      id: dt.id,
      routeType: dt.routeType,
      transportMode: dt.transportMode,
      pricingModel: dt.pricingModel,
      unitCost: Number(dt.unitCost),
      distanceKm: dt.distanceKm ? Number(dt.distanceKm) : null,
      originPlaceId: dt.originPlaceId,
      destinationPlaceId: dt.destinationPlaceId,
    })),
    flights: day.flights || [],
  }));

  const basePrice = Number(pkg.basePrice);
  const defaultMarginInput = Number(pkg.defaultMarginInput);

  return {
    id: pkg.id,
    title: pkg.title,
    slug: pkg.slug,
    description: pkg.description,
    destination: pkg.destination,
    durationDays: pkg.durationDays,
    category: pkg.category,
    coverImage: pkg.coverImage,
    inclusions: pkg.inclusions,
    exclusions: pkg.exclusions,
    termsAndConditions: pkg.termsAndConditions,
    basePrice,
    defaultMarginType: pkg.defaultMarginType,
    defaultMarginInput,
    sellPrice: resolveSellPrice(pkg, basePrice),
    currency: pkg.currency,
    isActive: pkg.isActive,
    isFeatured: pkg.isFeatured,
    rating: pkg.rating,
    numReviews: pkg.numReviews,
    views: pkg.views,
    bookings: pkg.bookings,
    createdBy: pkg.createdBy,
    images: (pkg.images || []).map((img) => ({
      id: img.id,
      url: img.url,
      publicId: img.publicId,
      altText: img.altText,
      orderIndex: img.orderIndex,
    })),
    itineraryDays,
    reviews: (pkg.reviews || []).map((r) => ({
      id: r.id,
      authorId: r.authorId,
      name: r.name,
      email: r.email,
      rating: r.rating,
      comment: r.comment,
      isApproved: r.isApproved,
      helpful: r.helpful,
      createdAt: r.createdAt,
    })),
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

export function serializePackageList(pkg) {
  if (!pkg) return null;
  return {
    id: pkg.id,
    title: pkg.title,
    slug: pkg.slug,
    description: pkg.description,
    destination: pkg.destination,
    durationDays: pkg.durationDays,
    category: pkg.category,
    coverImage: pkg.coverImage,
    basePrice: Number(pkg.basePrice),
    defaultMarginType: pkg.defaultMarginType,
    defaultMarginInput: Number(pkg.defaultMarginInput),
    sellPrice: resolveSellPrice(pkg, Number(pkg.basePrice)),
    currency: pkg.currency,
    isActive: pkg.isActive,
    isFeatured: pkg.isFeatured,
    rating: pkg.rating,
    numReviews: pkg.numReviews,
    views: pkg.views,
    bookings: pkg.bookings,
    images: (pkg.images || []).slice(0, 1).map((img) => ({ url: img.url })),
    createdAt: pkg.createdAt,
  };
}

// ── Deserialize (API payload → Prisma create/update data) ─────

export function buildCreateData(body, userId) {
  const slug = body.slug || slugify(body.title, { lower: true, strict: true });

  return {
    title: body.title,
    slug,
    description: body.description,
    destination: body.destination,
    durationDays: body.durationDays,
    category: body.category,
    coverImage: body.coverImage,
    inclusions: body.inclusions ?? [],
    exclusions: body.exclusions ?? [],
    termsAndConditions: body.termsAndConditions,
    basePrice: body.basePrice ?? 0,
    defaultMarginType: body.defaultMarginType ?? 'PERCENTAGE',
    defaultMarginInput: body.defaultMarginInput ?? 0,
    currency: body.currency ?? 'USD',
    isActive: body.isActive ?? true,
    isFeatured: body.isFeatured ?? false,
    createdBy: userId,
    images: {
      create: (body.images || []).map((img, i) => ({
        url: img.url,
        publicId: img.publicId,
        altText: img.altText,
        orderIndex: img.orderIndex ?? i,
      })),
    },
    itineraryDays: {
      create: buildItineraryDaysData(body.itineraryDays || []),
    },
  };
}

export function buildUpdateData(body) {
  const data = {};

  const scalarFields = [
    'title', 'slug', 'description', 'destination', 'durationDays', 'category',
    'coverImage', 'inclusions', 'exclusions', 'termsAndConditions',
    'basePrice', 'defaultMarginType', 'defaultMarginInput', 'currency',
    'isActive', 'isFeatured',
  ];

  for (const field of scalarFields) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (body.slug === undefined && body.title !== undefined) {
    data.slug = slugify(body.title, { lower: true, strict: true });
  }

  if (body.images !== undefined) {
    data.images = {
      deleteMany: {},
      create: (body.images || []).map((img, i) => ({
        url: img.url,
        publicId: img.publicId,
        altText: img.altText,
        orderIndex: img.orderIndex ?? i,
      })),
    };
  }

  if (body.itineraryDays !== undefined) {
    data.itineraryDays = {
      deleteMany: {},
      create: buildItineraryDaysData(body.itineraryDays),
    };
  }

  return data;
}

// ── Day data builder ───────────────────────────────────────────

export function buildItineraryDaysData(days) {
  return days.map((day) => ({
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    breakfastCount: day.breakfastCount ?? 0,
    lunchCount: day.lunchCount ?? 0,
    dinnerCount: day.dinnerCount ?? 0,
    mealPriceOverride: day.mealPriceOverride ?? null,
    images: day.images ?? [],
    accommodation: day.accommodation ?? {},
    places: {
      create: (day.places || []).map((p, i) => ({
        placeId: p.placeId || undefined,
        customName: !p.placeId ? (p.customName || undefined) : undefined,
        orderIndex: p.orderIndex ?? i,
      })),
    },
    activities: {
      create: (day.activities || []).map((a, i) => ({
        activityId: a.activityId,
        costOverride: a.costOverride ?? null,
        orderIndex: a.orderIndex ?? i,
      })),
    },
    transports: {
      create: (day.transports || []).map((t) => ({
        routeType: t.routeType,
        transportMode: t.transportMode,
        pricingModel: t.pricingModel,
        unitCost: t.unitCost,
        distanceKm: t.distanceKm ?? null,
        originPlaceId: t.originPlaceId ?? null,
        destinationPlaceId: t.destinationPlaceId ?? null,
      })),
    },
    flights: day.flights ?? [],
  }));
}

// ── Pricing ────────────────────────────────────────────────────

export function recomputeBasePrice(days, activities, transports, options = {}) {
  const mealDays = days.map((day) => ({
    breakfastCount: day.breakfastCount,
    lunchCount: day.lunchCount,
    dinnerCount: day.dinnerCount,
    mealPriceOverride: day.mealPriceOverride,
  }));

  const actRows = activities.map((a) => ({
    defaultCost: a.costOverride ?? a.defaultCost ?? (a.activity?.defaultCost ?? 0),
    costOverride: a.costOverride,
  }));

  const transportRows = transports.map((t) => ({
    pricingModel: t.pricingModel,
    unitCost: t.unitCost,
    distanceKm: t.distanceKm,
  }));

  return calculateBasePrice({
    days: mealDays,
    activities: actRows,
    transports: transportRows,
    groupSize: options.groupSize,
    mealCostPerPerson: options.mealCostPerPerson,
  });
}

// ── Activity catalog resolution ────────────────────────────────

/**
 * The editor submits activities by display name (or keeps an activityId when
 * one was loaded from the API). PackageDayActivity.activityId is required, so
 * resolve name-only activities against the Activity_Catalog (create-or-select)
 * before building Prisma create/update data. Also returns a cost lookup so the
 * auto-computed base price can use real catalog defaultCosts.
 *
 * @param {Array} days — request itineraryDays
 * @returns {Promise<{ days: Array, activityCost: (a: object) => number }>}
 */
export async function resolveActivityCatalogIds(days) {
  const costById = new Map();
  const infoByName = new Map(); // name → { id, cost }

  // Collect each name-only activity once (first-seen defaultCost) and every
  // referenced activityId once, up front — then resolve each exactly one
  // time. Resolving inline per day×activity (the previous approach) ran a
  // findUnique-then-create for every occurrence concurrently, so two days
  // that both used the same not-yet-catalogued name raced each other into
  // Activity_Catalog's unique(name) constraint (P2002) on a real multi-day
  // itinerary where activity names repeat across days.
  const defaultCostByName = new Map();
  const activityIds = new Set();
  for (const day of days || []) {
    for (const a of day.activities || []) {
      if (a.activityId) {
        activityIds.add(a.activityId);
      } else if (a.name && !defaultCostByName.has(a.name)) {
        defaultCostByName.set(a.name, a.defaultCost ?? 0);
      }
    }
  }

  await Promise.all([...activityIds].map(async (id) => {
    const row = await prisma.activityCatalog.findUnique({ where: { id } });
    costById.set(id, row ? Number(row.defaultCost) : 0);
  }));

  await Promise.all([...defaultCostByName.keys()].map(async (name) => {
    const existing = await prisma.activityCatalog.findUnique({ where: { name } });
    if (existing) {
      infoByName.set(name, { id: existing.id, cost: Number(existing.defaultCost) });
    } else {
      const created = await prisma.activityCatalog.create({
        data: { name, defaultCost: defaultCostByName.get(name) },
      });
      infoByName.set(name, { id: created.id, cost: Number(created.defaultCost) });
    }
  }));

  const resolvedDays = (days || []).map((day) => ({
    ...day,
    activities: (day.activities || []).map((a) => {
      if (a.activityId) return a;
      if (!a.name) return a;
      return { ...a, activityId: infoByName.get(a.name).id };
    }),
  }));

  return {
    days: resolvedDays,
    activityCost: (a) => {
      if (!a) return 0;
      if (a.activityId && costById.has(a.activityId)) return costById.get(a.activityId);
      if (a.name && infoByName.has(a.name)) return infoByName.get(a.name).cost;
      return 0;
    },
  };
}

// ── Query builder ──────────────────────────────────────────────

/**
 * The customer-facing price. A real row always carries the generated
 * `sell_price` column, and reading that rather than recomputing is what stops
 * a displayed price and a price filter from ever disagreeing. The
 * `computeMargin` branch below covers objects that have no column — partial
 * selects and hand-built test fixtures. It is a fallback, not a second
 * source of truth: never rely on it for a row that came from the database.
 */
function resolveSellPrice(pkg, basePrice) {
  if (pkg.sellPrice !== undefined && pkg.sellPrice !== null) return Number(pkg.sellPrice);
  return computeMargin(basePrice, pkg.defaultMarginType, Number(pkg.defaultMarginInput)).sellPrice;
}

// Query strings are strings, may be absent, and may be garbage. A NaN reaching
// Prisma is a 500, so anything non-finite is treated as "no bound at all".
function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// Public list-sort vocabulary — the names the packages page and the assistant
// both use — mapped to real columns. `popularity` is review volume rather than
// bookings, matching what the page has always sorted by client-side.
const LIST_SORTS = {
  popularity: { field: 'numReviews', order: 'desc' },
  'price-low': { field: 'sellPrice', order: 'asc' },
  'price-high': { field: 'sellPrice', order: 'desc' },
  duration: { field: 'durationDays', order: 'asc' },
};

// Columns any caller may order by. Anything outside this set falls back to
// createdAt rather than reaching Prisma as an unknown field.
const SORTABLE_COLUMNS = new Set([
  'createdAt', 'updatedAt', 'basePrice', 'sellPrice', 'rating', 'numReviews',
  'bookings', 'title', 'durationDays',
]);

export function buildListOrderBy(sort, order) {
  const mapped = LIST_SORTS[sort];
  if (mapped) return { [mapped.field]: mapped.order };

  const column = SORTABLE_COLUMNS.has(sort) ? sort : 'createdAt';
  return { [column]: order === 'asc' ? 'asc' : 'desc' };
}

// Mirrors the client's packages.transform slugify exactly; a difference here
// would make a destination link resolve on the page and not in the query.
export function destinationSlug(value = '') {
  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Splits on a separator that sits outside parentheses, so a grouped
 * destination like "Europe (UK, France, Netherlands, Italy)" stays one
 * segment. Mirrors the client's packages.transform splitTopLevel.
 */
const splitTopLevel = (value, separator) => {
  const parts = [];
  let depth = 0;
  let current = '';

  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    if (char === ')') depth = Math.max(0, depth - 1);
    current += char;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
};

/**
 * "Europe (UK, France)" → { name: 'Europe', country: 'UK, France' }. Mirrors
 * the client's packages.transform splitGroupedName.
 */
const splitGroupedName = (segment) => {
  const grouped = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(segment);
  if (!grouped) return { name: segment, country: '' };
  return { name: grouped[1].trim() || segment, country: grouped[2].trim() };
};

/**
 * Every slug a raw destination display string answers to.
 *
 * The `destination` column holds a denormalized display string such as
 * "Bali, Indonesia". The page addresses destinations by slug, and the client's
 * normalizeDestination derives its name slug and country slug from the same
 * segments — a grouped destination takes its primary slug from its name. That
 * is reproduced here so the server matches the same space the page links in.
 *
 * A comma-separated display string used to answer to its first segment's slug
 * no matter what followed, so those naive slugs stay as aliases: a link minted
 * before grouped destinations were parsed as one still resolves.
 */
export function destinationSlugSet(raw = '') {
  const trimmed = `${raw || ''}`.trim();
  const slugs = new Set();
  if (!trimmed) return slugs;

  const segments = splitTopLevel(trimmed, ',');
  const primarySegment = segments[0] || trimmed;
  const grouped = splitGroupedName(primarySegment);
  const country = segments.length > 1 ? segments[segments.length - 1] : grouped.country;
  const countryParts = splitTopLevel(country, ',');
  const nameSlug = destinationSlug(grouped.name);
  const countrySlug = destinationSlug(country);
  const primary = (countryParts.length > 1 ? nameSlug : countrySlug) || nameSlug || countrySlug;

  const naiveParts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  const naiveNameSlug = destinationSlug(naiveParts[0] || trimmed);
  const naiveCountrySlug = naiveParts.length > 1 ? destinationSlug(naiveParts[naiveParts.length - 1]) : '';

  [
    primary,
    nameSlug,
    countrySlug,
    ...countryParts.map((part) => destinationSlug(part)),
    destinationSlug(primarySegment),
    naiveNameSlug,
    naiveCountrySlug,
    destinationSlug(trimmed),
  ].forEach((slug) => {
    if (slug) slugs.add(slug);
  });
  return slugs;
}

/**
 * Resolves a destination slug to the raw display strings that answer to it.
 *
 * Distinct destinations are bounded by the number of destinations rather than
 * packages, so this stays cheap, and resolving against what is actually
 * present means an unknown slug matches nothing — which the controller turns
 * into an unfiltered list, matching the page's long-standing behaviour.
 */
export async function resolveDestinationRaws(slug) {
  const wanted = destinationSlug(slug);
  if (!wanted) return [];

  const rows = await prisma.package.findMany({
    distinct: ['destination'],
    select: { destination: true },
    where: { destination: { not: null } },
  });

  return rows
    .map((row) => row.destination)
    .filter((raw) => raw && destinationSlugSet(raw).has(wanted));
}

export function assembleWhere(query) {
  const where = {};

  if (query.ids !== undefined) {
    const rawIds = Array.isArray(query.ids) ? query.ids.join(',') : query.ids;
    const parsedIds = z.string().max(5000).safeParse(rawIds);
    const ids = parsedIds.success
      ? [...new Set(parsedIds.data.split(',').filter(Boolean))]
        .slice(0, 50)
        .filter((id) => packageIdFilterSchema.safeParse(id).success)
      : [];
    where.id = { in: ids };
  }

  // Express query strings arrive as strings ("true"/"false"), but Prisma
  // expects real booleans — coerce both representations.
  if (query.isActive !== undefined) {
    where.isActive = query.isActive === 'true' || query.isActive === true;
  }
  if (query.isFeatured !== undefined) {
    where.isFeatured = query.isFeatured === 'true' || query.isFeatured === true;
  }
  // `category` is a Prisma enum column, and an unrecognised value used to reach
  // Prisma unchanged and surface as a 500 — so `/packages?category=family`
  // returned "Something went wrong on our side" instead of a page. That is the
  // URL the site itself produces: the landing page's category cards lowercase
  // the name (Stats.tsx), and the assistant writes the same lowercase slug. So
  // the comparison is case-insensitive against the real enum, and a value that
  // is not in it matches nothing: an unknown category has no packages, which is
  // an empty result, not a server fault.
  if (query.category) {
    where.category = PackageCategory[String(query.category).trim().toUpperCase()] ?? { in: [] };
  }

  // A list of raw destination strings, already resolved from a slug by
  // resolveDestinationRaws. An empty array means "the slug matched nothing" —
  // the caller decides whether that is an empty result or no filter at all.
  if (Array.isArray(query.destinations) && query.destinations.length > 0) {
    where.destination = { in: query.destinations };
  }

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { destination: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  // Price bounds are on sellPrice — the price a customer is shown — NOT on
  // basePrice. Filtering basePrice while the cards render sellPrice is the
  // defect this pair used to carry: at any non-zero margin the two disagree,
  // so a budget filter silently returned packages priced above it. The
  // planner wizard's propose_packages tool shares these two params and gets
  // the same correction.
  const priceMin = finiteNumber(query.minPrice);
  const priceMax = finiteNumber(query.maxPrice);
  if (priceMin !== undefined || priceMax !== undefined) {
    where.sellPrice = {};
    if (priceMin !== undefined) where.sellPrice.gte = priceMin;
    if (priceMax !== undefined) where.sellPrice.lte = priceMax;
  }

  const durationMin = finiteNumber(query.durationMin);
  const durationMax = finiteNumber(query.durationMax);
  if (durationMin !== undefined || durationMax !== undefined) {
    where.durationDays = {};
    if (durationMin !== undefined) where.durationDays.gte = durationMin;
    if (durationMax !== undefined) where.durationDays.lte = durationMax;
  }

  const minRating = finiteNumber(query.minRating);
  if (minRating !== undefined) where.rating = { gte: minRating };

  return where;
}

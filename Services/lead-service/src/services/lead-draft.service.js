import AppError from '../utils/appError.js';
import { buildItineraryCostLines } from '../../../shared/lead-pricing-engine/src/index.js';
import { cloudRunAuthHeader } from './cloudRunAuth.js';

const PACKAGE_SERVICE_URL = process.env.PACKAGE_SERVICE_URL || 'http://localhost:3003';

/**
 * Fetch a package blueprint from package-service.
 * @param {string} packageId
 * @param {Function} [fetchImpl] - injectable for tests
 */
export async function fetchPackage(packageId, fetchImpl = fetch) {
  const res = await fetchImpl(`${PACKAGE_SERVICE_URL}/api/v1/packages/${packageId}`, {
    headers: await cloudRunAuthHeader(PACKAGE_SERVICE_URL),
  });
  if (!res.ok) {
    throw new AppError(`Package not found: ${packageId}`, 404);
  }
  const json = await res.json();
  return json?.data ?? json;
}

/**
 * Pure mapping from a package blueprint to the lead-owned draft copy:
 * itinerary days (with snapshotted places/activities/transports), AUTO cost
 * lines and LeadPricing defaults (currency + margin inherited).
 */
export function buildDraftData(packageData, { travelers = 1, pricing = {} } = {}) {
  const days = (packageData.itineraryDays || []).map((day, idx) => ({
    dayNumber: day.dayNumber ?? idx + 1,
    title: day.title ?? null,
    description: day.description ?? null,
    breakfastCount: day.breakfastCount || 0,
    lunchCount: day.lunchCount || 0,
    dinnerCount: day.dinnerCount || 0,
    mealPriceOverride: day.mealPriceOverride ?? null,
    breakfastPriceOverride: day.breakfastPriceOverride ?? null,
    lunchPriceOverride: day.lunchPriceOverride ?? null,
    dinnerPriceOverride: day.dinnerPriceOverride ?? null,
    accommodation: day.accommodation ?? {},
    flights: day.flights ?? [],
    places: {
      // Snapshot the resolved catalog name so locations survive without a
      // package-service lookup on read (blueprint places carry it on `place`).
      create: (day.places || []).map((p, i) => ({
        placeId: p.placeId ?? null,
        customName: p.customName ?? p.place?.name ?? null,
        orderIndex: p.orderIndex ?? i,
      })),
    },
    activities: {
      // Likewise snapshot the catalog activity name + default cost, which the
      // blueprint nests under `activity`.
      create: (day.activities || []).map((a, i) => {
        const defaultCost = a.defaultCost ?? a.activity?.defaultCost;
        return {
          activityId: a.activityId ?? null,
          name: a.name ?? a.activity?.name ?? null,
          description: a.description ?? a.activity?.description ?? null,
          defaultCost: defaultCost != null ? Number(defaultCost) : null,
          costOverride: a.costOverride != null ? Number(a.costOverride) : null,
          orderIndex: a.orderIndex ?? i,
        };
      }),
    },
    transports: {
      create: (day.transports || []).map((t, i) => ({
        routeType: t.routeType ?? null,
        transportMode: t.transportMode ?? null,
        pricingModel: t.pricingModel ?? null,
        unitCost: Number(t.unitCost) || 0,
        distanceKm: t.distanceKm != null ? Number(t.distanceKm) : null,
        origin: t.origin ?? null,
        destination: t.destination ?? null,
      })),
    },
  }));

  // Room and vehicle counts are sized for this party.
  const engineLines = buildItineraryCostLines({
    travelers,
    mealPrices: pricing.mealPrices,
    vehicleSeats: pricing.vehicleSeats,
    peoplePerRoom: pricing.peoplePerRoom,
    days: days.map((d) => ({
      breakfastCount: d.breakfastCount,
      lunchCount: d.lunchCount,
      dinnerCount: d.dinnerCount,
      mealPriceOverride: d.mealPriceOverride ?? null,
      breakfastPriceOverride: d.breakfastPriceOverride ?? null,
      lunchPriceOverride: d.lunchPriceOverride ?? null,
      dinnerPriceOverride: d.dinnerPriceOverride ?? null,
      accommodation: d.accommodation,
    })),
    activities: days.flatMap((d) => d.activities.create),
    transports: days.flatMap((d) => d.transports.create),
  });

  // Flat-priced packages (no day-by-day itinerary breakdown) have nothing for
  // the itinerary-cost-line engine to derive from — fall back to a single
  // line seeded from the package's own basePrice so the lead's quotation
  // isn't stuck at 0. Packages with a real itinerary already produce lines
  // above, so this only fires for the flat-price case.
  // basePrice is the package's cost per person, so it is charged per traveller.
  if (engineLines.length === 0 && Number(packageData.basePrice) > 0) {
    engineLines.push({
      category: 'package',
      description: packageData.title || 'Package price',
      basis: 'PER_PERSON',
      estimatedUnit: Number(packageData.basePrice),
      source: 'AUTO',
    });
  }

  // Persistence shape (Prisma column names), not the engine descriptor shape.
  const costLines = engineLines.map((line, i) => ({
    category: line.category,
    description: line.description,
    basis: line.basis,
    quantity: line.quantity ?? 1,
    estimatedUnitPrice: line.estimatedUnit ?? 0,
    actualUnitPrice: line.actualUnit ?? null,
    marginType: line.marginType ?? null,
    marginValue: line.marginValue ?? null,
    source: line.source ?? 'AUTO',
    orderIndex: i,
  }));

  return {
    packageId: packageData.id,
    packageName: packageData.title,
    days,
    costLines,
    pricing: {
      currency: packageData.currency || 'USD',
      marginType: packageData.defaultMarginType || null,
      marginValue: packageData.defaultMarginInput != null ? Number(packageData.defaultMarginInput) : null,
    },
  };
}


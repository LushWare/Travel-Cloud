import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import { buildItineraryCostLines } from '../../../shared/lead-pricing-engine/src/index.js';
import { computePricing, toLineDescriptor } from './pricing.service.js';
import { fetchPackage } from './lead-draft.service.js';

export const EDIT_BLOCKED_STATUSES = [
  'QUOTED',
  'APPROVED',
  'BOOKING_IN_PROGRESS',
  'CONFIRMED',
  'BOOKING_FAILED',
  'CLOSED_LOST',
  'CANCELLED',
];

/**
 * Map editor-shaped days (same shape package-service serializes) into nested
 * Prisma create payloads for the lead-owned itinerary tables.
 */
export function buildDaysCreateData(days) {
  return (days || []).map((day, idx) => ({
    dayNumber: day.dayNumber ?? idx + 1,
    title: day.title ?? null,
    description: day.description ?? null,
    breakfastCount: day.breakfastCount || 0,
    lunchCount: day.lunchCount || 0,
    dinnerCount: day.dinnerCount || 0,
    mealPriceOverride: day.mealPriceOverride != null ? Number(day.mealPriceOverride) : null,
    accommodation: day.accommodation ?? {},
    flights: day.flights ?? [],
    places: {
      create: (day.locations?.length ? day.locations : (day.places || [])).map((p, i) => ({
        placeId: typeof p === 'object' ? (p.placeId ?? null) : null,
        customName: typeof p === 'string' ? p : (p.customName || p.place?.name || null),
        orderIndex: typeof p === 'object' ? (p.orderIndex ?? i) : i,
      })),
    },
    activities: {
      create: (day.activities || []).map((a, i) => {
        if (typeof a === 'string') {
          const costs = (day.activityCosts || {})[a] || {};
          const rel = (day._relational?.activities || []).find((r) => (r.name || r.activity?.name) === a);
          return {
            activityId: rel?.activityId ?? null,
            name: a,
            description: rel?.description ?? rel?.activity?.description ?? null,
            defaultCost: costs.defaultCost ?? rel?.activity?.defaultCost ?? null,
            costOverride: costs.costOverride ?? rel?.costOverride ?? null,
            orderIndex: i,
          };
        }
        return {
          activityId: a.activityId ?? null,
          name: a.name ?? a.activity?.name ?? null,
          description: a.description ?? a.activity?.description ?? null,
          defaultCost: a.defaultCost != null
            ? Number(a.defaultCost)
            : (a.activity?.defaultCost != null ? Number(a.activity.defaultCost) : null),
          costOverride: a.costOverride != null ? Number(a.costOverride) : null,
          orderIndex: i,
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
        origin: t.originPlaceId ?? t.origin ?? null,
        destination: t.destinationPlaceId ?? t.destination ?? null,
      })),
    },
    images: {
      // day.images is produced by Management's uploadItineraryImages() as
      // [{url, public_id}, ...], but also accept plain URL strings so this
      // stays robust to either shape.
      create: (day.images || []).map((img, i) => ({
        url: typeof img === 'string' ? img : img.url,
        altText: typeof img === 'object' ? (img.altText ?? null) : null,
        orderIndex: typeof img === 'object' && img.orderIndex != null ? img.orderIndex : i,
      })),
    },
  }));
}

/**
 * Derive AUTO cost lines from editor-shaped days (persistence column names).
 */
export function buildAutoCostLines(days) {
  const engineLines = buildItineraryCostLines({
    days: (days || []).map((d) => ({
      breakfastCount: d.breakfastCount || 0,
      lunchCount: d.lunchCount || 0,
      dinnerCount: d.dinnerCount || 0,
      mealPriceOverride: d.mealPriceOverride ?? null,
      accommodation: d.accommodation || {},
    })),
    activities: (days || []).flatMap((d) =>
      (d.activities || []).map((a) => {
        const name = typeof a === 'string' ? a : (a.name || a.activity?.name || '');
        const costs = (d.activityCosts || {})[name] || {};
        const rel = (d._relational?.activities || []).find((r) => (r.name || r.activity?.name) === name);
        return {
          defaultCost:
            costs.defaultCost ??
            (typeof a === 'object' ? a.defaultCost ?? a.activity?.defaultCost : undefined) ??
            rel?.activity?.defaultCost ??
            0,
          costOverride:
            costs.costOverride != null && costs.costOverride !== ''
              ? Number(costs.costOverride)
              : (typeof a === 'object' && a.costOverride != null
                ? Number(a.costOverride)
                : rel?.costOverride ?? null),
        };
      }),
    ),
    transports: (days || []).flatMap((d) =>
      (d.transports || []).map((t) => ({
        pricingModel: t.pricingModel,
        unitCost: t.unitCost,
        distanceKm: t.distanceKm,
      })),
    ),
  });
  return engineLines.map((line, i) => ({
    category: line.category,
    description: line.description,
    basis: line.basis,
    quantity: line.quantity ?? 1,
    estimatedUnitPrice: line.estimatedUnit ?? 0,
    actualUnitPrice: line.actualUnit ?? null,
    marginType: line.marginType ?? null,
    marginValue: line.marginValue ?? null,
    source: 'AUTO',
    orderIndex: i,
  }));
}

/**
 * Serialize persisted lead itinerary rows into the editor day shape.
 */
export function serializeLeadDays(lead) {
  return (lead.itineraryDays || []).map((day) => ({
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    breakfastCount: day.breakfastCount,
    lunchCount: day.lunchCount,
    dinnerCount: day.dinnerCount,
    mealPriceOverride: day.mealPriceOverride ? Number(day.mealPriceOverride) : null,
    accommodation: day.accommodation || {},
    flights: day.flights || [],
    places: (day.places || []).map((p) => ({
      id: p.id,
      placeId: p.placeId,
      place: null,
      customName: p.customName,
      orderIndex: p.orderIndex,
    })),
    activities: (day.activities || []).map((a) => ({
      id: a.id,
      activityId: a.activityId,
      activity: null,
      name: a.name,
      description: a.description ?? null,
      defaultCost: a.defaultCost != null ? Number(a.defaultCost) : null,
      costOverride: a.costOverride != null ? Number(a.costOverride) : null,
      orderIndex: a.orderIndex,
    })),
    transports: (day.transports || []).map((t) => ({
      id: t.id,
      routeType: t.routeType,
      transportMode: t.transportMode,
      pricingModel: t.pricingModel,
      unitCost: Number(t.unitCost),
      distanceKm: t.distanceKm != null ? Number(t.distanceKm) : null,
      origin: t.origin,
      destination: t.destination,
    })),
    images: (day.images || []).map((img) => ({
      id: img.id,
      url: img.url,
      altText: img.altText,
      orderIndex: img.orderIndex,
    })),
  }));
}

/**
 * Atomic selection itinerary edit: replace days, regenerate AUTO cost lines
 * (keep MANUAL overrides), recompute pricing and move NEW/REVISION leads to
 * DRAFTING. Locked lead-wide once the lead is quoted or later. This full
 * delete+recreate write is also what materializes a previously-pristine
 * selection — a genuinely new edit and "first materialization" are the same
 * operation here.
 */
export async function applyLeadSelectionItinerary({
  leadId,
  selectionId,
  days = [],
  pricingSettings = {},
  actorId = null,
  actor = 'USER',
  fetchImpl = fetch,
  prismaClient = prisma,
}) {
  const lead = await prismaClient.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError('Lead not found', 404);

  if (EDIT_BLOCKED_STATUSES.includes(lead.lifecycleStatus)) {
    throw new AppError('Itinerary edits are locked after QUOTED; move back to DRAFTING first', 400);
  }

  const selection = await prismaClient.leadPackageSelection.findUnique({
    where: { id: selectionId },
    include: { pricing: true, costLines: true, itineraryDays: true },
  });
  if (!selection || selection.leadId !== leadId) {
    throw new AppError('Package selection not found', 404);
  }

  // Lazily fetches the package blueprint at most once, for whichever of the
  // two fallbacks below actually needs it.
  let pkg;
  const loadPackage = async () => {
    if (pkg !== undefined) return pkg;
    if (!selection.packageId) return (pkg = null);
    try {
      pkg = await fetchPackage(selection.packageId, fetchImpl);
    } catch {
      pkg = null;
    }
    return pkg;
  };

  // Ensure a pricing row exists; a fresh real-package selection inherits
  // currency/margin from the package blueprint.
  let pricing = selection.pricing;
  if (!pricing) {
    const blueprint = await loadPackage();
    const defaults = blueprint
      ? {
          currency: blueprint.currency || 'USD',
          marginType: blueprint.defaultMarginType || null,
          marginValue: blueprint.defaultMarginInput != null ? Number(blueprint.defaultMarginInput) : null,
        }
      : { currency: 'USD', marginType: null, marginValue: null };
    pricing = await prismaClient.leadPricing.create({
      data: { leadPackageSelectionId: selection.id, ...defaults },
    });
  }

  const nextStatus =
    lead.lifecycleStatus === 'NEW' || lead.lifecycleStatus === 'REVISION'
      ? 'DRAFTING'
      : lead.lifecycleStatus;

  const daysCreate = buildDaysCreateData(days);
  const autoLines = buildAutoCostLines(days);
  // Flat-priced packages (no day-by-day breakdown) have nothing for
  // buildAutoCostLines to derive from — fall back to a single line from the
  // package's basePrice so saving/previewing doesn't freeze the total at 0.
  if (autoLines.length === 0) {
    const blueprint = await loadPackage();
    if (Number(blueprint?.basePrice) > 0) {
      autoLines.push({
        category: 'package',
        description: blueprint.title || 'Package price',
        basis: 'FIXED',
        quantity: 1,
        estimatedUnitPrice: Number(blueprint.basePrice),
        actualUnitPrice: null,
        marginType: null,
        marginValue: null,
        source: 'AUTO',
        orderIndex: 0,
      });
    }
  }

  await prismaClient.$transaction(async (tx) => {
    await tx.leadItineraryDay.deleteMany({ where: { leadPackageSelectionId: selection.id } });
    await tx.leadCostLine.deleteMany({ where: { leadPackageSelectionId: selection.id, source: 'AUTO' } });
  });

  await prismaClient.leadPackageSelection.update({
    where: { id: selection.id },
    data: {
      ...(daysCreate.length ? { itineraryDays: { create: daysCreate } } : {}),
      costLines: { create: autoLines },
      // A manual edit means this selection no longer matches its package's
      // blueprint verbatim — "refresh from original package" is what
      // reverts this, nothing else should silently overwrite it.
      sourcePackageId: null,
    },
  });

  if (nextStatus !== lead.lifecycleStatus) {
    await prismaClient.lead.update({
      where: { id: lead.id },
      data: {
        lifecycleStatus: nextStatus,
        primarySelectionId: lead.primarySelectionId ?? selection.id,
        statusHistory: {
          create: [{
            status: nextStatus,
            actor,
            changedById: actorId,
            notes: actor === 'SYSTEM' ? 'Itinerary edited by voice agent — moved to drafting' : 'Itinerary edited — moved to drafting',
          }],
        },
      },
    });
  }

  // Persist pricing settings + recomputed totals.
  const settings = { ...pricing, ...pricingSettings };
  const freshLines = await prismaClient.leadCostLine.findMany({ where: { leadPackageSelectionId: selection.id } });
  const computed = computePricing({
    lines: freshLines.map(toLineDescriptor),
    travelers: lead.numberOfTravelers || 1,
    currency: settings.currency || 'USD',
    marginType: settings.marginType || null,
    marginValue: Number(settings.marginValue) || 0,
    depositType: settings.depositType || null,
    depositValue: Number(settings.depositValue) || 0,
    discountType: settings.discountType || 'none',
    discountValue: Number(settings.discountValue) || 0,
    serviceChargeRate: Number(settings.serviceChargeRate) || 0,
    verifiedPaymentTotal: Number(settings.paidAmount) || 0,
  });
  await prismaClient.leadPricing.update({
    where: { leadPackageSelectionId: selection.id },
    data: {
      currency: settings.currency || 'USD',
      marginType: settings.marginType ?? pricing.marginType ?? null,
      marginValue: settings.marginValue ?? pricing.marginValue ?? null,
      depositType: settings.depositType ?? pricing.depositType ?? null,
      depositValue: settings.depositValue ?? pricing.depositValue ?? 0,
      discountType: settings.discountType || 'none',
      discountValue: Number(settings.discountValue) || 0,
      serviceChargeRate: Number(settings.serviceChargeRate) || 0,
      estimatedTotal: computed.estimatedTotal,
      actualTotal: computed.actualTotal,
      sellSubtotal: computed.sellSubtotal,
      discountAmount: computed.discountAmount,
      taxableSubtotal: computed.taxableSubtotal,
      taxAmount: computed.taxAmount,
      serviceChargeAmount: computed.serviceChargeAmount,
      totalAmount: computed.totalAmount,
      depositAmount: computed.depositAmount,
      paidAmount: computed.paidAmount,
      balanceDue: computed.balanceDue,
      profit: computed.profit,
    },
  });

  return { leadId, selectionId: selection.id, lifecycleStatus: nextStatus };
}

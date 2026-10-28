import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import { fetchPackage, buildDraftData } from './lead-draft.service.js';
import { computePricing, toLineDescriptor } from './pricing.service.js';
// zod v4, bundled inside @travel-crm/contracts — never .extend()/.merge() this
// with a local (zod v3) validator schema, only .parse() it standalone.
import { LeadSnapshotForQuotation } from '@travel-crm/contracts';

const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://localhost:3006';

/**
 * A selection's children (itineraryDays/pricing) are lazy — a "pristine"
 * selection has none persisted and is derived from the live package on read.
 */
export async function isSelectionMaterialized(selectionId, prismaClient = prisma) {
  const [dayCount, pricingRow] = await Promise.all([
    prismaClient.leadItineraryDay.count({ where: { leadPackageSelectionId: selectionId } }),
    prismaClient.leadPricing.findUnique({ where: { leadPackageSelectionId: selectionId } }),
  ]);
  return dayCount > 0 || Boolean(pricingRow);
}

/**
 * Creates a LeadPackageSelection for leadId/packageId if one doesn't already
 * exist, and sets it as the lead's primary selection when none is set yet.
 * Shared by the live voice attach_package tool and lead intake (auto-selecting
 * a package a new caller already named) — same "attach, don't overwrite"
 * contract either way.
 */
export async function attachPackageToLead(leadId, packageId, { primarySelectionId = null, prismaClient = prisma } = {}) {
  const existing = await prismaClient.leadPackageSelection.findFirst({ where: { leadId, packageId } });
  if (existing) {
    return { selectionId: existing.id, packageName: existing.packageName, alreadyAttached: true };
  }

  let packageName = null;
  try {
    const pkg = await fetchPackage(packageId);
    packageName = pkg.title || null;
  } catch {
    // package-service unreachable — attach anyway; name refreshes on materialize.
  }

  const selection = await prismaClient.leadPackageSelection.create({
    data: { leadId, packageId, isManual: false, packageName },
  });
  if (!primarySelectionId) {
    await prismaClient.lead.update({ where: { id: leadId }, data: { primarySelectionId: selection.id } });
  }

  return { selectionId: selection.id, packageName, alreadyAttached: false };
}

function createDefaultManualDay() {
  return {
    dayNumber: 1,
    title: null,
    description: null,
    breakfastCount: 0,
    lunchCount: 0,
    dinnerCount: 0,
    mealPriceOverride: null,
    accommodation: {},
    flights: [],
    places: { create: [] },
    activities: { create: [] },
    transports: { create: [] },
  };
}

/**
 * Adapts the nested Prisma create-shaped days (from buildDraftData /
 * createDefaultManualDay — `places: {create:[...]}` etc.) into the same flat
 * editor-day shape `serializeLeadDays` produces from persisted rows, so a
 * derived (not-yet-persisted) view and a materialized view are
 * interchangeable from the API's perspective. Derived rows have no `id`.
 */
export function toEditorDays(days) {
  return (days || []).map((day) => ({
    dayNumber: day.dayNumber,
    title: day.title,
    description: day.description,
    breakfastCount: day.breakfastCount,
    lunchCount: day.lunchCount,
    dinnerCount: day.dinnerCount,
    mealPriceOverride: day.mealPriceOverride ?? null,
    accommodation: day.accommodation || {},
    flights: day.flights || [],
    places: (day.places?.create || []).map((p) => ({
      id: null, placeId: p.placeId, place: null, customName: p.customName, orderIndex: p.orderIndex,
    })),
    activities: (day.activities?.create || []).map((a) => ({
      id: null, activityId: a.activityId, activity: null, name: a.name, description: a.description ?? null,
      defaultCost: a.defaultCost, costOverride: a.costOverride, orderIndex: a.orderIndex,
    })),
    transports: (day.transports?.create || []).map((t) => ({
      id: null, routeType: t.routeType, transportMode: t.transportMode, pricingModel: t.pricingModel,
      unitCost: t.unitCost, distanceKm: t.distanceKm, origin: t.origin, destination: t.destination,
    })),
    images: (day.images?.create || []).map((img) => ({
      id: null, url: img.url, altText: img.altText ?? null, orderIndex: img.orderIndex,
    })),
  }));
}

/**
 * Read-only: computes the itinerary/cost-lines/pricing shape a pristine
 * selection would have, without persisting anything. For a real package this
 * fetches the live blueprint from package-service; for the manual slot it's
 * a single blank day with no cost lines.
 */
export async function deriveSelectionView({ selection, fetchImpl = fetch }) {
  if (selection.isManual) {
    return {
      packageName: null,
      days: [createDefaultManualDay()],
      costLines: [],
      pricing: { currency: 'USD', marginType: null, marginValue: null },
    };
  }
  const pkg = await fetchPackage(selection.packageId, fetchImpl);
  const { packageName, days, costLines, pricing } = buildDraftData(pkg);
  return { packageName, days, costLines, pricing };
}

/**
 * Persists what `deriveSelectionView` would compute into the selection's
 * child rows — used when a still-pristine selection is quoted, so the
 * quotation and the lead's own copy freeze the same state. No-op if the
 * selection is already materialized.
 */
export async function materializeSelection({ selectionId, fetchImpl = fetch, prismaClient = prisma }) {
  const selection = await prismaClient.leadPackageSelection.findUnique({ where: { id: selectionId } });
  if (!selection) throw new AppError('Package selection not found', 404);

  if (await isSelectionMaterialized(selectionId, prismaClient)) {
    return selection;
  }

  const { packageName, days, costLines, pricing } = await deriveSelectionView({ selection, fetchImpl });

  try {
    return await prismaClient.leadPackageSelection.update({
      where: { id: selectionId },
      data: {
        ...(packageName != null ? { packageName } : {}),
        sourcePackageId: selection.isManual ? null : selection.packageId,
        itineraryDays: { create: days },
        costLines: { create: costLines },
        pricing: { create: pricing },
      },
    });
  } catch (err) {
    // Two callers can pass the pristine check above at once — both then try to
    // create the same dayNumber for this selection, and the loser gets a
    // unique-violation (P2002) on rows the winner derived identically. Its own
    // transaction has rolled back and the winner's has committed, so re-read
    // and return that instead of failing the caller's separate write.
    if (err?.code !== 'P2002' || !(await isSelectionMaterialized(selectionId, prismaClient))) {
      throw err;
    }
    return prismaClient.leadPackageSelection.findUnique({ where: { id: selectionId } });
  }
}

/**
 * "Refresh from original package" — discards a selection's persisted
 * itinerary/cost-line/pricing overrides, reverting it to pristine (it will
 * be re-derived from the live package on next read). Optional transfer
 * flights are left untouched — they're rep-entered preferences independent
 * of the package blueprint, nothing to "revert" them to.
 *
 * Refuses on the manual slot (nothing to refresh from). Refuses on a
 * selection with an active quotation unless `force` is passed — refreshing
 * would desync the lead's saved itinerary from what was actually quoted.
 */
export async function refreshSelection({ selectionId, force = false, prismaClient = prisma }) {
  const selection = await prismaClient.leadPackageSelection.findUnique({ where: { id: selectionId } });
  if (!selection) throw new AppError('Package selection not found', 404);
  if (selection.isManual) {
    throw new AppError('Manual itinerary has no original package to refresh from', 400);
  }
  if (selection.currentQuoteId && !force) {
    throw new AppError(
      'This package has already been quoted — refreshing will make the saved itinerary no longer match what was quoted',
      409,
      { code: 'REFRESH_BLOCKED_QUOTED' },
    );
  }

  await prismaClient.$transaction([
    prismaClient.leadItineraryDay.deleteMany({ where: { leadPackageSelectionId: selectionId } }),
    prismaClient.leadCostLine.deleteMany({ where: { leadPackageSelectionId: selectionId } }),
    prismaClient.leadPricing.deleteMany({ where: { leadPackageSelectionId: selectionId } }),
  ]);

  return prismaClient.leadPackageSelection.update({
    where: { id: selectionId },
    data: { sourcePackageId: null, pendingAiChange: null },
  });
}

/**
 * Mirror a selection's computed total onto the lead's free-text `budget` so the
 * lead summary reflects the currently-quoted package. Only syncs from the lead's
 * primary selection (adopting this one as primary when the lead has none yet).
 * Best-effort: a no-op when there's no pricing/total.
 */
export async function syncLeadBudgetFromSelection(leadId, selectionId, prismaClient = prisma) {
  const [lead, pricing] = await Promise.all([
    prismaClient.lead.findUnique({ where: { id: leadId }, select: { primarySelectionId: true } }),
    prismaClient.leadPricing.findUnique({ where: { leadPackageSelectionId: selectionId } }),
  ]);
  if (!lead || !pricing) return;
  const isPrimary = !lead.primarySelectionId || lead.primarySelectionId === selectionId;
  if (!isPrimary) return;
  const total = Number(pricing.totalAmount) || 0;
  if (total <= 0) return;
  const currency = pricing.currency || 'USD';
  const budget = `${currency} ${total.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  await prismaClient.lead.update({ where: { id: leadId }, data: { budget } });
}

/**
 * Recompute and persist all pricing totals for a selection from its current
 * cost lines. Mirrors the lead-wide version this replaced, scoped down.
 */
export async function recomputeSelectionPricing(selectionId, verifiedPaymentTotal = null, prismaClient = prisma) {
  const selection = await prismaClient.leadPackageSelection.findUnique({
    where: { id: selectionId },
    include: { pricing: true, costLines: true, lead: true },
  });
  if (!selection) throw new AppError('Package selection not found', 404);
  const pricing = selection.pricing || {};
  const computed = computePricing({
    lines: selection.costLines.map(toLineDescriptor),
    travelers: selection.lead.numberOfTravelers || 1,
    currency: pricing.currency || 'USD',
    marginType: pricing.marginType || null,
    marginValue: Number(pricing.marginValue) || 0,
    depositType: pricing.depositType || null,
    depositValue: Number(pricing.depositValue) || 0,
    discountType: pricing.discountType || 'none',
    discountValue: Number(pricing.discountValue) || 0,
    serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
    verifiedPaymentTotal: (verifiedPaymentTotal ?? Number(pricing.paidAmount)) || 0,
  });
  return prismaClient.leadPricing.update({
    where: { leadPackageSelectionId: selectionId },
    data: {
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
}

/**
 * Snapshot a selection's pricing into a versioned billing quotation. A still
 * -pristine selection is materialized first so the quotation and the lead's
 * own copy freeze the same state.
 */
export async function snapshotSelectionQuotation(selectionId, { createdById = null, fetchImpl = fetch, prismaClient = prisma } = {}) {
  if (!(await isSelectionMaterialized(selectionId, prismaClient))) {
    await materializeSelection({ selectionId, fetchImpl, prismaClient });
  }

  const selection = await prismaClient.leadPackageSelection.findUnique({
    where: { id: selectionId },
    include: {
      pricing: true,
      costLines: true,
      lead: true,
      itineraryDays: {
        orderBy: { dayNumber: 'asc' },
        include: { places: true, activities: true, images: { orderBy: { orderIndex: 'asc' } } },
      },
    },
  });
  if (!selection) throw new AppError('Package selection not found', 404);
  const { pricing, lead } = selection;
  if (!pricing) throw new AppError('Selection has no pricing yet', 400);

  const computed = computePricing({
    lines: selection.costLines.map(toLineDescriptor),
    travelers: lead.numberOfTravelers || 1,
    currency: pricing.currency || 'USD',
    marginType: pricing.marginType || null,
    marginValue: Number(pricing.marginValue) || 0,
    depositType: pricing.depositType || null,
    depositValue: Number(pricing.depositValue) || 0,
    discountType: pricing.discountType || 'none',
    discountValue: Number(pricing.discountValue) || 0,
    serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
    verifiedPaymentTotal: Number(pricing.paidAmount) || 0,
  });

  const items = computed.lines.map((l) => ({
    description: l.description,
    category: l.category,
    quantity: l.quantity,
    unitPrice: l.quotedUnitPrice,
    notes: null,
  }));

  // Enrich the quotation with the package's inclusions/exclusions plus the trip
  // details the branded PDF renders (title, destination, itinerary, hero image).
  // A package-fetch failure must not block quoting.
  let includedServices = [];
  let excludedServices = [];
  let pkg = null;
  if (selection.packageId) {
    try {
      pkg = await fetchPackage(selection.packageId, fetchImpl);
      if (Array.isArray(pkg?.inclusions)) includedServices = pkg.inclusions.filter(Boolean);
      if (Array.isArray(pkg?.exclusions)) excludedServices = pkg.exclusions.filter(Boolean);
    } catch {
      // Leave enrichment empty rather than failing the snapshot.
    }
  }

  // Day-by-day itinerary for the PDF, built from the LEAD's own itinerary
  // copy (selection.itineraryDays) rather than the live package blueprint —
  // materializeSelection() above guarantees this is populated (either the
  // rep's own edits, including any day images/activities, or a freeze of the
  // package blueprint for a still-pristine selection). Using the package
  // blueprint here previously meant lead-side edits could never reach the
  // quotation at all.
  const itineraryDays = (selection.itineraryDays || []).map((day, idx) => ({
    day: day.dayNumber ?? idx + 1,
    title: day.title || `Day ${day.dayNumber ?? idx + 1}`,
    locations: (day.places || []).map((p) => p.customName).filter(Boolean),
    meals: [
      day.breakfastCount > 0 && 'Breakfast',
      day.lunchCount > 0 && 'Lunch',
      day.dinnerCount > 0 && 'Dinner',
    ].filter(Boolean),
    activities: (day.activities || [])
      .map((a) => ({
        name: a.name,
        description: a.description ?? null,
        cost: a.costOverride != null ? Number(a.costOverride) : (a.defaultCost != null ? Number(a.defaultCost) : null),
      }))
      .filter((a) => a.name),
    // Multi-image strategy: only the first image (orderIndex 0) per day is
    // carried into the quotation snapshot — keeps the PDF print-friendly.
    // Remaining images stay stored/editable in Management but aren't quoted.
    images: (day.images || []).slice(0, 1).map((i) => i.url),
  }));

  // Marketing highlights: split the package description into a few bullets.
  const highlights = String(pkg?.description || '')
    .split(/\r?\n|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  const durationDays = pkg?.durationDays ?? (itineraryDays.length || null);
  const durationNights = durationDays ? Math.max(durationDays - 1, 0) : null;

  const payload = LeadSnapshotForQuotation.parse({
    leadId: lead.id,
    packageId: selection.packageId,
    // The acting user, threaded from the /quote request. billing has no
    // request user on this internal (gateway-bypassing) call.
    createdById,
    currency: pricing.currency || 'USD',
    customer: { name: lead.name, email: lead.email, phone: lead.phone, address: lead.city },
    items,
    discountType: pricing.discountType || 'none',
    discountValue: Number(pricing.discountValue) || 0,
    serviceChargeRate: Number(pricing.serviceChargeRate) || 0,
    notes: null,
    terms: null,
    paymentTerms: null,
    includedServices,
    excludedServices,
    // Trip snapshot for the branded quotation PDF. A rep's explicit
    // destinationOverride wins first, then the selected package's own
    // destination (same precedence as coverImage below) — by the time a
    // quotation is built a specific package has been selected, so its
    // destination is authoritative. lead.destination is the last resort:
    // it's often just the customer's original inquiry-stage note (e.g.
    // "Multiple options" for a still-deciding lead) and would otherwise
    // leak into the PDF verbatim.
    destination: selection.destinationOverride || pkg?.destination || lead.destination || null,
    packageTitle: selection.packageName || pkg?.title || null,
    travelStartDate: lead.travelDate || null,
    travelEndDate: lead.endDate || null,
    paxCount: lead.numberOfTravelers || null,
    durationNights,
    durationDays,
    highlights,
    itineraryDays,
    // Cover-image rule: package's cover image wins if set, else fall back to
    // the lead's own day-1 photo (the rep's own upload), else none (the PDF
    // generator degrades to a solid-brand-color banner).
    coverImage: pkg?.coverImage || itineraryDays[0]?.images?.[0] || null,
  });

  const res = await fetchImpl(`${BILLING_SERVICE_URL}/api/v1/billing/quotations/from-lead`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new AppError('Failed to snapshot quotation in billing-service', 502);
  }
  const json = await res.json();
  return json.data;
}

export async function sendVoiceQuotation(quotationId, payload, requestId, fetchImpl = fetch) {
  const token = process.env.INTERNAL_EVENTS_TOKEN;
  if (!token) throw new AppError('INTERNAL_EVENTS_TOKEN is not configured', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetchImpl(`${BILLING_SERVICE_URL}/api/v1/billing/quotations/${encodeURIComponent(quotationId)}/send-voice-auto`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(json?.message || `billing-service ${res.status}`, 502);
    return json.data ?? json;
  } finally {
    clearTimeout(timer);
  }
}

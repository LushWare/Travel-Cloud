import prisma from '../db/client.js';
import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { createPackageSelectionSchema, updatePackageSelectionSchema, addOptionalFlightSchema } from '../validators/lead.validator.js';
import { validateTransition } from '../services/state-machine.service.js';
import { gatekeeperInputs } from '../services/gatekeeper.service.js';
import { fetchPackage } from '../services/lead-draft.service.js';
import {
  deriveSelectionView,
  toEditorDays,
  isSelectionMaterialized,
  materializeSelection,
  refreshSelection,
  recomputeSelectionPricing,
  snapshotSelectionQuotation,
  sendVoiceQuotation,
  syncLeadBudgetFromSelection,
} from '../services/lead-selection.service.js';
import {
  applyLeadSelectionItinerary,
  serializeLeadDays,
  buildAutoCostLines,
  EDIT_BLOCKED_STATUSES,
} from '../services/lead-itinerary.service.js';
import { computePricing, toLineDescriptor } from '../services/pricing.service.js';

const FULL_SELECTION_INCLUDE = {
  pricing: true,
  costLines: { orderBy: { orderIndex: 'asc' } },
  itineraryDays: {
    orderBy: { dayNumber: 'asc' },
    include: {
      places: true,
      activities: true,
      transports: true,
      images: { orderBy: { orderIndex: 'asc' } },
    },
  },
  optionalFlights: true,
  lead: { select: { numberOfTravelers: true } },
};

async function loadOwnedSelection(leadId, selectionId, include = {}) {
  const selection = await prisma.leadPackageSelection.findUnique({ where: { id: selectionId }, include });
  if (!selection || selection.leadId !== leadId) {
    throw new AppError('Package selection not found', 404);
  }
  return selection;
}

async function presentSelection(selection) {
  const isMaterialized = selection.itineraryDays.length > 0 || Boolean(selection.pricing);
  if (isMaterialized) {
    return { ...selection, itineraryDays: serializeLeadDays(selection), isMaterialized: true };
  }
  try {
    const derived = await deriveSelectionView({ selection });
    // A pristine selection has no persisted LeadPricing row — derived.pricing
    // is only currency/margin settings. Compute the prospective totals from
    // its derived cost lines so the UI shows the real price up front instead
    // of a bare settings object (which renders as $0.00, not "no pricing yet").
    const computed = computePricing({
      lines: derived.costLines.map(toLineDescriptor),
      travelers: selection.lead?.numberOfTravelers || 1,
      currency: derived.pricing.currency,
      marginType: derived.pricing.marginType,
      marginValue: derived.pricing.marginValue,
    });
    return {
      ...selection,
      itineraryDays: toEditorDays(derived.days),
      costLines: derived.costLines,
      pricing: { ...derived.pricing, ...computed },
      isMaterialized: false,
    };
  } catch {
    // package-service unreachable for this selection — degrade gracefully
    // rather than failing the whole list/response.
    return { ...selection, itineraryDays: [], costLines: [], pricing: null, isMaterialized: false, derivationError: true };
  }
}

// ─── Selection CRUD ─────────────────────────────────────────────

export const listPackageSelections = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const selections = await prisma.leadPackageSelection.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    include: FULL_SELECTION_INCLUDE,
  });

  const results = await Promise.all(selections.map(presentSelection));
  res.json({ success: true, data: results });
});

export const getPackageSelection = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId, FULL_SELECTION_INCLUDE);
  res.json({ success: true, data: await presentSelection(selection) });
});

export const createPackageSelection = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const parsed = createPackageSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const { packageId, isManual } = parsed.data;

  if (isManual) {
    const existingManual = await prisma.leadPackageSelection.findFirst({ where: { leadId: lead.id, isManual: true } });
    if (existingManual) throw new AppError('Lead already has a manual itinerary selection', 400);
  } else {
    const existingPackage = await prisma.leadPackageSelection.findFirst({ where: { leadId: lead.id, packageId } });
    if (existingPackage) throw new AppError('This package is already attached to the lead', 400);
  }

  let packageName = null;
  if (!isManual) {
    try {
      const pkg = await fetchPackage(packageId);
      packageName = pkg.title || null;
    } catch {
      // package-service unreachable — selection still created; the name
      // snapshot is refreshed the next time this selection is materialized.
    }
  }

  const selection = await prisma.leadPackageSelection.create({
    data: { leadId: lead.id, packageId: isManual ? null : packageId, isManual: Boolean(isManual), packageName },
  });

  if (!lead.primarySelectionId) {
    await prisma.lead.update({ where: { id: lead.id }, data: { primarySelectionId: selection.id } });
  }

  res.status(201).json({
    success: true,
    data: { ...selection, itineraryDays: [], costLines: [], optionalFlights: [], pricing: null, isMaterialized: false },
  });
});

export const updatePackageSelection = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId);

  const parsed = updatePackageSelectionSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }

  const updated = await prisma.leadPackageSelection.update({
    where: { id: selection.id },
    data: parsed.data,
  });
  res.json({ success: true, data: updated });
});

export const deletePackageSelection = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId);
  await prisma.leadPackageSelection.delete({ where: { id: selection.id } });

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (lead && lead.primarySelectionId === selection.id) {
    const next = await prisma.leadPackageSelection.findFirst({
      where: { leadId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    await prisma.lead.update({ where: { id: req.params.id }, data: { primarySelectionId: next?.id ?? null } });
  }
  res.json({ success: true, data: {} });
});

// ─── Itinerary / refresh / quote ────────────────────────────────

export const updateSelectionItinerary = asyncHandler(async (req, res) => {
  const { days, pricing } = req.body;
  if (!Array.isArray(days)) throw new AppError('days array is required', 400);

  await loadOwnedSelection(req.params.id, req.params.selectionId);

  const result = await applyLeadSelectionItinerary({
    leadId: req.params.id,
    selectionId: req.params.selectionId,
    days,
    pricingSettings: pricing || {},
    actorId: req.user.id,
  });
  await syncLeadBudgetFromSelection(req.params.id, req.params.selectionId, prisma);

  const selection = await prisma.leadPackageSelection.findUnique({
    where: { id: req.params.selectionId },
    include: FULL_SELECTION_INCLUDE,
  });

  res.json({
    success: true,
    data: { ...result, selection: { ...selection, itineraryDays: serializeLeadDays(selection), isMaterialized: true } },
  });
});

export const refreshPackageSelection = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);
  await loadOwnedSelection(req.params.id, req.params.selectionId);

  if (EDIT_BLOCKED_STATUSES.includes(lead.lifecycleStatus)) {
    throw new AppError('Itinerary edits are locked after QUOTED; move back to DRAFTING first', 400);
  }

  const force = Boolean(req.body?.force);
  const selection = await refreshSelection({ selectionId: req.params.selectionId, force });
  res.json({ success: true, data: selection });
});

export const quotePackageSelection = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  // Ownership check first, before any materialization side effects.
  await loadOwnedSelection(req.params.id, req.params.selectionId);

  // A still-pristine selection has no persisted pricing/cost lines — the UI
  // shows a computed preview, but the gatekeeper needs the persisted numbers.
  // Materialize it (freeze the package blueprint/manual default), then
  // recompute totals so sellSubtotal matches what the quotation snapshot
  // sends to billing instead of staying 0 and rejecting the quote.
  if (!(await isSelectionMaterialized(req.params.selectionId))) {
    await materializeSelection({ selectionId: req.params.selectionId });
  }
  await recomputeSelectionPricing(req.params.selectionId);

  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId, { pricing: true, costLines: true });

  const pricingInputs = gatekeeperInputs(selection.pricing, selection.costLines);
  const statusHistoryCreate = [];
  let effectiveStatus = lead.lifecycleStatus;

  // A NEW lead with a priced selection is implicitly ready to draft — the
  // same auto-promotion applyLeadSelectionItinerary/draftLead already apply
  // elsewhere — so quoting shouldn't require a separate manual "move to
  // drafting" step first.
  if (effectiveStatus === 'NEW') {
    validateTransition({ currentStatus: effectiveStatus, nextStatus: 'DRAFTING', pricing: pricingInputs });
    effectiveStatus = 'DRAFTING';
    statusHistoryCreate.push({ status: 'DRAFTING', actor: 'USER', changedById: req.user.id, notes: 'Moved to drafting' });
  }

  validateTransition({
    currentStatus: effectiveStatus,
    nextStatus: 'QUOTED',
    pricing: pricingInputs,
  });

  const quotation = await snapshotSelectionQuotation(selection.id, { createdById: req.user.id });

  await prisma.leadPackageSelection.update({
    where: { id: selection.id },
    data: { currentQuoteId: quotation.id },
  });
  // Re-fetch and present the same way listPackageSelections/getPackageSelection
  // do, so callers always get itineraryDays/costLines/pricing/isMaterialized —
  // never the bare Prisma row (see @travel-crm/contracts' LeadPackageSelectionSummary
  // vs LeadPackageSelectionRaw for why these two shapes must not be conflated).
  const fullSelection = await prisma.leadPackageSelection.findUnique({
    where: { id: selection.id },
    include: FULL_SELECTION_INCLUDE,
  });
  const updatedSelection = await presentSelection(fullSelection);

  const leadUpdateData = { primarySelectionId: selection.id };
  if (lead.lifecycleStatus !== 'QUOTED') {
    statusHistoryCreate.push({ status: 'QUOTED', actor: 'USER', changedById: req.user.id, notes: 'Quotation snapshot sent to billing' });
    leadUpdateData.lifecycleStatus = 'QUOTED';
    leadUpdateData.statusHistory = { create: statusHistoryCreate };
  }
  await prisma.lead.update({
    where: { id: lead.id },
    data: leadUpdateData,
  });
  // This selection is now the primary — reflect its total on the lead budget.
  await syncLeadBudgetFromSelection(lead.id, selection.id, prisma);
  const updatedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
    include: { statusHistory: { orderBy: { changedAt: 'desc' } } },
  });

  res.json({ success: true, data: { selection: updatedSelection, lead: updatedLead, quotation } });
});

const VoiceAutoQuoteRequest = z.object({
  leadId: z.string().min(1),
  bookingId: z.string().min(1),
  packageId: z.string().min(1),
  searchPriceSnapshot: z.number().finite().nonnegative(),
});

async function flagVoiceAutoQuoteForReview(leadId, reason) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      needsRepFollowup: true,
      voiceNeedsRepReview: true,
      voiceReviewReason: reason,
    },
  });
}

export const autoQuoteVoiceBooking = asyncHandler(async (req, res) => {
  const parsed = VoiceAutoQuoteRequest.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid voice quotation request', 400);
  const { leadId, bookingId, packageId, searchPriceSnapshot } = parsed.data;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError('Lead not found', 404);

  const canRetryDelivery = ['auto_quote_delivery_failed', 'auto_quote_generation_failed'].includes(lead.voiceReviewReason);
  if (lead.convertedBookingId !== bookingId
    || !lead.voiceExactPackageMatch
    || !lead.voiceCustomerIdentityConfirmed
    || !lead.voiceAiBookingAllowed
    || lead.voicePriceChanged
    || (lead.voiceNeedsRepReview && !canRetryDelivery)) {
    return res.status(409).json({ success: false, data: { issued: false, reason: 'voice_booking_not_eligible' } });
  }

  const selection = await prisma.leadPackageSelection.findFirst({ where: { leadId, packageId } });
  if (!selection || selection.pendingAiChange) {
    await flagVoiceAutoQuoteForReview(leadId, 'package_changed_requires_repricing');
    return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'package_changed_requires_repricing' } });
  }

  try {
    const pkg = await fetchPackage(packageId);
    const currentPrice = Number(pkg.sellPrice);
    if (!pkg.isActive || !Number.isFinite(currentPrice) || Math.abs(currentPrice - searchPriceSnapshot) > 0.01) {
      await flagVoiceAutoQuoteForReview(leadId, 'package_price_changed_since_search');
      return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'package_price_changed_since_search' } });
    }

    if (!(await isSelectionMaterialized(selection.id))) await materializeSelection({ selectionId: selection.id });
    await recomputeSelectionPricing(selection.id);
    const pricedSelection = await loadOwnedSelection(leadId, selection.id, { pricing: true, costLines: true });
    const pricingInputs = gatekeeperInputs(pricedSelection.pricing, pricedSelection.costLines);
    if (!Number.isFinite(pricingInputs.sellSubtotal)
      || Math.abs(pricingInputs.sellSubtotal - searchPriceSnapshot) > 0.01) {
      await flagVoiceAutoQuoteForReview(leadId, 'quotation_package_price_mismatch');
      return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'quotation_package_price_mismatch' } });
    }
    const statusHistory = [];
    let nextStatus = lead.lifecycleStatus;
    const transition = (status, notes) => {
      validateTransition({ currentStatus: nextStatus, nextStatus: status, pricing: pricingInputs });
      statusHistory.push({ status, actor: 'SYSTEM', changedById: null, notes });
      nextStatus = status;
    };

    if (nextStatus === 'PENDING_VERIFICATION') {
      transition('NEW', 'Voice booking details verified for automatic quotation');
    }
    if (nextStatus === 'NEW') {
      transition('DRAFTING', 'Voice exact-package quotation prepared');
    }
    if (nextStatus !== 'QUOTED') {
      if (!['DRAFTING', 'REVISION'].includes(nextStatus)) {
        await flagVoiceAutoQuoteForReview(leadId, 'lead_status_requires_rep_review');
        return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'lead_status_requires_rep_review' } });
      }
      transition('QUOTED', 'Exact-package voice quotation sent by email and WhatsApp');
    }

    let quotationId = selection.currentQuoteId;
    if (!quotationId) {
      const quotation = await snapshotSelectionQuotation(selection.id);
      quotationId = quotation.id;
      await prisma.leadPackageSelection.update({
        where: { id: selection.id },
        data: { currentQuoteId: quotationId },
      });
      if (!Number.isFinite(Number(quotation.subtotal))
        || Math.abs(Number(quotation.subtotal) - searchPriceSnapshot) > 0.01) {
        await flagVoiceAutoQuoteForReview(leadId, 'quotation_package_price_mismatch');
        return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'quotation_package_price_mismatch' } });
      }
    }

    const delivery = await sendVoiceQuotation(quotationId, {
      leadId,
      packageId,
      expectedPackagePrice: searchPriceSnapshot,
    }, req.requestId);
    if (!delivery.allSent) {
      await flagVoiceAutoQuoteForReview(leadId, 'auto_quote_delivery_failed');
      return res.json({
        success: true,
        data: { issued: false, needsRepFollowup: true, quotationId, delivery, reason: 'auto_quote_delivery_failed' },
      });
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        primarySelectionId: selection.id,
        lifecycleStatus: 'QUOTED',
        needsRepFollowup: false,
        voiceNeedsRepReview: false,
        voiceReviewReason: null,
        ...(statusHistory.length ? { statusHistory: { create: statusHistory } } : {}),
      },
    });
    await syncLeadBudgetFromSelection(leadId, selection.id);
    return res.json({ success: true, data: { issued: true, quotationId, delivery } });
  } catch (err) {
    req.log?.error({ err, leadId, bookingId }, 'Automatic voice quotation failed');
    await flagVoiceAutoQuoteForReview(leadId, 'auto_quote_generation_failed');
    return res.json({ success: true, data: { issued: false, needsRepFollowup: true, reason: 'auto_quote_generation_failed' } });
  }
});

// ─── Pricing ─────────────────────────────────────────────────────

export const getSelectionPricing = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId, {
    pricing: true,
    costLines: { orderBy: { orderIndex: 'asc' } },
    optionalFlights: true,
  });
  res.json({ success: true, data: { pricing: selection.pricing, costLines: selection.costLines, optionalFlights: selection.optionalFlights } });
});

export const calculateSelectionPricing = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId);

  const { lines, days, travelers = 1, ...settings } = req.body;
  if (!Array.isArray(lines) && !Array.isArray(days)) {
    throw new AppError('lines or days array is required', 400);
  }
  let resolvedLines;
  if (Array.isArray(lines)) {
    resolvedLines = lines;
  } else {
    let autoLines = buildAutoCostLines(days);
    const manualLines = await prisma.leadCostLine.findMany({
      where: { leadPackageSelectionId: req.params.selectionId, source: 'MANUAL' },
      orderBy: { orderIndex: 'asc' },
    });
    // Same flat-priced-package fallback as applyLeadSelectionItinerary — a
    // package with no day-by-day breakdown has nothing else to preview from.
    if (autoLines.length === 0 && manualLines.length === 0 && selection.packageId) {
      try {
        const blueprint = await fetchPackage(selection.packageId);
        if (Number(blueprint?.basePrice) > 0) {
          autoLines = [{
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
          }];
        }
      } catch {
        // package-service unreachable — preview with whatever lines exist
      }
    }
    resolvedLines = [...autoLines.map(toLineDescriptor), ...manualLines.map(toLineDescriptor)];
  }
  const computed = computePricing({ lines: resolvedLines, travelers, ...settings });
  res.json({ success: true, data: { financials: computed } });
});

export const applySelectionPricing = asyncHandler(async (req, res) => {
  const selection = await loadOwnedSelection(req.params.id, req.params.selectionId, { pricing: true });
  if (!selection.pricing) {
    throw new AppError('Selection has no pricing row; edit its itinerary first', 400);
  }

  const { settings = {}, lines, verifiedPaymentTotal } = req.body;

  if (lines !== undefined) {
    if (!Array.isArray(lines)) throw new AppError('lines must be an array', 400);
    const rows = lines.map((line, i) => ({
      category: line.category || 'other',
      description: line.description || '',
      basis: line.basis || 'FIXED',
      quantity: Number(line.quantity) || 1,
      // The engine derives the quote from estimatedUnitPrice; accept the common
      // alternate keys so a client that posts the cost under `unitPrice`/`cost`
      // doesn't silently zero the line (0 is still respected when explicit).
      estimatedUnitPrice: Number(line.estimatedUnitPrice ?? line.unitPrice ?? line.cost) || 0,
      actualUnitPrice: line.actualUnitPrice != null ? Number(line.actualUnitPrice) : null,
      marginType: line.marginType || null,
      marginValue: line.marginValue != null ? Number(line.marginValue) : null,
      source: line.source || 'MANUAL',
      dayNumber: line.dayNumber ?? null,
      flightBookingId: line.flightBookingId ?? null,
      optionalFlightId: line.optionalFlightId ?? null,
      orderIndex: line.orderIndex ?? i,
    }));
    await prisma.$transaction([
      prisma.leadCostLine.deleteMany({ where: { leadPackageSelectionId: selection.id } }),
      prisma.leadCostLine.createMany({ data: rows.map((r) => ({ ...r, leadPackageSelectionId: selection.id })) }),
    ]);
  }

  if (settings && Object.keys(settings).length) {
    await prisma.leadPricing.update({
      where: { leadPackageSelectionId: selection.id },
      data: {
        currency: settings.currency,
        marginType: settings.marginType,
        marginValue: settings.marginValue,
        depositType: settings.depositType,
        depositValue: settings.depositValue,
        discountType: settings.discountType,
        discountValue: settings.discountValue,
        serviceChargeRate: settings.serviceChargeRate,
      },
    });
  }

  const pricing = await recomputeSelectionPricing(selection.id, verifiedPaymentTotal);
  await syncLeadBudgetFromSelection(req.params.id, selection.id, prisma);
  res.json({ success: true, data: { pricing } });
});

// ─── Optional transfer flights ─────────────────────────────────

export const listSelectionFlights = asyncHandler(async (req, res) => {
  await loadOwnedSelection(req.params.id, req.params.selectionId);
  const flights = await prisma.leadOptionalFlight.findMany({
    where: { leadPackageSelectionId: req.params.selectionId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ success: true, data: flights });
});

export const addSelectionFlight = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);
  await loadOwnedSelection(req.params.id, req.params.selectionId);

  const parsed = addOptionalFlightSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const {
    flightType, origin, destination, date, cabinClass, departureTime,
    airlinePreference, notes, estimatedUnitPrice = 0, actualUnitPrice, marginType, marginValue,
  } = parsed.data;

  // Adding a rep-entered flight is itself a customization — materialize a
  // still-pristine selection first so there's a pricing row to recompute
  // into (flights are always persisted regardless of pristine/materialized
  // state, but the pricing scaffold underneath still needs to exist).
  if (!(await isSelectionMaterialized(req.params.selectionId))) {
    await materializeSelection({ selectionId: req.params.selectionId });
  }
  const selection = await prisma.leadPackageSelection.findUnique({
    where: { id: req.params.selectionId },
    include: { costLines: true },
  });

  const quantity = lead.numberOfTravelers || 1;
  const flight = await prisma.leadOptionalFlight.create({
    data: {
      leadPackageSelectionId: selection.id,
      flightType,
      origin: origin ?? null,
      destination: destination ?? null,
      date: date ? new Date(date) : null,
      cabinClass: cabinClass ?? null,
      departureTime: departureTime ?? null,
      airlinePreference: airlinePreference ?? null,
      notes: notes ?? null,
      estimatedUnitPrice: Number(estimatedUnitPrice) || 0,
      actualUnitPrice: actualUnitPrice != null ? Number(actualUnitPrice) : null,
      quantity,
      marginType: marginType || null,
      marginValue: marginValue != null ? Number(marginValue) : null,
    },
  });

  await prisma.leadCostLine.create({
    data: {
      leadPackageSelectionId: selection.id,
      category: 'transportation',
      description: `Flight: ${origin || '?'} → ${destination || '?'}`,
      basis: 'PER_PERSON',
      quantity,
      estimatedUnitPrice: Number(estimatedUnitPrice) || 0,
      actualUnitPrice: actualUnitPrice != null ? Number(actualUnitPrice) : null,
      marginType: marginType || null,
      marginValue: marginValue != null ? Number(marginValue) : null,
      source: 'MANUAL',
      optionalFlightId: flight.id,
      orderIndex: (selection.costLines || []).length,
    },
  });

  await recomputeSelectionPricing(selection.id);
  await syncLeadBudgetFromSelection(req.params.id, selection.id, prisma);
  res.status(201).json({ success: true, data: flight });
});

export const deleteSelectionFlight = asyncHandler(async (req, res) => {
  const { id, selectionId, flightId } = req.params;
  const selection = await loadOwnedSelection(id, selectionId);
  const flight = await prisma.leadOptionalFlight.findUnique({ where: { id: flightId } });
  if (!flight || flight.leadPackageSelectionId !== selection.id) throw new AppError('Flight not found', 404);

  await prisma.$transaction([
    prisma.leadCostLine.deleteMany({ where: { leadPackageSelectionId: selection.id, optionalFlightId: flightId } }),
    prisma.leadOptionalFlight.delete({ where: { id: flightId } }),
  ]);
  await recomputeSelectionPricing(selection.id);
  await syncLeadBudgetFromSelection(id, selection.id, prisma);
  res.json({ success: true, data: {} });
});

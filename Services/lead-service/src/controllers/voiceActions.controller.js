import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { toStatusClass } from '../constants/voice-status-class.js';
import { validateTransition, StateMachineError } from '../services/state-machine.service.js';
import {
  applyLeadSelectionItinerary,
  serializeLeadDays,
  EDIT_BLOCKED_STATUSES,
} from '../services/lead-itinerary.service.js';
import { attachPackageToLead } from '../services/lead-selection.service.js';
import { computePricing, toLineDescriptor } from '../services/pricing.service.js';
import { fetchPackage } from '../services/lead-draft.service.js';

const BLOCKED_MESSAGE = 'This lead is already being processed and cannot be changed by the voice agent — a specialist needs to review it.';

async function loadLead(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new AppError('Lead not found', 404);
  return lead;
}

async function resolveActiveSelection(lead) {
  if (lead.primarySelectionId) {
    const primary = await prisma.leadPackageSelection.findUnique({ where: { id: lead.primarySelectionId } });
    if (primary) return primary;
  }
  const selections = await prisma.leadPackageSelection.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  if (selections.length === 1) return selections[0];
  return null;
}

// Every write action here reaches a lead regardless of how it was created
// (a voice call may resume an existing rep-owned lead) — always mark it so a
// rep sees the AI touched it, whether or not the lead originated as a voice
// lead. Exact-match package confirmations are auto-book eligible; any
// package change that requires a price recalculation flags the lead for rep
// review instead of letting the agent auto-send a quote.
async function markAiTouched(leadId, review = {}) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      aiHandled: true,
      needsRepFollowup: review.needsRepFollowup ?? true,
      voiceExactPackageMatch: review.voiceExactPackageMatch ?? false,
      voicePriceChanged: review.voicePriceChanged ?? false,
      voiceNeedsRepReview: review.voiceNeedsRepReview ?? false,
      voiceReviewReason: review.voiceReviewReason ?? null,
      voiceAiBookingAllowed: review.voiceAiBookingAllowed ?? false,
      voiceCustomerIdentityConfirmed: review.voiceCustomerIdentityConfirmed ?? false,
    },
  });
}

// ─── GET /internal/:id/trip-brief ───────────────────────────────
// ANSWER tier, no money. What the agent may say about a trip's status.
export const getTripBrief = asyncHandler(async (req, res) => {
  const lead = await loadLead(req.params.id);
  const selection = await resolveActiveSelection(lead);

  let itinerary = null;
  if (selection) {
    const withDays = await prisma.leadPackageSelection.findUnique({
      where: { id: selection.id },
      include: { itineraryDays: { orderBy: { dayNumber: 'asc' } } },
    });
    itinerary = {
      packageName: selection.packageName,
      isManual: selection.isManual,
      nights: withDays.itineraryDays.length,
      hasBeenQuoted: Boolean(selection.currentQuoteId),
      // The quotation ID itself, not a figure — safe to expose so
      // voice-service can ask billing-service to resend the existing PDF.
      // Never used to construct a new quote, only to re-send one that exists.
      quotationId: selection.currentQuoteId || null,
    };
  }

  res.json({
    success: true,
    data: {
      statusClass: toStatusClass(lead.lifecycleStatus),
      destination: lead.destination,
      travelDate: lead.travelDate,
      endDate: lead.endDate,
      numberOfTravelers: lead.numberOfTravelers,
      itinerary,
    },
  });
});

// ─── GET /internal/:id/payment-brief ────────────────────────────
// ANSWER tier — money, gated on "already sent to this customer." Returns
// figures ONLY when a quotation already exists for the active selection
// (selection.currentQuoteId set in billing-service) — never a number that
// hasn't already reached the customer on a real document.
export const getPaymentBrief = asyncHandler(async (req, res) => {
  const lead = await loadLead(req.params.id);
  const selection = await resolveActiveSelection(lead);

  if (!selection?.currentQuoteId) {
    return res.json({ success: true, data: { hasQuote: false } });
  }

  const pricing = await prisma.leadPricing.findUnique({
    where: { leadPackageSelectionId: selection.id },
  });
  if (!pricing) {
    return res.json({ success: true, data: { hasQuote: false } });
  }

  res.json({
    success: true,
    data: {
      hasQuote: true,
      currency: pricing.currency,
      totalAmount: Number(pricing.totalAmount),
      depositAmount: Number(pricing.depositAmount),
      paidAmount: Number(pricing.paidAmount),
      balanceDue: Number(pricing.balanceDue),
    },
  });
});

// ─── POST /internal/:id/packages/attach ─────────────────────────
// PREPARE tier. Attaches a package the agent already resolved via
// package-service's public search — this endpoint never searches by name
// itself, only attaches an id voice-service already looked up.
export const attachPackageForVoice = asyncHandler(async (req, res) => {
  const lead = await loadLead(req.params.id);
  const { packageId } = req.body || {};
  if (!packageId || typeof packageId !== 'string') {
    throw new AppError('packageId is required', 400);
  }

  const result = await attachPackageToLead(lead.id, packageId, { primarySelectionId: lead.primarySelectionId });
  await markAiTouched(lead.id, {
    voiceExactPackageMatch: true,
    voicePriceChanged: false,
    voiceNeedsRepReview: false,
    voiceReviewReason: null,
    voiceAiBookingAllowed: false,
    voiceCustomerIdentityConfirmed: false,
  });

  res.status(result.alreadyAttached ? 200 : 201).json({ success: true, data: result });
});

// ─── POST /internal/:id/itinerary/adjust ────────────────────────
// PREPARE tier. Deliberately narrow — the only shapes an LLM function call
// can realistically fill in from a phone conversation: extend/trim the trip
// by whole days, and free-text overrides for hotel/destination. Anything
// more structural (reordering days, per-day activities) stays a rep task.
export const adjustItineraryForVoice = asyncHandler(async (req, res) => {
  const lead = await loadLead(req.params.id);
  const selection = await resolveActiveSelection(lead);
  if (!selection) throw new AppError('No package selection to adjust', 404);

  const { addNights, removeNights, hotelName, destination } = req.body || {};
  const addN = Number.isInteger(addNights) && addNights > 0 ? Math.min(addNights, 14) : 0;
  const removeN = Number.isInteger(removeNights) && removeNights > 0 ? removeNights : 0;
  if (!addN && !removeN && !hotelName && !destination) {
    throw new AppError('At least one of addNights, removeNights, hotelName, destination is required', 400);
  }

  // QUOTED is the one status this endpoint moves on its own — "customer
  // called back wanting changes" is exactly what REVISION exists for, and
  // the transition is unconditional (no gatekeeper) in this direction. Every
  // other blocked status (APPROVED and later, or CLOSED_LOST/CANCELLED)
  // means the lead is already past the point a voice call should touch it.
  if (lead.lifecycleStatus === 'QUOTED') {
    try {
      validateTransition({ currentStatus: 'QUOTED', nextStatus: 'REVISION' });
    } catch (err) {
      if (err instanceof StateMachineError) throw new AppError(err.message, 409);
      throw err;
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        lifecycleStatus: 'REVISION',
        statusHistory: {
          create: [{ status: 'REVISION', actor: 'SYSTEM', changedById: null, notes: 'Caller requested changes on a voice call' }],
        },
      },
    });
  } else if (EDIT_BLOCKED_STATUSES.includes(lead.lifecycleStatus)) {
    throw new AppError(BLOCKED_MESSAGE, 409);
  }

  const withDays = await prisma.leadPackageSelection.findUnique({
    where: { id: selection.id },
    include: { itineraryDays: { orderBy: { dayNumber: 'asc' } } },
  });
  let days = serializeLeadDays(withDays);

  // Snapshot what a rep will need to see as "before". applyLeadSelectionItinerary
  // below deletes and recreates every day, so nothing else preserves the prior
  // state — without this the old itinerary is simply gone and there is nothing
  // to compare an AI edit against.
  const before = {
    nights: days.length,
    hotel: days[0]?.accommodation?.name ?? null,
    destination: selection.destinationOverride ?? lead.destination ?? null,
  };

  if (destination !== undefined) {
    await prisma.leadPackageSelection.update({
      where: { id: selection.id },
      data: { destinationOverride: String(destination).slice(0, 255) },
    });
  }

  if (hotelName) {
    const name = String(hotelName).slice(0, 255);
    days = days.map((d) => ({ ...d, accommodation: { ...(d.accommodation || {}), name } }));
  }

  if (removeN) {
    days = days.slice(0, Math.max(0, days.length - removeN));
  }
  if (addN) {
    const template = days[days.length - 1] || {
      title: null, description: null, breakfastCount: 0, lunchCount: 0, dinnerCount: 0,
      mealPriceOverride: null, accommodation: {}, flights: [], places: [], activities: [], transports: [],
    };
    for (let i = 0; i < addN; i += 1) {
      days.push({ ...template, dayNumber: days.length + 1, title: null, description: null });
    }
  }
  // Renumber — add/remove above can leave gaps or duplicates.
  days = days.map((d, i) => ({ ...d, dayNumber: i + 1 }));

  const result = await applyLeadSelectionItinerary({
    leadId: lead.id,
    selectionId: selection.id,
    days,
    actor: 'SYSTEM',
  });

  // Everything past this point is bookkeeping on an edit that has ALREADY
  // been committed by applyLeadSelectionItinerary above. Failing the request
  // here would tell the agent the change did not happen when it did — the
  // caller would then be told something false, and a retry would apply the
  // edit twice. So these are best-effort and logged, never fatal.
  const after = {
    nights: days.length,
    hotel: days[0]?.accommodation?.name ?? null,
    destination: destination !== undefined ? String(destination).slice(0, 255) : before.destination,
  };
  let reviewCardSaved = true;
  try {
    await prisma.leadPackageSelection.update({
      where: { id: selection.id },
      data: { pendingAiChange: { before, after, summary: summarizeChange(before, after), changedAt: new Date().toISOString() } },
    });
  } catch (err) {
    reviewCardSaved = false;
    req.log.error({ err, leadId: lead.id, selectionId: selection.id }, 'Itinerary edit applied but the rep review card could not be saved');
  }
  try {
    await markAiTouched(lead.id, {
      voiceExactPackageMatch: false,
      voicePriceChanged: true,
      voiceNeedsRepReview: true,
      voiceReviewReason: 'package_changed_requires_repricing',
      voiceAiBookingAllowed: false,
      voiceCustomerIdentityConfirmed: false,
    });
  } catch (err) {
    req.log.error({ err, leadId: lead.id }, 'Itinerary edit applied but the lead could not be flagged for a rep');
  }

  res.json({ success: true, data: { ...result, nights: days.length, reviewCardSaved } });
});

// ─── POST /:id/packages/:selectionId/approve-ai-change ──────────
// Rep-facing (JWT, not internal-token — see lead.routes.js). Marks the voice
// agent's pending itinerary edit as reviewed and accepted, which only clears
// the review flag.
//
// It deliberately does NOT send an updated quotation: quoting is its own
// existing rep action with its own pricing review, and fusing the two would
// let one click push a new figure to a customer without the rep having seen
// the pricing screen. "Discard" is the existing refresh-from-package action,
// which clears this same flag (see refreshSelection).
export const approveAiChange = asyncHandler(async (req, res) => {
  const selection = await prisma.leadPackageSelection.findUnique({ where: { id: req.params.selectionId } });
  if (!selection || selection.leadId !== req.params.id) throw new AppError('Package selection not found', 404);
  if (!selection.pendingAiChange) throw new AppError('This selection has no pending voice-agent change', 409);

  const updated = await prisma.leadPackageSelection.update({
    where: { id: selection.id },
    data: { pendingAiChange: null },
    select: { id: true, pendingAiChange: true },
  });

  // Reviewing the change is also the rep confirming they have seen what the
  // agent did, so the lead-level "needs a rep" flag clears with it.
  await prisma.lead.update({
    where: { id: req.params.id },
    data: { needsRepFollowup: false, aiVerifiedAt: new Date(), aiVerifiedById: req.user?.id ?? null },
  });

  res.json({ success: true, data: updated });
});

/** Plain-language description of what the agent changed, for the rep's review card. */
function summarizeChange(before, after) {
  const parts = [];
  if (after.nights !== before.nights) {
    const delta = after.nights - before.nights;
    parts.push(delta > 0 ? `Added ${delta} night${delta === 1 ? '' : 's'}` : `Removed ${-delta} night${delta === -1 ? '' : 's'}`);
  }
  if (after.hotel !== before.hotel && after.hotel) parts.push(`Changed hotel to ${after.hotel}`);
  if (after.destination !== before.destination && after.destination) parts.push(`Changed destination to ${after.destination}`);
  return parts.length ? parts.join('; ') : 'Itinerary edited';
}

// ─── POST /internal/:id/pricing/preview ─────────────────────────
// PREPARE tier — computes from the CURRENTLY PERSISTED cost lines and
// persists nothing. This exists so a rep opening the lead sees fresh totals
// ready to review; the agent must never speak the result (enforced in the
// prompt and in the ElevenLabs tool's own description, not here — this endpoint
// only guarantees the number is never saved).
export const previewPricingForVoice = asyncHandler(async (req, res) => {
  const lead = await loadLead(req.params.id);
  const selection = await resolveActiveSelection(lead);
  if (!selection) throw new AppError('No package selection to price', 404);

  const costLines = await prisma.leadCostLine.findMany({
    where: { leadPackageSelectionId: selection.id },
    orderBy: { orderIndex: 'asc' },
  });

  let lines = costLines.map(toLineDescriptor);
  if (!lines.length && selection.packageId) {
    try {
      const pkg = await fetchPackage(selection.packageId);
      if (Number(pkg?.basePrice) > 0) {
        lines = [toLineDescriptor({
          category: 'package', description: pkg.title || 'Package price', basis: 'FIXED',
          quantity: 1, estimatedUnitPrice: Number(pkg.basePrice), actualUnitPrice: null,
          marginType: null, marginValue: null, source: 'AUTO', orderIndex: 0,
        })];
      }
    } catch {
      // package-service unreachable — preview with whatever exists (possibly empty).
    }
  }

  const pricing = await prisma.leadPricing.findUnique({ where: { leadPackageSelectionId: selection.id } });
  const computed = computePricing({
    lines,
    travelers: lead.numberOfTravelers || 1,
    currency: pricing?.currency || 'USD',
    marginType: pricing?.marginType || null,
    marginValue: Number(pricing?.marginValue) || 0,
    depositType: pricing?.depositType || null,
    depositValue: Number(pricing?.depositValue) || 0,
    discountType: pricing?.discountType || 'none',
    discountValue: Number(pricing?.discountValue) || 0,
    serviceChargeRate: Number(pricing?.serviceChargeRate) || 0,
  });

  res.json({ success: true, data: { financials: computed, persisted: false } });
});

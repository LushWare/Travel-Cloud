import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import { searchPackages, PACKAGE_PRICE_SNAPSHOT } from '../services/package.client.js';
import {
  getTripBrief, getPaymentBrief, attachPackage, adjustItinerary, previewPricing,
} from '../services/lead.client.js';
import { getLatestSentDocument, resendDocument } from '../services/billing.client.js';
import { requestVoiceBooking } from '../services/booking.client.js';

function extractToolContext(body, req) {
  const callId = req.get?.('x-elevenlabs-conversation-id') ?? null;
  const args = body?.args && typeof body.args === 'object' ? body.args : (body || {});
  return { callId, args };
}

const AUDIT_RESULT = Symbol('auditResult');

async function resolveLeadId(callId) {
  if (!callId) return null;
  const call = await prisma.voiceCall.findUnique({ where: { conversationId: callId } });
  if (!call || call.disposition !== 'IN_PROGRESS') return null;
  return call.leadId ?? null;
}

async function resolveActiveCall(callId) {
  if (!callId) return null;
  const call = await prisma.voiceCall.findUnique({ where: { conversationId: callId } });
  return call?.disposition === 'IN_PROGRESS' ? call : null;
}

async function insertEvent(voiceCallId, functionName, args, result, succeeded, startedAt) {
  const count = await prisma.voiceCallEvent.count({ where: { voiceCallId } });
  await prisma.voiceCallEvent.create({
    data: {
      voiceCallId,
      sequence: count,
      functionName,
      args,
      result,
      succeeded,
      latencyMs: Date.now() - startedAt,
    },
  });
}

const EVENT_WRITE_ATTEMPTS = 2;

async function logEvent(callId, functionName, args, result, succeeded, startedAt, log) {
  if (!callId) return;
  try {
    const call = await prisma.voiceCall.findUnique({ where: { conversationId: callId } });
    if (!call) return;
    for (let attempt = 1; attempt <= EVENT_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await insertEvent(call.id, functionName, args, result, succeeded, startedAt);
        return;
      } catch (err) {
        if (err?.code === 'P2002' && attempt < EVENT_WRITE_ATTEMPTS) continue;
        log?.error({ err, callId, functionName }, 'Failed to log VoiceCallEvent');
        return;
      }
    }
  } catch (err) {
    // The call lookup itself failed (database hiccup) — same rule: loud in the
    // logs, never fatal to the tool call it describes.
    log?.error({ err, callId, functionName }, 'Failed to log VoiceCallEvent');
  }
}

function wrap(functionName, handler) {
  return asyncHandler(async (req, res) => {
    const startedAt = Date.now();
    const { callId, args } = extractToolContext(req.body, req);
    let result;
    let auditResult;
    let succeeded = true;
    try {
      result = await handler({ callId, args, requestId: req.requestId, log: req.log });
      auditResult = result;
      if (result && typeof result === 'object' && AUDIT_RESULT in result) {
        auditResult = result[AUDIT_RESULT];
        result = result.response;
      }
    } catch (err) {
      succeeded = false;
      req.log.error({ err, functionName, callId }, 'Voice tool call failed');
      result = { error: true, message: 'Could not complete that right now.' };
    }
    try {
      await logEvent(callId, functionName, args, auditResult ?? result, succeeded, startedAt, req.log);
    } catch (err) {
      req.log.error({ err, functionName, callId }, 'Failed to log VoiceCallEvent');
    }
    res.json(result);
  });
}

// ─── ANSWER tier ─────────────────────────────────────────────────

export const searchPackagesTool = wrap('search_packages', async ({ args, requestId }) => {
  const results = await searchPackages(args?.query, requestId);
  const response = { count: results.length, packages: results };
  const auditResult = {
    count: results.length,
    packages: results.map((item) => ({
      packageId: item.packageId,
      priceSnapshot: item[PACKAGE_PRICE_SNAPSHOT],
    })),
  };
  return { response, [AUDIT_RESULT]: auditResult };
});

export const getTripStatusTool = wrap('get_trip_status', async ({ callId, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { available: false };
  const brief = await getTripBrief(leadId, requestId);
  return { available: true, ...brief };
});

export const getPaymentStatusTool = wrap('get_payment_status', async ({ callId, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { available: false };
  const brief = await getPaymentBrief(leadId, requestId);
  return { available: true, ...brief };
});

// ─── PREPARE tier ────────────────────────────────────────────────

function requireTripConfirmed(args) {
  return args?.trip_confirmed === true;
}

export const attachPackageTool = wrap('attach_package', async ({ callId, args, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { attached: false, reason: 'no_active_lead' };
  if (!requireTripConfirmed(args)) return { attached: false, reason: 'trip_not_confirmed' };
  const packageId = typeof args?.package_id === 'string' ? args.package_id : null;
  if (!packageId) return { attached: false, reason: 'missing_package_id' };
  const result = await attachPackage(leadId, packageId, requestId);
  return { attached: true, ...result };
});

export const requestBookingTool = wrap('request_booking', async ({ callId, args, requestId }) => {
  const call = await resolveActiveCall(callId);
  if (!call) return { created: false, reason: 'no_active_call' };
  if (args?.booking_confirmed !== true) return { created: false, reason: 'booking_not_confirmed' };

  const packageId = typeof args?.package_id === 'string' ? args.package_id : null;
  if (!packageId) return { created: false, reason: 'missing_package_id' };
  const searches = await prisma.voiceCallEvent.findMany({
    where: { voiceCallId: call.id, functionName: 'search_packages', succeeded: true },
    orderBy: { sequence: 'desc' },
    take: 20,
    select: { result: true },
  });
  const searchedPackage = searches
    .flatMap((event) => event.result?.packages || [])
    .find((item) => item.packageId === packageId);
  if (!searchedPackage) return { created: false, reason: 'package_not_presented_by_search' };
  if (!Number.isFinite(Number(searchedPackage.priceSnapshot))) {
    return { created: false, requiresRepReview: true, reason: 'package_price_unavailable_at_search' };
  }

  const travelers = typeof args?.travelers === 'number' ? args.travelers
    : (typeof args?.travelers === 'string' && args.travelers.trim() ? Number(args.travelers) : NaN);
  const name = typeof args?.full_name === 'string' ? args.full_name.trim() : '';
  const email = typeof args?.email === 'string' ? args.email.trim() : '';
  const travelDate = typeof args?.travel_date === 'string' ? args.travel_date.trim() : '';
  const endDate = typeof args?.end_date === 'string' ? args.end_date.trim() : '';
  if (name.length < 2 || !email || !travelDate || !Number.isInteger(travelers)) {
    return { created: false, reason: 'booking_details_incomplete' };
  }

  const result = await requestVoiceBooking({
    conversationId: callId,
    packageId,
    searchPriceSnapshot: Number(searchedPackage.priceSnapshot),
    bookingConfirmed: true,
    name,
    email,
    travelDate,
    ...(endDate ? { endDate } : {}),
    travelers,
  }, requestId);
  if (result?.reviewRequired) {
    return { created: false, requiresRepReview: true, reason: result.reason };
  }
  const response = { created: true, bookingStatus: 'pending', ...result };
  return {
    response,
    [AUDIT_RESULT]: {
      ...response,
      packageId,
      searchPriceSnapshot: Number(searchedPackage.priceSnapshot),
    },
  };
});

function toNightCount(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

export const adjustItineraryTool = wrap('adjust_itinerary', async ({ callId, args, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { adjusted: false, reason: 'no_active_lead' };
  if (!requireTripConfirmed(args)) return { adjusted: false, reason: 'trip_not_confirmed' };
  const addNights = toNightCount(args?.add_nights);
  const removeNights = toNightCount(args?.remove_nights);
  const changes = {
    ...(Number.isFinite(addNights) ? { addNights } : {}),
    ...(Number.isFinite(removeNights) ? { removeNights } : {}),
    ...(typeof args?.hotel_name === 'string' && args.hotel_name.trim() ? { hotelName: args.hotel_name.trim() } : {}),
    ...(typeof args?.destination === 'string' && args.destination.trim() ? { destination: args.destination.trim() } : {}),
  };
  if (!Object.keys(changes).length) return { adjusted: false, reason: 'no_changes_given' };
  const result = await adjustItinerary(leadId, changes, requestId);
  return { adjusted: true, ...result };
});

// The result is never spoken by design (see docs/voice-agent-prompt.md and
// the design doc's money rule) — this tool exists only so a rep opens the
// lead with fresh numbers already computed, never to answer a caller's
// question directly.
export const previewPriceTool = wrap('preview_price', async ({ callId, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { available: false };
  await previewPricing(leadId, requestId);
  return { available: true, computed: true, note: 'internal use only — never speak this figure' };
});


export const resendDocumentTool = wrap('resend_document', async ({ callId, requestId }) => {
  const leadId = await resolveLeadId(callId);
  if (!leadId) return { sent: false, reason: 'no_active_lead' };

  const { latest } = await getLatestSentDocument(leadId, requestId);
  if (!latest) return { sent: false, reason: 'nothing_sent_yet' };

  const result = await resendDocument(latest.type, latest.id, requestId);
  const sent = result?.email === 'sent' || result?.whatsapp === 'sent';
  return { sent, documentType: latest.type, email: result?.email ?? null, whatsapp: result?.whatsapp ?? null };
});

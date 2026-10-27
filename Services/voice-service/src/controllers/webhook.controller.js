import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { initiationSchema, postCallSchema } from '../validators/elevenLabs.schema.js';
import { resolveCallerIdentity, buildDynamicVariables } from '../services/callerIdentity.service.js';
import { toStoredTranscript, toIntakeTranscript } from '../services/transcript.service.js';
import { lookupLeadsByPhone, submitIntake, issueVoiceQuotation } from '../services/lead.client.js';
import { notifyRepsOfCallback } from '../services/notify.service.js';
import { isOverDailyCap } from '../services/callVolume.service.js';
import { normalizePhone, maskPhone } from '../utils/phone.js';

export const handleInboundCall = asyncHandler(async (req, res) => {
  const parsed = initiationSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid conversation initiation payload', 400);

  const { caller_id: callerId, called_number: calledNumber, conversation_id: conversationId } = parsed.data;
  const voiceNumber = await prisma.voiceNumber.findFirst({
    where: { e164: normalizePhone(calledNumber), isActive: true },
  });
  if (!voiceNumber) {
    req.log.warn({ calledNumber: maskPhone(calledNumber) }, 'Call to an unmapped or inactive number');
    throw new AppError('Number not configured', 404);
  }
  if (voiceNumber.agentId !== parsed.data.agent_id) {
    req.log.error({ numberId: voiceNumber.id }, 'ElevenLabs agent does not match the local phone-number mapping');
    throw new AppError('Agent configuration mismatch', 409);
  }

  const normalizedFrom = normalizePhone(callerId);
  const volume = await isOverDailyCap(normalizedFrom);
  let lookup = { matches: [], samePerson: true };
  if (!volume.overCap) {
    try {
      lookup = (await lookupLeadsByPhone(normalizedFrom, req.requestId)) ?? lookup;
    } catch (err) {
      req.log.error({ err, fromNumber: maskPhone(callerId) }, 'Caller lookup failed; treating caller as unknown');
    }
  } else {
    req.log.warn(
      { fromNumber: maskPhone(callerId), count: volume.count, cap: volume.cap },
      'Caller over the daily call cap — skipping identity lookup'
    );
  }

  const identity = resolveCallerIdentity(lookup);
  await prisma.voiceCall.upsert({
    where: { conversationId },
    create: {
      conversationId,
      numberId: voiceNumber.id,
      direction: 'INBOUND',
      fromNumber: normalizedFrom,
      toNumber: normalizePhone(calledNumber),
      matchOutcome: identity.outcome,
      leadId: identity.leadId,
    },
    update: {},
  });

  req.log.info(
    { fromNumber: maskPhone(callerId), outcome: identity.outcome, matches: lookup.matches?.length ?? 0 },
    'Inbound conversation initialized'
  );

  res.json({
    type: 'conversation_initiation_client_data',
    dynamic_variables: buildDynamicVariables({ identity, voiceNumber }),
  });
});

export const handlePostCall = asyncHandler(async (req, res) => {
  const parsed = postCallSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('Invalid post-call payload', 400);
  if (parsed.data.type !== 'post_call_transcription') return res.json({ received: true });

  const { data } = parsed.data;
  const { metadata = {}, analysis = {} } = data;
  const phoneCall = metadata.phone_call ?? {};
  const conversationId = data.conversation_id;
  const fromNumber = normalizePhone(phoneCall.external_number);
  const toNumber = normalizePhone(phoneCall.agent_number);
  const startedAt = metadata.start_time_unix_secs
    ? new Date(metadata.start_time_unix_secs * 1000)
    : new Date();
  const stored = toStoredTranscript((data.transcript ?? []).map((turn) => ({
    role: turn.role,
    content: turn.message ?? '',
  })));
  const custom = Object.fromEntries(
    Object.entries(analysis.data_collection_results ?? {}).map(([key, result]) => [key, result?.value])
  );
  const existing = await prisma.voiceCall.findUnique({ where: { conversationId } });
  const voiceCall = existing ?? await prisma.voiceCall.create({
    data: { conversationId, fromNumber, toNumber, direction: phoneCall.direction === 'outbound' ? 'OUTBOUND' : 'INBOUND' },
  });
  const dataToSave = {
    fromNumber,
    toNumber,
    direction: phoneCall.direction === 'outbound' ? 'OUTBOUND' : 'INBOUND',
    startedAt,
    endedAt: new Date(startedAt.getTime() + (metadata.call_duration_secs ?? 0) * 1000),
    durationSec: Number.isInteger(metadata.call_duration_secs) ? metadata.call_duration_secs : null,
    disposition: stored.length ? 'COMPLETED' : (data.status === 'failed' ? 'FAILED' : 'ABANDONED'),
    transcript: stored,
    summary: analysis.transcript_summary ?? null,
    sentiment: typeof custom.user_sentiment === 'string' ? custom.user_sentiment : null,
    costCents: typeof metadata.cost_fiat === 'number' ? Math.round(metadata.cost_fiat * 100) : null,
    recordingUrl: data.has_audio ? 'elevenlabs' : null,
  };
  const saved = await prisma.voiceCall.update({ where: { id: voiceCall.id }, data: dataToSave });

  if (fromNumber && stored.length) {
    const slots = extractSlots(custom);
    const email = extractEmail(custom);
    const name = extractFullName(custom);
    const selectedPackageId = extractSelectedPackageId(custom);
    let bookingCreated = false;
    let voiceReviewReason = null;
    let bookingAudit = null;
    try {
      bookingAudit = await prisma.voiceCallEvent.findFirst({
        where: { voiceCallId: saved.id, functionName: 'request_booking', succeeded: true },
        orderBy: { sequence: 'desc' },
        select: { result: true },
      });
      bookingCreated = bookingAudit?.result?.created === true && bookingAudit?.result?.bookingStatus === 'pending';
      if (bookingAudit?.result?.requiresRepReview === true) {
        voiceReviewReason = bookingAudit.result.reason || 'package_changed_requires_repricing';
      }
    } catch (err) {
      req.log.error({ err, conversationId }, 'Could not verify the voice booking result');
    }
    let leadId = saved.leadId;
    let followup = bookingCreated ? false : (voiceReviewReason ? true : needsFollowup(custom));

    const volume = await isOverDailyCap(fromNumber);
    if (volume.overCap) {
      req.log.warn(
        { fromNumber: maskPhone(fromNumber), count: volume.count, cap: volume.cap, conversationId },
        'Caller over the daily call cap — skipping lead intake and rep notification'
      );
      return res.json({ received: true });
    }

    if (!bookingCreated || !leadId) {
      try {
        const result = await submitIntake({
          channel: 'voice',
          sessionId: conversationId,
          contact: { phone: fromNumber, ...(name ? { name } : {}), ...(email ? { email } : {}) },
          slots,
          ...(selectedPackageId ? { selectedPackageId } : {}),
          ...(voiceReviewReason ? { voiceReviewReason } : {}),
          transcript: toIntakeTranscript(stored, { callId: conversationId, startedAt }),
        }, req.requestId);
        if (result?.leadId) leadId = result.leadId;
      } catch (err) {
        req.log.error({ err, conversationId }, 'Lead intake failed for completed call');
      }
    }

    if (bookingCreated) {
      const booking = bookingAudit?.result;
      if (booking?.leadId && booking?.bookingId && booking?.packageId
        && Number.isFinite(Number(booking.searchPriceSnapshot))) {
        leadId = booking.leadId;
        try {
          const quote = await issueVoiceQuotation({
            leadId,
            bookingId: booking.bookingId,
            packageId: booking.packageId,
            searchPriceSnapshot: Number(booking.searchPriceSnapshot),
          }, req.requestId);
          if (quote?.issued !== true || quote?.delivery?.allSent !== true) {
            followup = true;
            req.log.warn({ conversationId, leadId, reason: quote?.reason }, 'Automatic voice quotation needs rep follow-up');
          }
        } catch (err) {
          followup = true;
          req.log.error({ err, conversationId, leadId }, 'Automatic voice quotation failed');
        }
      } else {
        followup = true;
        req.log.error({ conversationId, leadId }, 'Successful voice booking is missing verified quote details');
      }
    }

    await prisma.voiceCall.update({
      where: { id: saved.id },
      data: { leadId, needsRepFollowup: followup },
    });

    if (followup && !saved.needsRepFollowup) {
      try {
        await notifyRepsOfCallback({ call: { ...saved, ...dataToSave }, slots, leadId }, req.log, req.requestId);
      } catch (err) {
        req.log.error({ err, conversationId, leadId }, 'Could not notify the team of a promised callback');
      }
    }
  }

  res.json({ received: true });
});

function needsFollowup(custom) {
  const raw = custom?.needs_rep_followup ?? custom?.needsRepFollowup;
  return raw !== false && raw !== 'false';
}

function extractSlots(custom = {}) {
  const slots = {};
  if (custom.destination) slots.destination = String(custom.destination).slice(0, 255);
  const travelDate = parseDate(custom.travel_date ?? custom.travelDate);
  const endDate = parseDate(custom.end_date ?? custom.endDate);
  if (travelDate) slots.travelDate = travelDate;
  if (endDate) slots.endDate = endDate;
  if (custom.budget) slots.budget = String(custom.budget).slice(0, 255);
  if (custom.preferences) slots.preferences = String(custom.preferences).slice(0, 1000);
  const travelers = Number(custom.travelers);
  if (Number.isInteger(travelers) && travelers >= 1 && travelers <= 50) slots.travelers = travelers;
  const duration = Number(custom.duration);
  if (Number.isInteger(duration) && duration >= 1 && duration <= 30) slots.duration = duration;
  return slots;
}

function extractEmail(custom = {}) {
  if (!custom.email) return undefined;
  return String(custom.email).trim().slice(0, 255) || undefined;
}

const PACKAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function extractSelectedPackageId(custom = {}) {
  const id = custom.selected_package_id ?? custom.selectedPackageId;
  return typeof id === 'string' && PACKAGE_ID_RE.test(id) ? id : undefined;
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function extractFullName(custom = {}) {
  if (typeof custom.full_name !== 'string') return undefined;
  return custom.full_name.trim().slice(0, 255) || undefined;
}
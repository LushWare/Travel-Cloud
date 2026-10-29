import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { LeadIntakeRequest } from '@travel-crm/contracts';
import { validateTransition } from '../services/state-machine.service.js';
import { attachPackageToLead } from '../services/lead-selection.service.js';
import { normalizePhone } from '../utils/phone.js';
import { toStatusClass } from '../constants/voice-status-class.js';
import { classifyTripRecency, isSamePerson } from '../utils/trip-recency.js';

// ─── Slot / contact mapping helpers ─────────────────────────────
// `Lead.run` maps wizard slots onto Lead columns. `duration` has no Lead
// column, so when a travelDate is already known it is folded into endDate;
// otherwise the duration (and `preferences`, which also has no column) is
// folded into the free-text `message` field so they are never silently dropped.
// The intake channel/session id is the idempotency key.
//
// SECURITY: no contact-based cross-session lookup exists here on purpose. An
// earlier revision matched ANY existing Lead by email/phone/whatsapp — but
// `contact` is fully attacker-controlled from the PUBLIC, unauthenticated
// wizard-turn endpoint, making that an IDOR: an anonymous caller could type a
// stranger's email into a fresh wizard session and merge into (and overwrite)
// or append into that stranger's Lead. Dedupe is scoped to the caller's own
// (channel, sessionId) key only, which is safe because sessionId is a
// non-guessable client-generated UUID the caller already owns. Real
// cross-session merge-by-contact requires a verified-ownership mechanism
// (e.g. an email confirmation link) and is intentionally deferred, not
// silently dropped — see TODOS.md and docs/designs/chatbot-inbound-lead-intake.md.

function normalizeContact(contact) {
  return {
    name: contact.name || null,
    email: contact.email?.trim().toLowerCase() || null,
    phone: normalizePhone(contact.phone),
    whatsapp: normalizePhone(contact.whatsapp),
  };
}

function slotExtras({ slots, existingTravelDate }) {
  const parts = [];
  if (slots.duration != null && !existingTravelDate) parts.push(`Trip duration: ${slots.duration} days`);
  if (slots.preferences) parts.push(`Preferences: ${slots.preferences}`);
  return parts;
}

const SOURCE_BY_CHANNEL = { chatbot: 'chatbot', voice: 'voice_agent' };
const PLATFORM_BY_CHANNEL = { chatbot: 'Chatbot_Wizard', voice: 'Voice_Agent' };
const INTAKE_NOTE_BY_CHANNEL = {
  chatbot: 'Created by chatbot lead intake',
  voice: 'Created by voice agent lead intake',
};

function buildCreateData({ channel, sessionId, contact, slots, voiceReviewReason }) {
  const clean = normalizeContact(contact);
  const extras = slotExtras({ slots, existingTravelDate: null });
  return {
    name: clean.name || null,
    email: clean.email,
    phone: clean.phone,
    whatsapp: clean.whatsapp,
    phoneNormalized: clean.phone,
    whatsappNormalized: clean.whatsapp,
    source: SOURCE_BY_CHANNEL[channel] ?? 'chatbot',
    platform: PLATFORM_BY_CHANNEL[channel] ?? 'Chatbot_Wizard',
    intakeChannel: channel,
    intakeSessionId: sessionId,
    destination: slots.destination || null,
    travelDate: slots.travelDate || null,
    endDate: slots.endDate || (slots.travelDate && slots.duration
      ? new Date(slots.travelDate.getTime() + slots.duration * 86400000)
      : null),
    numberOfTravelers: slots.travelers ?? null,
    budget: slots.budget || null,
    message: extras.length ? extras.join('; ') : null,
    lifecycleStatus: 'PENDING_VERIFICATION',
    aiHandled: channel === 'voice',
    // A voice call always ends with the agent promising a human callback, so
    // the lead arrives already flagged for a rep rather than waiting to be
    // noticed in a filter.
    needsRepFollowup: channel === 'voice',
    voiceExactPackageMatch: false,
    voicePriceChanged: Boolean(voiceReviewReason),
    voiceNeedsRepReview: Boolean(voiceReviewReason),
    voiceReviewReason: voiceReviewReason || null,
    voiceAiBookingAllowed: false,
    voiceCustomerIdentityConfirmed: false,
    // Machine-created lead, never auto-assigned — an agent must claim it.
    statusHistory: {
      create: [{
        status: 'PENDING_VERIFICATION',
        actor: 'SYSTEM',
        changedById: null,
        notes: INTAKE_NOTE_BY_CHANNEL[channel] ?? 'Created by chatbot lead intake',
      }],
    },
  };
}

// Merges only the slots actually present in this turn, leaving the rest of an
// existing lead untouched. Never resets lifecycleStatus.
function mergeSlotData({ slots, existing, contact, voiceReviewReason }) {
  const data = {};
  if (contact.name && !existing?.name) data.name = contact.name;
  if (contact.email && !existing?.email) data.email = contact.email;
  if (slots.destination != null && slots.destination !== '') data.destination = slots.destination;
  if (slots.travelDate) data.travelDate = slots.travelDate;
  if (slots.endDate) data.endDate = slots.endDate;
  if (slots.travelers != null) data.numberOfTravelers = slots.travelers;
  if (slots.budget != null && slots.budget !== '') data.budget = slots.budget;
  if (voiceReviewReason) {
    data.aiHandled = true;
    data.needsRepFollowup = true;
    data.voiceExactPackageMatch = false;
    data.voicePriceChanged = true;
    data.voiceNeedsRepReview = true;
    data.voiceReviewReason = voiceReviewReason;
    data.voiceAiBookingAllowed = false;
    data.voiceCustomerIdentityConfirmed = false;
  }

  // Only fold in extras not already present verbatim — the durable-signal
  // check fires on EVERY turn while it holds, so without this a still-PENDING
  // lead's message would accumulate "Trip duration: 7 days" once per turn.
  const extras = slotExtras({ slots, existingTravelDate: existing?.travelDate });
  const base = (existing?.message || '').trim();
  const newExtras = extras.filter((extra) => !base.includes(extra));
  if (newExtras.length) {
    data.message = [base, newExtras.join('; ')].filter(Boolean).join(' | ') || null;
  } else if (base) {
    data.message = base;
  }

  if (slots.duration != null && existing?.travelDate) {
    const end = new Date(existing.travelDate);
    end.setUTCDate(end.getUTCDate() + slots.duration);
    data.endDate = end;
  }
  return data;
}

// Transcript messages are deduped by (leadId, externalMessageId) so a resent
// sliding window is a safe no-op against the unique constraint. We pre-filter
// against already-stored ids and pass skipDuplicates as a belt-and-suspenders
// guard for a concurrent duplicate.
async function appendTranscriptMessages(tx, leadId, transcript) {
  if (!transcript?.length) return [];
  const existing = await tx.leadCommunicationLog.findMany({
    where: { leadId, externalMessageId: { in: transcript.map((m) => m.id) } },
    select: { externalMessageId: true },
  });
  const existingIds = new Set(existing.map((e) => e.externalMessageId));
  const newMessages = transcript.filter((m) => !existingIds.has(m.id));
  if (!newMessages.length) return [];
  await tx.leadCommunicationLog.createMany({
    data: newMessages.map((m) => ({
      leadId,
      type: 'message',
      notes: m.content,
      externalMessageId: m.id,
      date: m.at ? new Date(m.at) : new Date(),
      byId: null,
    })),
    skipDuplicates: true,
  });
  return newMessages;
}

// ─── POST /api/v1/leads/internal/intake ────────────────────────
// Channel-agnostic service-to-service lead intake. Body = LeadIntakeRequest.
// Response envelope matches every other lead-service endpoint: { success, data }.
export const intakeLead = asyncHandler(async (req, res) => {
  const parsed = LeadIntakeRequest.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const { channel, sessionId, contact, slots = {}, transcript, selectedPackageId, voiceReviewReason } = parsed.data;
  const cleanContact = normalizeContact(contact);
  const sessionKey = {
    intakeChannel_intakeSessionId: { intakeChannel: channel, intakeSessionId: sessionId },
  };

  const result = await prisma.$transaction(async (tx) => {
    const sessionLead = await tx.lead.findUnique({ where: sessionKey });

    if (sessionLead && sessionLead.lifecycleStatus !== 'PENDING_VERIFICATION') {
      // Already left PENDING_VERIFICATION (claimed/worked) — append transcript
      // only; never touch scalar fields (destination/dates/travelers) so a live
      // conversation can't bypass the quote/date/traveler gatekeepers. A
      // package mentioned this late is a change to an already-claimed lead,
      // not a fresh selection, so it's deliberately not auto-attached either.
      await appendTranscriptMessages(tx, sessionLead.id, transcript);
      return { leadId: sessionLead.id, lifecycleStatus: sessionLead.lifecycleStatus, created: false, locked: true };
    }

    // Brand-new session (or a still-PENDING repeat) — upsert so two
    // near-simultaneous first calls for the same session converge onto one row
    // instead of one throwing a P2002 unique-violation. The update branch never
    // resets lifecycleStatus; it only merges the slots of the still-PENDING row.
    const upserted = await tx.lead.upsert({
      where: sessionKey,
      create: buildCreateData({ channel, sessionId, contact: cleanContact, slots, voiceReviewReason }),
      update: mergeSlotData({ slots, existing: sessionLead, contact: cleanContact, voiceReviewReason }),
    });
    const created = !sessionLead;
    await appendTranscriptMessages(tx, upserted.id, transcript);
    return {
      leadId: upserted.id,
      lifecycleStatus: upserted.lifecycleStatus,
      primarySelectionId: upserted.primarySelectionId,
      created,
      locked: false,
    };
  });

  // Package attach is a live HTTP call to package-service (best-effort name
  // lookup) — kept outside the transaction above so it never holds a DB
  // transaction open across the network. Only attempted for a lead still in
  // PENDING_VERIFICATION (the `locked` branch above already opted out).
  let packageSelection = null;
  if (selectedPackageId && !result.locked) {
    try {
      packageSelection = await attachPackageToLead(result.leadId, selectedPackageId, {
        primarySelectionId: result.primarySelectionId,
      });
    } catch (err) {
      // Never fail intake over a package attach — the lead itself is already
      // committed above, and a rep can attach the package manually if this
      // best-effort step drops it.
      req.log?.error({ err, leadId: result.leadId, selectedPackageId }, 'Could not auto-attach package during intake');
    }
  }

  res.json({
    success: true,
    data: { leadId: result.leadId, lifecycleStatus: result.lifecycleStatus, created: result.created, packageSelection },
  });
});

// ─── GET /api/v1/leads/internal/by-phone ───────────────────────
// Caller identification for voice-service. Matches ONLY on the digits-only
// mirrors of a carrier-supplied number — there is deliberately no lookup by
// name, email or id, because the caller's speech is attacker-controlled and
// dialling is free and anonymous (see the IDOR note at the top of this file).
//
// Returns a bounded projection, never whole leads: the caller's own first
// name, a coarse status bucket, the destination they already told us, and
// whether that trip is still running. No id, no figures, no raw dates, no
// email — voice-service must not be able to leak a field the agent could
// speak aloud. `recency` is the classification, never the dates behind it.
//
// A repeat customer legitimately accumulates several leads on one number, so
// matching more than one row is not by itself suspicious — `samePerson` is
// what separates a loyal customer from a genuinely shared handset.
export const lookupLeadsByPhone = asyncHandler(async (req, res) => {
  const digits = normalizePhone(req.query.phone);
  if (!digits) throw new AppError('phone is required', 400);

  const leads = await prisma.lead.findMany({
    where: {
      OR: [{ phoneNormalized: digits }, { whatsappNormalized: digits }],
      lifecycleStatus: { notIn: ['CLOSED_LOST', 'CANCELLED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true, name: true, lifecycleStatus: true, destination: true, assignedToId: true,
      travelDate: true, endDate: true, updatedAt: true,
    },
  });

  const now = new Date();

  res.json({
    success: true,
    data: {
      count: leads.length,
      samePerson: isSamePerson(leads.map((l) => l.name)),
      matches: leads.map((l) => ({
        leadId: l.id,
        firstName: l.name ? l.name.trim().split(/\s+/)[0] : null,
        statusClass: toStatusClass(l.lifecycleStatus),
        destination: l.destination,
        assignedToId: l.assignedToId,
        recency: classifyTripRecency(l, now),
      })),
    },
  });
});

// ─── POST /api/v1/leads/:id/ai-verify ──────────────────────────
// A rep confirms they have reviewed what the voice agent recorded or changed.
// Deliberately independent of lifecycleStatus: verifying is a review record,
// not a state transition, so it never touches the state machine.
export const verifyAiLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);
  if (!lead.aiHandled) throw new AppError('Lead was not handled by the voice agent', 409);

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      aiVerifiedAt: new Date(),
      aiVerifiedById: req.user.id,
      needsRepFollowup: false,
    },
    select: { id: true, aiHandled: true, aiVerifiedAt: true, aiVerifiedById: true, needsRepFollowup: true },
  });

  res.json({ success: true, data: updated });
});

// ─── GET /api/v1/leads/:id/related ─────────────────────────────
// Every other lead reachable on this lead's phone or WhatsApp number. A
// repeat customer's calls each raise their own lead, so the rep needs one
// place that says "this is the same person, here is their history" — and the
// same view surfaces an accidental duplicate.
//
// Not the voice lookup: this one is JWT-authorized and rep-facing, so it may
// return ids and dates. It still returns no figures.
export const getRelatedLeads = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    select: { id: true, phoneNormalized: true, whatsappNormalized: true, assignedToId: true },
  });
  if (!lead) throw new AppError('Lead not found', 404);

  const { user } = req;
  const canManage = user.isSuperAdmin || user.role === 'admin' || user.permissions.includes('manage_leads');
  if (!canManage && user.role === 'salesRep' && lead.assignedToId !== user.id) {
    throw new AppError('Not authorized to view this lead', 403);
  }

  const digits = [lead.phoneNormalized, lead.whatsappNormalized].filter(Boolean);
  if (digits.length === 0) {
    return res.json({ success: true, data: { count: 0, related: [] } });
  }

  const leads = await prisma.lead.findMany({
    where: {
      id: { not: lead.id },
      OR: [{ phoneNormalized: { in: digits } }, { whatsappNormalized: { in: digits } }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true, name: true, destination: true, lifecycleStatus: true,
      travelDate: true, endDate: true, updatedAt: true, aiHandled: true, leadDateTime: true,
    },
  });

  const now = new Date();

  res.json({
    success: true,
    data: {
      count: leads.length,
      related: leads.map((l) => ({
        id: l.id,
        name: l.name,
        destination: l.destination,
        lifecycleStatus: l.lifecycleStatus,
        travelDate: l.travelDate,
        endDate: l.endDate,
        createdAt: l.leadDateTime,
        aiHandled: l.aiHandled,
        recency: classifyTripRecency(l, now),
      })),
    },
  });
});

// ─── POST /api/v1/leads/:id/claim ──────────────────────────────
// A salesRep/admin claims an unassigned PENDING_VERIFICATION lead, moving it
// into the normal NEW flow. Response envelope matches every other lead-service
// endpoint: { success, data }.
export const claimLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.lifecycleStatus !== 'PENDING_VERIFICATION') {
    throw new AppError('Lead is not pending verification', 409);
  }

  try {
    validateTransition({ currentStatus: 'PENDING_VERIFICATION', nextStatus: 'NEW' });
  } catch (err) {
    // State-machine gatekeeper failures are client errors, not an unhandled 500
    // — matches updateLead's handling of the same validateTransition call.
    if (err.isOperational) throw err;
    throw new AppError("We couldn't claim this lead. Please try again.", 400);
  }

  // Atomic conditional update, not a plain update: the findUnique check above
  // is check-then-act and cannot by itself prevent two salesReps claiming the
  // same lead concurrently. Requiring lifecycleStatus=PENDING_VERIFICATION in
  // the WHERE clause means only the first concurrent claim can succeed.
  // updateMany cannot create nested rows, so the statusHistory audit entry
  // (every other lifecycle transition in this service records one) is a
  // separate write immediately after — the claim is the one event in this
  // whole feature that must be attributable to a specific agent.
  const { count } = await prisma.lead.updateMany({
    where: { id: req.params.id, lifecycleStatus: 'PENDING_VERIFICATION' },
    data: { assignedToId: req.user.id, assignedById: req.user.id, assignmentMode: 'manual', lifecycleStatus: 'NEW' },
  });
  if (count === 0) {
    throw new AppError('Lead was already claimed by someone else', 409);
  }
  await prisma.leadStatusHistory.create({
    data: {
      leadId: req.params.id,
      status: 'NEW',
      actor: 'USER',
      changedById: req.user.id,
      notes: 'Claimed from PENDING_VERIFICATION',
    },
  });

  const updated = await prisma.lead.findUnique({ where: { id: req.params.id } });
  res.json({ success: true, data: { id: updated.id, lifecycleStatus: updated.lifecycleStatus, assignedToId: updated.assignedToId } });
});

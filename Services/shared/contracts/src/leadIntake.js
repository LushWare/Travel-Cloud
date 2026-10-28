import { z } from 'zod';

// Channel-agnostic inbound lead intake — see docs/designs/chatbot-inbound-lead-intake.md.
// The chat wizard (package-service) is the first caller; a future WhatsApp bot
// or contact-form widget would call the same endpoint with a different `channel`.

export const LeadIntakeChannel = z.enum(['chatbot', 'voice']);

export const LeadIntakeContact = z.object({
  name: z.string().min(1).max(255).optional(),
  // Deliberately NOT z.string().email() — this is LLM-extracted from free
  // text with no format gate upstream (wizard-turn's wizardStateSchema.contact
  // is equally loose). Requiring RFC email format here would silently drop
  // the ENTIRE intake call (destination/phone/whatsapp included) on a
  // malformed extraction, when a human agent reviewing the claimed lead is
  // exactly who should catch and correct a bad email — see Premise 4.
  email: z.string().min(1).max(255).optional(),
  phone: z.string().min(1).max(50).optional(),
  whatsapp: z.string().min(1).max(50).optional(),
});

// At least one contact method is required — intake without any way to reach
// the visitor back defeats the point of persisting a Lead at all.
export const LeadIntakeContactWithMethod = LeadIntakeContact.refine(
  (c) => Boolean(c.email || c.phone || c.whatsapp),
  { message: 'At least one of email, phone, or whatsapp is required' },
);

export const LeadIntakeSlots = z.object({
  destination: z.string().max(255).optional(),
  travelDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  duration: z.coerce.number().int().min(1).max(30).optional(),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.string().max(255).optional(),
  preferences: z.string().max(1000).optional(),
}).superRefine((slots, ctx) => {
  if (slots.travelDate && slots.endDate && slots.endDate < slots.travelDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate cannot be before travelDate' });
  }
});

// `id`/`at` are required (not just `role`/`content`) so the server can diff a
// resent sliding window against what it already stored and dedupe per-message
// via `LeadCommunicationLog.externalMessageId` — see design doc Implementation
// shape #5/#6.
export const LeadIntakeTranscriptMessage = z.object({
  id: z.string().min(1).max(255),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
  at: z.string().datetime(),
});

export const LeadIntakeRequest = z.object({
  channel: LeadIntakeChannel,
  sessionId: z.string().min(1).max(255),
  contact: LeadIntakeContactWithMethod,
  slots: LeadIntakeSlots.optional(),
  transcript: z.array(LeadIntakeTranscriptMessage).min(1).max(40),
  selectedPackageId: z.string().uuid().optional(),
  voiceReviewReason: z.enum([
    'package_changed_requires_repricing',
    'package_price_changed_since_search',
    'package_price_unavailable_at_search',
    'quoted_price_unavailable',
    'booking_request_conflicts_with_existing',
    'booking_details_changed_requires_review',
    'customer_identity_changed_requires_review',
  ]).optional(),
});

export const LeadIntakeResult = z.object({
  leadId: z.string(),
  lifecycleStatus: z.string(),
  created: z.boolean(),
});

// POST /leads/:id/claim — a salesRep claiming an unassigned
// PENDING_VERIFICATION lead. No request body beyond the URL param; documented
// here so the response shape has one source of truth alongside the request.
export const LeadClaimResult = z.object({
  id: z.string(),
  lifecycleStatus: z.string(),
  assignedToId: z.string(),
});

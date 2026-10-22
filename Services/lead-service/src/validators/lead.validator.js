import { z } from 'zod';

// ── Lead lifecycle status ───────────────────────────────────────

const lifecycleStatusEnum = z.enum([
  'NEW', 'DRAFTING', 'QUOTED', 'REVISION', 'APPROVED',
  'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CLOSED_LOST',
  'BOOKING_FAILED', 'CANCELLED',
]);

// ── Shared lead fields (contact/travel/assignment — package/itinerary/
// pricing state lives on LeadPackageSelection, not on the Lead itself) ─────

const leadFields = {
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  source: z.string().optional(),
  platform: z.string().optional(),
  fromCountry: z.string().optional().nullable(),
  destinationCountry: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  travelDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  numberOfTravelers: z.number().int().min(1).optional(),
  budget: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
  lifecycleStatus: lifecycleStatusEnum.optional(),
  priority: z.string().optional(),
  assignedToId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  lostReason: z.string().optional().nullable(),
  statusChangeNotes: z.string().optional().nullable(),
};

const remarksSchema = z.array(z.object({
  text: z.string().min(1),
  date: z.string().optional(), // date-only (YYYY-MM-DD) or full ISO; parsed by the service
  addedBy: z.string().optional(),
})).optional();

// ── Schemas ─────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  ...leadFields,
  remarks: remarksSchema,
  // A lead is created with at most one initial package selection — both
  // optional (a bare contact-form-style lead may have neither yet).
  packageId: z.string().uuid().optional().nullable(),
  packageName: z.string().optional().nullable(),
  isManualItinerary: z.boolean().optional(),
}).strict();

export const updateLeadSchema = z.object({
  ...leadFields,
  remarks: remarksSchema,
}).strict();

// ── Per-package selections (LeadPackageSelection) ────────────────

export const createPackageSelectionSchema = z.object({
  packageId: z.string().uuid().optional(),
  isManual: z.boolean().optional(),
}).strict().refine(
  (v) => Boolean(v.packageId) !== Boolean(v.isManual),
  { message: 'Exactly one of packageId or isManual is required' },
);

// Scalar fields a rep can edit directly on an existing selection. Currently
// just the destination override — a null clears it back to the package's
// (or lead's) own destination.
export const updatePackageSelectionSchema = z.object({
  destinationOverride: z.string().min(1).max(255).nullable().optional(),
}).strict();

// ── Communication log (service-to-service ingestion + agent replies) ────

const communicationLogTypeEnum = z.enum(['call', 'email', 'meeting', 'message', 'whatsapp', 'other']);

// Body for POST /internal/communication-logs. Callers identify the lead
// either directly (leadId, e.g. billing-service reporting a doc it just
// sent) or by phone (e.g. notification-service's WhatsApp webhook, which
// only ever has the customer's phone number) — at least one is required.
export const logCommunicationSchema = z.object({
  leadId: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).optional(),
  type: communicationLogTypeEnum,
  notes: z.string().trim().min(1).max(2000),
  occurredAt: z.string().optional(),
}).strict().refine((v) => Boolean(v.leadId) || Boolean(v.phone), {
  message: 'Either leadId or phone is required',
});

export const googleAdsLeadSchema = z.object({
  leadId: z.string().trim().min(1).max(200),
  isTest: z.boolean().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  destination: z.string().trim().max(255).nullable().optional(),
  travelDate: z.string().datetime().nullable().optional(),
  numberOfTravelers: z.number().int().min(1).nullable().optional(),
  budget: z.string().trim().max(100).nullable().optional(),
  message: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Boolean(value.email || value.phone), {
  message: 'Lead must have email or phone',
});

export const whatsappReplySchema = z.object({
  text: z.string().trim().min(1).max(4096),
}).strict();

// ── Optional transfer flights (LeadOptionalFlight) ───────────────

export const addOptionalFlightSchema = z.object({
  flightType: z.enum(['TO_START', 'RETURN_HOME']),
  origin: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  cabinClass: z.string().optional().nullable(),
  departureTime: z.string().optional().nullable(),
  airlinePreference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  estimatedUnitPrice: z.number().min(0).optional(),
  actualUnitPrice: z.number().min(0).optional().nullable(),
  marginType: z.enum(['PERCENTAGE', 'FIXED']).nullable().optional(),
  marginValue: z.number().min(0).nullable().optional(),
}).strict();

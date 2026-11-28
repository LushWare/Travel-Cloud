import { z } from 'zod';
import { TRANSPORT_MODE, PRICING_MODEL, ROUTE_TYPE } from '../../../shared/constants/src/index.js';

// ─── Shared sub-schemas ────────────────────────────────────────

const marginType = z.enum(['PERCENTAGE', 'FIXED']);
const packageCategory = z.enum(['HONEYMOON', 'COUPLE', 'FAMILY', 'GROUP', 'WILD_SAFARI']);
const placeType = z.enum(['CITY', 'ATTRACTION', 'REGION', 'AIRPORT']);
const routeType = z.enum(Object.values(ROUTE_TYPE));
const transportMode = z.enum(Object.values(TRANSPORT_MODE));
const pricingModel = z.enum(Object.values(PRICING_MODEL));

const decimal = () => z.coerce.number();

const imageSchema = z.object({
  url: z.string().min(1, 'Image URL is required'),
  publicId: z.string().max(255).optional().nullable(),
  altText: z.string().optional(),
  orderIndex: z.number().int().min(0).optional(),
});

const dayImageSchema = z.object({
  url: z.string().min(1, 'Image URL is required'),
  publicId: z.string().max(255).optional().nullable(),
  altText: z.string().optional(),
});

// ─── Day sub-schemas ───────────────────────────────────────────

const dayPlace = z.object({
  placeId: z.string().uuid().optional().nullable(),
  customName: z.string().optional().nullable(),
  orderIndex: z.number().int().min(0).default(0),
}).refine((d) => d.placeId || d.customName, {
  message: 'At least one of placeId or customName is required',
});

const dayActivity = z.object({
  activityId: z.string().uuid().optional().nullable(),
  name: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  defaultCost: decimal().optional().nullable(),
  costOverride: decimal().optional().nullable(),
  orderIndex: z.number().int().min(0).default(0),
}).refine((d) => d.activityId || d.name, {
  message: 'At least one of activityId or name is required',
});

const dayTransport = z.object({
  routeType: routeType,
  transportMode: transportMode,
  pricingModel: pricingModel,
  unitCost: decimal().min(0),
  distanceKm: z.number().min(0).optional().nullable(),
  originPlaceId: z.string().uuid().optional().nullable(),
  destinationPlaceId: z.string().uuid().optional().nullable(),
}).superRefine((t, ctx) => {
  if (t.routeType === ROUTE_TYPE.POINT_TO_POINT) {
    if (!t.originPlaceId) {
      ctx.addIssue({ code: 'custom', message: 'originPlaceId is required for POINT_TO_POINT', path: ['originPlaceId'] });
    }
    if (!t.destinationPlaceId) {
      ctx.addIssue({ code: 'custom', message: 'destinationPlaceId is required for POINT_TO_POINT', path: ['destinationPlaceId'] });
    }
  }
  if (t.pricingModel === PRICING_MODEL.PER_KM && (t.distanceKm == null || t.distanceKm <= 0)) {
    ctx.addIssue({ code: 'custom', message: 'distanceKm is required for PER_KM pricing', path: ['distanceKm'] });
  }
});

const itineraryDay = z.object({
  dayNumber: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string().optional(),
  breakfastCount: z.number().int().min(0).default(0),
  lunchCount: z.number().int().min(0).default(0),
  dinnerCount: z.number().int().min(0).default(0),
  mealPriceOverride: decimal().min(0).optional().nullable(),
  breakfastPriceOverride: decimal().min(0).optional().nullable(),
  lunchPriceOverride: decimal().min(0).optional().nullable(),
  dinnerPriceOverride: decimal().min(0).optional().nullable(),
  places: z.array(dayPlace).optional().default([]),
  activities: z.array(dayActivity).optional().default([]),
  transports: z.array(dayTransport).optional().default([]),
  images: z.array(dayImageSchema).optional().default([]),
  accommodation: z.record(z.any()).optional().default({}),
  flights: z.array(z.any()).optional().default([]),
});

// ─── Package schemas ───────────────────────────────────────────

export const createPackageSchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  // Locked in at creation — the authoritative destination for this package.
  // A lead's own (often placeholder, pre-decision) destination must never
  // be able to stand in for a real one once a package exists.
  destination: z.string().min(1, 'Destination is required').max(255),
  durationDays: z.number().int().positive(),
  category: packageCategory,
  coverImage: z.string().max(500).optional(),
  inclusions: z.array(z.string()).optional().default([]),
  exclusions: z.array(z.string()).optional().default([]),
  termsAndConditions: z.string().max(10000).optional(),
  basePrice: decimal().min(0).optional(),
  defaultMarginType: marginType.default('PERCENTAGE'),
  defaultMarginInput: decimal().min(0).default(0),
  currency: z.string().length(3).default('USD'),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  images: z.array(imageSchema).optional().default([]),
  itineraryDays: z.array(itineraryDay).optional().default([]),
});

export const updatePackageSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  slug: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  destination: z.string().max(255).optional(),
  durationDays: z.number().int().positive().optional(),
  category: packageCategory.optional(),
  coverImage: z.string().max(500).optional(),
  inclusions: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
  termsAndConditions: z.string().max(10000).optional(),
  basePrice: decimal().min(0).optional(),
  defaultMarginType: marginType.optional(),
  defaultMarginInput: decimal().min(0).optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  images: z.array(imageSchema).optional(),
  itineraryDays: z.array(itineraryDay).optional(),
});

export const repricePackagesSchema = z.object({
  commit: z.boolean().default(false),
}).strict();

export const packageIdParamSchema = z.object({
  id: z.string().min(1, 'Invalid package ID'),
});

export const packageImageParamSchema = z.object({
  packageId: z.string().min(1, 'Invalid package ID'),
  imageId: z.string().min(1, 'Invalid image ID'),
});

export const packageCoverParamSchema = z.object({
  packageId: z.string().min(1, 'Invalid package ID'),
});

export const setPackageCoverSchema = z.object({
  imageId: z.string().min(1, 'imageId is required'),
});

export const listPackagesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.string().optional(),
  category: packageCategory.optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  isFeatured: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(['createdAt', 'basePrice', 'rating', 'bookings', 'title']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

// ─── AI generation ─────────────────────────────────────────────
// Loosely typed on purpose: these feed a prompt, not the DB, so category/
// packageType accept the display-label strings the Management UI sends
// (e.g. 'honeymoon', 'Deluxe') rather than the strict Package enums —
// aiPackage.controller.js maps them to real enum values after generation.

export const generateAIPackageSchema = z.object({
  destination: z.string().min(1, 'Destination is required').max(255),
  duration: z.coerce.number().int().min(1).max(30),
  category: z.string().max(50).optional(),
  packageType: z.string().max(50).optional(),
  budget: z.string().max(100).optional(),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  preferences: z.string().max(1000).optional(),
  description: z.string().max(1000).optional(),
});

export const generateFromTitleSchema = z.object({
  title: z.string().min(1).max(255),
  destination: z.string().max(255).optional(),
  duration: z.coerce.number().int().min(1).max(30).optional(),
  category: z.string().max(50).optional(),
});

export const generateItineraryPreviewSchema = z.object({
  destination: z.string().min(1, 'Destination is required').max(255),
  duration: z.coerce.number().int().min(1).max(30),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.string().max(100).optional(),
  preferences: z.string().max(1000).optional(),
});

// ─── Per-day / range AI generation (public, non-persisting) ────
// existingDays carries the trip's other days as prompt context so the model
// avoids duplicating already-planned locations/activities. Permissive
// (passthrough, only dayNumber required) since the client sends its full
// editable day-state shape, of which only dayNumber/title/locations/activities
// feed the prompt. Bounds are deliberately tight (well under a real day's
// content) — this is public and unauthenticated, sharing itineraryChatLimiter
// with the chat endpoints, so a padded existingDays array must not let one
// request balloon the billed prompt far past what a real trip needs.
const existingDayContextSchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(30),
  title: z.string().max(100).optional().nullable(),
  locations: z.array(z.string().max(100)).max(15).optional(),
  activities: z.array(z.string().max(100)).max(15).optional(),
}).passthrough();

export const generateDayPreviewSchema = z.object({
  destination: z.string().min(1, 'Destination is required').max(255),
  dayNumber: z.coerce.number().int().min(1).max(30),
  totalDuration: z.coerce.number().int().min(1).max(30),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.string().max(100).optional(),
  preferences: z.string().max(1000).optional(),
  existingDays: z.array(existingDayContextSchema).max(30).optional(),
});

export const generateDaysRangePreviewSchema = z.object({
  destination: z.string().min(1, 'Destination is required').max(255),
  dayNumbers: z.array(z.coerce.number().int().min(1).max(30)).min(1).max(30),
  totalDuration: z.coerce.number().int().min(1).max(30),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.string().max(100).optional(),
  preferences: z.string().max(1000).optional(),
  existingDays: z.array(existingDayContextSchema).max(30).optional(),
});

// ─── Conversational itinerary chat (public, non-persisting) ────

const itineraryChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

// Wizard-turn messages additionally carry a stable per-message id and the
// time it was sent, so the intake payload's transcript can be diffed against
// what lead-service already stored (see docs/designs/chatbot-inbound-lead-intake.md).
// `id` must be a STABLE per-message id the client assigns once and reuses every
// time that message reappears in the resent sliding window. itineraryChatMessageSchema
// is intentionally NOT changed — itinerary-chat has no server-side transcript diffing.
const wizardTurnMessageSchema = z.object({
  id: z.string().min(1).max(255),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
  at: z.string().datetime(),
});

const itineraryChatSlotsSchema = z.object({
  destination: z.string().max(255).optional(),
  duration: z.coerce.number().int().min(1).max(30).optional(),
  travelers: z.coerce.number().int().min(1).max(50).optional(),
  budget: z.string().max(100).optional(),
  preferences: z.string().max(1000).optional(),
});

export const itineraryChatSchema = z.object({
  messages: z.array(itineraryChatMessageSchema).min(1).max(20),
  slots: itineraryChatSlotsSchema.optional(),
});

// ─── Trip-planning wizard (public, non-persisting) ──────────────
// wizardState carries the same slot shape as itineraryChatSlotsSchema, plus
// an optional selectedPackageId the client sets deterministically when the
// traveler picks a proposed package (never parsed out of free text by the
// model) — see wizard.controller.js's complete_wizard handling.

const wizardStateSchema = z.object({
  slots: itineraryChatSlotsSchema.optional(),
  selectedPackageId: z.string().optional(),
  contact: z.object({
    name: z.string().max(255).optional(),
    email: z.string().max(255).optional(),
    phone: z.string().max(50).optional(),
    whatsapp: z.string().max(50).optional(),
  }).optional(),
});

export const wizardTurnSchema = z.object({
  wizardState: wizardStateSchema.optional(),
  sessionId: z.string().min(1).max(255).optional(),
  messages: z.array(wizardTurnMessageSchema).min(1).max(20),
});

// ─── Place / Activity sub-schemas ─────────────────────────────

export const createPlaceSchema = z.object({
  name: z.string().min(1).max(255),
  type: placeType,
  defaultCost: decimal().min(0).optional().nullable(),
});

export const updatePlaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: placeType.optional(),
  defaultCost: decimal().min(0).optional().nullable(),
});

export const createActivitySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  defaultCost: decimal().min(0),
  vendorId: z.string().uuid().optional().nullable(),
});

export const updateActivitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  defaultCost: decimal().min(0).optional(),
  vendorId: z.string().uuid().optional().nullable(),
});

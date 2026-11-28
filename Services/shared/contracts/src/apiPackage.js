import { z } from 'zod';
import { moneyField } from './money.js';

// Mirrors Services/package-service/src/services/package.service.js's
// serializePackage/serializePackageList output. Not a full re-typing of the
// package-service model (that stays packages.transform.ts's job) — just the
// fields the Client's normalization layer reads. .passthrough() so
// backend-only fields (e.g. admin metadata) don't break parsing.
const ApiPackageItineraryPlace = z
  .object({
    place: z.object({ name: z.string().optional() }).nullable().optional(),
    customName: z.string().nullable().optional(),
  })
  .passthrough();

const ApiPackageItineraryActivity = z
  .object({
    activity: z.object({ name: z.string().optional() }).nullable().optional(),
  })
  .passthrough();

const ApiPackageItineraryDay = z
  .object({
    dayNumber: z.number().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    places: z.array(ApiPackageItineraryPlace).optional(),
    activities: z.array(ApiPackageItineraryActivity).optional(),
  })
  .passthrough();

const ApiPackageImage = z
  .object({
    url: z.string().optional(),
  })
  .passthrough();

export const ApiPackage = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    title: z.string().optional(),
    slug: z.string().optional(),
    description: z.string().optional(),
    destination: z.string().optional(),
    durationDays: z.number().optional(),
    category: z.string().nullable().optional(),
    coverImage: z.string().nullable().optional(),
    basePrice: moneyField.optional(),
    sellPrice: moneyField.optional(),
    singleSupplement: moneyField.optional(),
    currency: z.string().optional(),
    termsAndConditions: z.string().nullable().optional(),
    inclusions: z.array(z.string()).optional(),
    exclusions: z.array(z.string()).optional(),
    images: z.array(ApiPackageImage).optional(),
    itineraryDays: z.array(ApiPackageItineraryDay).optional(),
    highlights: z.array(z.string()).optional(),
    difficulty: z.string().nullable().optional(),
    rating: z.number().optional(),
    averageRating: z.number().optional(),
    numReviews: z.number().optional(),
    reviewCount: z.number().optional(),
    isActive: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    bookings: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

// GET /reviews/package/:id/stats returns { avgRating, count } — confirmed
// against Services/package-service's getReviewStats controller.
export const ReviewStatsResult = z
  .object({
    avgRating: z.number().optional(),
    count: z.number().optional(),
  })
  .passthrough();

export const WebsiteReviewRequest = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
});

export const WebsiteReview = z
  .object({
    _id: z.string().optional(),
    id: z.string(),
    rating: z.number(),
    comment: z.string(),
    name: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

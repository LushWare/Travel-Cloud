import { z } from 'zod';
import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';

export const initializeOnboardingSchema = z.object({}).strict();

const STARTER_PLACES = [
  'Bali, Indonesia',
  'Bangkok, Thailand',
  'Dubai, United Arab Emirates',
  'London, United Kingdom',
  'Maldives',
  'Paris, France',
  'Singapore',
  'Tokyo, Japan',
];

const STARTER_ACTIVITIES = [
  'Airport transfer',
  'Boat cruise',
  'Cultural experience',
  'Guided city tour',
  'Local food tour',
  'Museum visit',
  'Shopping tour',
  'Wildlife excursion',
];

export const initializeOnboardingCatalog = asyncHandler(async (_req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const [placeCount, activityCount] = await Promise.all([
      tx.place.count(),
      tx.activityCatalog.count(),
    ]);

    const [placesCreated, activitiesCreated] = await Promise.all([
      placeCount === 0
        ? tx.place.createMany({
          data: STARTER_PLACES.map((name) => ({ name, type: 'CITY' })),
          skipDuplicates: true,
        })
        : { count: 0 },
      activityCount === 0
        ? tx.activityCatalog.createMany({
          data: STARTER_ACTIVITIES.map((name) => ({ name, defaultCost: 0 })),
          skipDuplicates: true,
        })
        : { count: 0 },
    ]);

    return {
      placesCreated: placesCreated.count,
      activitiesCreated: activitiesCreated.count,
    };
  });

  res.json({ status: 'success', data: result });
});

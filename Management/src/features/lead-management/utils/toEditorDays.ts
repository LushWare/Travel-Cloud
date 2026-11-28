import type { ItineraryDay } from '@/features/itinerary/types';

/**
 * Convert API day shapes (package blueprint serialization, lead serialized
 * itinerary) into the ItineraryEditor's canonical day shape:
 *   - activities: array of name strings + activityCosts map (+ _relational)
 *   - places/locations: array of name strings
 *   - meals booleans derived from counts, transports normalized
 */
export function toEditorDays(days: any[] | null | undefined): ItineraryDay[] {
  return (days || []).map((day) => {
    const rawActs = Array.isArray(day.activities) ? day.activities : [];
    const activityCosts = { ...(day.activityCosts || {}) };
    const relational: any[] = [];

    rawActs.forEach((a: any) => {
      if (a && typeof a === 'object') {
        const name = a.name || a.activity?.name || '';
        if (name) {
          if (activityCosts[name] == null) {
            activityCosts[name] = {
              defaultCost: a.activity?.defaultCost ?? a.defaultCost ?? 0,
              costOverride: a.costOverride ?? null,
            };
          }
          relational.push({
            activityId: a.activityId ?? null,
            name,
            description: a.description ?? a.activity?.description ?? null,
            costOverride: a.costOverride ?? null,
            activity: a.activity || null,
          });
        }
      }
    });

    return {
      ...day,
      dayNumber: day.dayNumber,
      title: day.title || null,
      description: day.description || null,
      breakfastCount: day.breakfastCount || 0,
      lunchCount: day.lunchCount || 0,
      dinnerCount: day.dinnerCount || 0,
      mealPriceOverride: day.mealPriceOverride ?? null,
      breakfastPriceOverride: day.breakfastPriceOverride ?? null,
      lunchPriceOverride: day.lunchPriceOverride ?? null,
      dinnerPriceOverride: day.dinnerPriceOverride ?? null,
      meals: day.meals || {
        breakfast: !!day.breakfastCount,
        lunch: !!day.lunchCount,
        dinner: !!day.dinnerCount,
      },
      activities: rawActs
        .map((a: any) => (typeof a === 'string' ? a : (a.name || a.activity?.name || '')))
        .filter(Boolean),
      activityCosts,
      _relational: { ...(day._relational || {}), activities: relational },
      locations: Array.isArray(day.locations)
        ? day.locations
        : (day.places || [])
            .map((p: any) => (typeof p === 'string' ? p : (p.customName || p.place?.name || '')))
            .filter(Boolean),
      transports: (day.transports || []).map((t: any) => ({
        routeType: t.routeType ?? null,
        transportMode: t.transportMode ?? null,
        pricingModel: t.pricingModel ?? null,
        unitCost: Number(t.unitCost) || 0,
        distanceKm: t.distanceKm != null ? Number(t.distanceKm) : null,
      })),
      accommodation: day.accommodation || {},
      flights: day.flights || [],
    } as ItineraryDay;
  });
}

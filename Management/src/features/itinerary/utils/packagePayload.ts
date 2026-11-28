import { pricedDayTransports } from './flightSync';

export function buildItineraryDaysPayload(days: any[]) {
  return (days || []).filter(Boolean).map((day) => {
    const dayPlaces = Array.isArray(day.places) && day.places.length > 0
      ? day.places
      : (Array.isArray(day.locations) ? day.locations : []);

    const editorActivities = Array.isArray(day.activities)
      ? day.activities
      : (typeof day.activities === 'string'
        ? day.activities.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []);

    const relationalActivities = Array.isArray(day._relational?.activities) ? day._relational.activities : [];
    const activities = editorActivities.length > 0 && editorActivities.every((a: any) => typeof a === 'string') && relationalActivities.length > 0
      ? editorActivities.map((name: string) =>
          relationalActivities.find((row: any) => (row.activity?.name || row.name) === name) ?? name)
      : editorActivities;

    const rawTransports = Array.isArray(day.transports) && day.transports.length > 0
      ? day.transports
      : (Array.isArray(day._relational?.transports) && day._relational.transports.length > 0
        ? day._relational.transports
        : []);

    const flights = Array.isArray(day.flights) ? day.flights : [];
    const transports = pricedDayTransports(flights, rawTransports);

    const meals = (day.meals && typeof day.meals === 'object') ? day.meals : null;
    const activityCosts = (day.activityCosts && typeof day.activityCosts === 'object') ? day.activityCosts : {};

    return {
      dayNumber: day.dayNumber,
      title: day.title || '',
      description: day.description || '',
      breakfastCount: day.breakfastCount ?? (meals ? (meals.breakfast ? 1 : 0) : 0),
      lunchCount: day.lunchCount ?? (meals ? (meals.lunch ? 1 : 0) : 0),
      dinnerCount: day.dinnerCount ?? (meals ? (meals.dinner ? 1 : 0) : 0),
      mealPriceOverride: day.mealPriceOverride === '' ? null : (day.mealPriceOverride ?? null),
      breakfastPriceOverride: day.breakfastPriceOverride === '' ? null : (day.breakfastPriceOverride ?? null),
      lunchPriceOverride: day.lunchPriceOverride === '' ? null : (day.lunchPriceOverride ?? null),
      dinnerPriceOverride: day.dinnerPriceOverride === '' ? null : (day.dinnerPriceOverride ?? null),
      accommodation: day.accommodation ?? null,
      flights,
      images: Array.isArray(day.images)
        ? day.images.map((img: any) => ({
            url: img.url || img,
            publicId: img.publicId || img.public_id,
            altText: img.altText || img.alt_text,
          }))
        : [],
      places: dayPlaces.map((p: any, i: number) => {
        if (typeof p === 'string') return { customName: p, orderIndex: i };
        return {
          placeId: p.placeId || p.place?.id || undefined,
          customName: p.customName || p.name || undefined,
          orderIndex: p.orderIndex ?? i,
        };
      }),
      activities: activities.map((a: any, i: number) => {
        const isObj = a && typeof a === 'object';
        const name = isObj ? (a.name || a.activity?.name || '') : (a || '');
        const cost: any = name ? activityCosts[name] : null;
        const relationalRow: any = Array.isArray(day._relational?.activities)
          ? day._relational.activities.find((row: any) =>
              (row.activity?.name || row.name) === name ||
              (isObj && a.activityId && row.activityId === a.activityId)
            )
          : null;
        return {
          activityId: isObj ? (a.activityId || a.activity?.id || undefined) : undefined,
          name: name || undefined,
          defaultCost:
            cost?.defaultCost ??
            (isObj ? (a.defaultCost ?? a.activity?.defaultCost) : undefined) ??
            relationalRow?.activity?.defaultCost,
          // An empty override box means "no override", as the price panel reads it.
          costOverride: cost?.costOverride != null && cost.costOverride !== ''
            ? cost.costOverride
            : (isObj ? (a.costOverride ?? null) : null),
          orderIndex: isObj ? (a.orderIndex ?? i) : i,
        };
      }),
      transports: transports.map((t: any) => ({
        routeType: t.routeType || 'DAILY_ROUTING',
        transportMode: t.transportMode || String(t.transport || day.transport || 'CAR').toUpperCase(),
        pricingModel: t.pricingModel || 'PER_VEHICLE',
        unitCost: t.unitCost ?? 0,
        distanceKm: t.distanceKm ?? null,
        originPlaceId: t.originPlaceId ?? null,
        destinationPlaceId: t.destinationPlaceId ?? null,
      })),
    };
  });
}

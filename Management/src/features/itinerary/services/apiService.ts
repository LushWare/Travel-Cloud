/**
 * API Service for packages and related endpoints.
 * Handles all communication with the package-service backend.
 */

import { reconcileFlightsForSave } from '../utils/flightSync';
import { API_BASE_URL, authFetch } from '@/lib/authFetch';

interface ApiError extends Error {
  status?: number;
  data?: unknown;
  errors?: unknown[];
}

async function makeRequest(endpoint: string, options: RequestInit & { headers?: Record<string, string> } = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await authFetch(url, config);
    const data = await response.json();

    if (!response.ok) {
      const error: ApiError = new Error(data.message || 'API request failed');
      error.status = response.status;
      error.data = data;
      error.errors = data.errors || [];
      throw error;
    }

    return data;
  } catch (error) {
    console.error(`[API Error] ${endpoint}:`, (error as Error).message);
    throw error;
  }
}

class ApiService {

  // ==================== PACKAGE ENDPOINTS ====================

  static async getPackages(params: Record<string, string> = {}) {
    const queryString = new URLSearchParams(params).toString();
    return makeRequest(`/packages${queryString ? `?${queryString}` : ''}`);
  }

  static async getPackagesProtected(params: Record<string, string> = {}) {
    const queryString = new URLSearchParams(params).toString();
    return makeRequest(`/packages/protected/all${queryString ? `?${queryString}` : ''}`);
  }

  static async getPackage(id: string) {
    return makeRequest(`/packages/${id}`);
  }

  static async generateAIPackage(destination: string, packageType: string, category: string, nights: number | string, description = '') {
    return makeRequest('/packages/generate-ai', {
      method: 'POST',
      body: JSON.stringify({
        destination,
        packageType,
        category,
        duration: parseInt(String(nights), 10),
        description,
      }),
    });
  }

  static async createPackage(packageData: any) {
    const rawDays = Array.isArray(packageData.days)
      ? packageData.days
      : (Array.isArray(packageData.itineraryDays) ? packageData.itineraryDays : []);

    const cleanData: any = {
      title: packageData.title || packageData.name,
      description: packageData.description,
      destination: packageData.destination,
      durationDays: packageData.durationDays || packageData.duration,
      category: packageData.category,
      coverImage: packageData.coverImage || packageData.coverImageUrl,
      inclusions: packageData.inclusions || [],
      exclusions: packageData.exclusions || [],
      termsAndConditions: packageData.termsAndConditions || (packageData.terms || []).join('. '),
      basePrice: packageData.basePrice ?? packageData.price,
      defaultMarginType: packageData.defaultMarginType || 'PERCENTAGE',
      defaultMarginInput: packageData.defaultMarginInput ?? 20,
      currency: packageData.currency || 'USD',
      isActive: packageData.isActive ?? (packageData.status === 'published'),
      isFeatured: packageData.isFeatured ?? false,
      images: (packageData.images || []).map((img: any) => ({
        url: img.url || img,
        publicId: img.publicId || img.public_id,
        altText: img.altText || img.alt_text,
      })),
      itineraryDays: buildItineraryDaysPayload(rawDays),
    };

    delete cleanData.id;
    delete cleanData._id;
    delete cleanData._v;
    delete cleanData.__v;
    delete cleanData.createdAt;
    delete cleanData.createdBy;
    delete cleanData.slug;

    return makeRequest('/packages', {
      method: 'POST',
      body: JSON.stringify(cleanData, (key, value) => value === null ? undefined : value),
    });
  }

  static async updatePackage(id: string, packageData: any) {
    const cleanData: any = { ...packageData };
    delete cleanData._id;
    delete cleanData.id;
    delete cleanData._v;
    delete cleanData.__v;
    delete cleanData.createdAt;
    delete cleanData.createdBy;
    delete cleanData.slug;

    // The editor submits editor-shaped `days` (meals booleans, locations,
    // transport mode). Convert them to the relational `itineraryDays` shape the
    // backend persists, and drop both the editor `days` and any stale
    // `itineraryDays` copied from the GET response so edits (including meal
    // toggles) actually save.
    if (Array.isArray(packageData.days)) {
      cleanData.itineraryDays = buildItineraryDaysPayload(packageData.days);
      delete cleanData.days;
    } else if (Array.isArray(packageData.itineraryDays)) {
      cleanData.itineraryDays = buildItineraryDaysPayload(packageData.itineraryDays);
    }

    // Map legacy fields to new field names
    if (cleanData.name && !cleanData.title) cleanData.title = cleanData.name;
    if (cleanData.price !== undefined && cleanData.basePrice === undefined) cleanData.basePrice = cleanData.price;
    if (cleanData.terms && !cleanData.termsAndConditions) cleanData.termsAndConditions = cleanData.terms.join('. ');

    return makeRequest(`/packages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cleanData, (key, value) => value === null ? undefined : value),
    });
  }

  static async deletePackage(id: string) {
    return makeRequest(`/packages/${id}`, { method: 'DELETE' });
  }

  static async deletePackageImage(packageId: string, imageId: string) {
    return makeRequest(`/packages/${packageId}/images/${imageId}`, { method: 'DELETE' });
  }

  static async setPackageCover(packageId: string, imageId: string) {
    return makeRequest(`/packages/${packageId}/cover`, {
      method: 'PUT',
      body: JSON.stringify({ imageId }),
    });
  }

  // Server-generated package PDF (Services/package-service's packagePDFGenerator.js).
  // Not routed through makeRequest() since that always parses the response as JSON.
  static async getPackagePdfBlob(id: string) {
    const response = await authFetch(`${API_BASE_URL}/packages/${id}/ai-pdf`);
    if (!response.ok) {
      const error: ApiError = new Error('Failed to generate package PDF');
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  static async getFeaturedPackages(limit = 6) {
    return makeRequest(`/packages/featured/all?limit=${limit}`);
  }

  static async getPackageStats() {
    return makeRequest('/packages/stats/all');
  }

  static async searchPackages(query: string) {
    return makeRequest(`/packages/search/query?query=${encodeURIComponent(query)}`);
  }

  static async getPackagesByCategory(category: string, limit = 10) {
    return makeRequest(`/packages/category/${category}?limit=${limit}`);
  }

  static async calculatePrice(payload: any = {}) {
    const {
      days,
      itineraryDays,
      defaultMarginType = 'PERCENTAGE',
      defaultMarginInput = 0,
    } = payload;

    const rawDays = Array.isArray(itineraryDays) && itineraryDays.length > 0
      ? itineraryDays
      : (Array.isArray(days) ? days : []);

    const body = {
      itineraryDays: buildItineraryDaysPayload(rawDays),
      defaultMarginType,
      defaultMarginInput,
    };

    return makeRequest('/packages/calculate-price', {
      method: 'POST',
      body: JSON.stringify(body, (key, value) => value === null ? undefined : value),
    });
  }

  // ==================== PLACES & ACTIVITIES ====================

  static async getPlaces(params: Record<string, string> = {}) {
    const queryString = new URLSearchParams(params).toString();
    return makeRequest(`/places${queryString ? `?${queryString}` : ''}`);
  }

  static async createPlace(data: any) {
    return makeRequest('/places', { method: 'POST', body: JSON.stringify(data) });
  }

  static async getActivities(params: Record<string, string> = {}) {
    const queryString = new URLSearchParams(params).toString();
    return makeRequest(`/activities${queryString ? `?${queryString}` : ''}`);
  }

  static async createActivity(data: any) {
    return makeRequest('/activities', { method: 'POST', body: JSON.stringify(data) });
  }
}

/**
 * Normalize editor/API day objects into the relational `itineraryDays` payload
 * the package-service persists. Meal toggles in the editor live on
 * `day.meals` booleans, so those win over stale `breakfastCount`/`lunchCount`/
 * `dinnerCount` values copied from the API response.
 */
function buildItineraryDaysPayload(days: any[]) {
  return (days || []).filter(Boolean).map((day) => {
    const dayPlaces = Array.isArray(day.places) && day.places.length > 0
      ? day.places
      : (Array.isArray(day.locations) ? day.locations : []);

    const editorActivities = Array.isArray(day.activities)
      ? day.activities
      : (typeof day.activities === 'string'
        ? day.activities.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []);
    // The editor maps relational day activities to plain display names, which
    // loses the activityId. Prefer the raw relational rows (kept in
    // _relational.activities) so IDs and catalog costs survive an edit-save.
    const relationalActivities = Array.isArray(day._relational?.activities) ? day._relational.activities : [];
    const activities = editorActivities.length > 0 && editorActivities.every((a: any) => typeof a === 'string') && relationalActivities.length > 0
      ? relationalActivities
      : editorActivities;

    const rawTransports = Array.isArray(day.transports) && day.transports.length > 0
      ? day.transports
      : (Array.isArray(day._relational?.transports) && day._relational.transports.length > 0
        ? day._relational.transports
        : []);

    const flights = Array.isArray(day.flights) ? day.flights : [];
    // Flight price wins on save when real (>0); while totalAmount is the
    // placeholder 0, manual FLIGHT row costs are preserved.
    const transports = reconcileFlightsForSave({ flights, transports: rawTransports });

    const meals = (day.meals && typeof day.meals === 'object') ? day.meals : null;
    const activityCosts = (day.activityCosts && typeof day.activityCosts === 'object') ? day.activityCosts : {};

    return {
      dayNumber: day.dayNumber,
      title: day.title || '',
      description: day.description || '',
      // Explicit count fields (Costs & Pricing subsection) win over the legacy
      // boolean toggles; loaded days without counts fall back to the booleans.
      breakfastCount: day.breakfastCount ?? (meals ? (meals.breakfast ? 1 : 0) : 0),
      lunchCount: day.lunchCount ?? (meals ? (meals.lunch ? 1 : 0) : 0),
      dinnerCount: day.dinnerCount ?? (meals ? (meals.dinner ? 1 : 0) : 0),
      mealPriceOverride: day.mealPriceOverride ?? null,
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
          costOverride: cost?.costOverride ?? (isObj ? (a.costOverride ?? null) : null),
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

export default ApiService;

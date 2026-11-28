/**
 * API Service for packages and related endpoints.
 * Handles all communication with the package-service backend.
 */

import { buildItineraryDaysPayload } from '../utils/packagePayload';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

interface ApiError extends Error {
  status?: number;
  data?: unknown;
  errors?: unknown[];
}

async function makeRequest(endpoint: string, options: RequestInit & { headers?: Record<string, string> } = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');

  const config: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
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
      defaultMarginInput: packageData.defaultMarginInput ?? 0,
      currency: packageData.currency || 'USD',
      isActive: isActiveFor(packageData),
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
    if (packageData.status !== undefined) cleanData.isActive = isActiveFor(packageData);
    delete cleanData.status;

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
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/packages/${id}/ai-pdf`, {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    });
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

export function isActiveFor(packageData: any): boolean {
  if (packageData.status === 'published') return true;
  if (packageData.status === 'draft') return false;
  return packageData.isActive ?? false;
}


export default ApiService;

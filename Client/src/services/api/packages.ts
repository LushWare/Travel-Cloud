import { z } from 'zod';
import httpClient from '../http/client';
import { HTTP_CONFIG } from '../http/config';
import { parseEnvelope } from '../http/envelope';
import { ApiPackage, WebsiteReviewRequest, WebsiteReview, ReviewStatsResult } from '@travel-crm/contracts';
import { aggregateDestinations, normalizePackage } from './packages.transform';

const DEFAULT_LIMIT = 6;
const LARGE_CATALOGUE_LIMIT = 100;
const LARGE_CATALOGUE_TIMEOUT_MS = 45_000;
const PACKAGE_CACHE_TTL_MS = 5 * 60_000;
const ApiPackageList = z.array(ApiPackage);
type NormalizedPackage = ReturnType<typeof normalizePackage>;
type CachedValue<T> = { value: T; expiresAt: number };

type PackageListResult = {
  packages: NormalizedPackage[];
  destinations: ReturnType<typeof aggregateDestinations>;
  pagination: unknown;
};

const inFlightPackageRequests = new Map<string, Promise<PackageListResult>>();
const inFlightPackageDetailRequests = new Map<string, Promise<NormalizedPackage>>();
const packageListCache = new Map<string, CachedValue<PackageListResult>>();
const packageDetailCache = new Map<string, CachedValue<NormalizedPackage>>();

const getPackageListCacheKey = (params: Record<string, unknown> = {}) => {
  const requestParams = {
    limit: DEFAULT_LIMIT,
    status: 'published',
    ...params,
  };
  const key = JSON.stringify(
    Object.entries(requestParams).sort(([left], [right]) => left.localeCompare(right))
  );
  return { key, requestParams };
};

const getFreshCachedValue = <T,>(cache: Map<string, CachedValue<T>>, key: string): T | null => {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
};

export const clearPackageReadCache = () => {
  packageListCache.clear();
  packageDetailCache.clear();
};

export const getCachedPackages = (params: Record<string, unknown> = {}) => {
  const { key } = getPackageListCacheKey(params);
  return getFreshCachedValue(packageListCache, key);
};

export const getCachedPackageById = (id: string) =>
  id ? getFreshCachedValue(packageDetailCache, id) : null;

export const fetchPackages = (params: Record<string, unknown> = {}) => {
  const { key: requestKey, requestParams } = getPackageListCacheKey(params);
  const cachedRequest = packageListCache.get(requestKey);
  if (cachedRequest && cachedRequest.expiresAt > Date.now()) {
    return Promise.resolve(cachedRequest.value);
  }
  packageListCache.delete(requestKey);

  const inFlightRequest = inFlightPackageRequests.get(requestKey);
  if (inFlightRequest) return inFlightRequest;

  const isLargeCatalogueRequest = Number(requestParams.limit) >= LARGE_CATALOGUE_LIMIT;
  const request = httpClient.get('/packages', {
    params: requestParams,
    ...(isLargeCatalogueRequest
      ? { timeout: Math.max(HTTP_CONFIG.timeoutMs, LARGE_CATALOGUE_TIMEOUT_MS), retry: false }
      : {}),
  }).then((response) => {
    const rawPackages = Array.isArray(response.data?.data) ? ApiPackageList.parse(response.data.data) : [];
    const normalizedPackages = rawPackages.map((pkg) => normalizePackage(pkg));
    const destinations = aggregateDestinations(normalizedPackages);

    const result = {
      packages: normalizedPackages,
      destinations,
      pagination: response.data?.pagination || null,
    };
    const expiresAt = Date.now() + PACKAGE_CACHE_TTL_MS;
    packageListCache.set(requestKey, { value: result, expiresAt });
    return result;
  });

  const sharedRequest = request.finally(() => {
    inFlightPackageRequests.delete(requestKey);
  });
  inFlightPackageRequests.set(requestKey, sharedRequest);
  return sharedRequest;
};

export const fetchFeaturedPackages = async (limit = 6) => {
  const response = await httpClient.get('/packages/featured/all', {
    params: { limit },
  });

  const rawPackages = Array.isArray(response.data?.data) ? ApiPackageList.parse(response.data.data) : [];
  return rawPackages.map((pkg) => normalizePackage(pkg));
};

export const fetchPackageById = async (id: string) => {
  if (!id) {
    throw new Error('Package id is required');
  }

  const cachedPackage = packageDetailCache.get(id);
  if (cachedPackage && cachedPackage.expiresAt > Date.now()) return cachedPackage.value;
  packageDetailCache.delete(id);

  const inFlightRequest = inFlightPackageDetailRequests.get(id);
  if (inFlightRequest) return inFlightRequest;

  const request = httpClient.get(`/packages/${id}`).then((response) => {
    const pkg = parseEnvelope(ApiPackage, response.data, 'GET /packages/:id').data;
    const normalizedPackage = normalizePackage(pkg);
    packageDetailCache.set(id, {
      value: normalizedPackage,
      expiresAt: Date.now() + PACKAGE_CACHE_TTL_MS,
    });
    return normalizedPackage;
  });
  const sharedRequest = request.finally(() => inFlightPackageDetailRequests.delete(id));
  inFlightPackageDetailRequests.set(id, sharedRequest);
  return sharedRequest;
};

/**
 * Returns the raw, non-normalized `{ success, data }` envelope for a
 * package, exactly as the (now-deleted) pdf/apiService.js's `getPackage`
 * did via `fetch`. Only for `features/packages/pdf/pdfService.ts`'s `createPackagePdfBlob`,
 * which expects this specific raw shape — every other caller wants
 * `fetchPackageById`'s normalized shape instead.
 */
export const getPackageEnvelope = async (id: string) => {
  const response = await httpClient.get(`/packages/${id}`);
  parseEnvelope(ApiPackage, response.data, 'GET /packages/:id (raw)');
  return response.data;
};

type ReviewPayload = z.infer<typeof WebsiteReviewRequest>;

export const submitReview = async (packageId: string, reviewData: ReviewPayload) => {
  if (!packageId) {
    throw new Error('Package id is required');
  }

  const body = WebsiteReviewRequest.parse({
    name: reviewData.name,
    email: reviewData.email || '',
    rating: reviewData.rating,
    comment: reviewData.comment,
  });

  const response = await httpClient.post(`/reviews/package/${packageId}`, body);
  return parseEnvelope(WebsiteReview, response.data, 'POST /reviews/package/:id').data;
};

export const fetchPackageReviews = async (packageId: string, limit = 10, page = 1) => {
  if (!packageId) {
    throw new Error('Package id is required');
  }

  const response = await httpClient.get(`/reviews/package/${packageId}`, {
    params: { limit, page },
  });

  return {
    reviews: Array.isArray(response.data?.data) ? z.array(WebsiteReview).parse(response.data.data) : [],
    pagination: response.data?.pagination || null,
  };
};

export const fetchReviewStats = async (packageId: string) => {
  if (!packageId) {
    throw new Error('Package id is required');
  }

  const response = await httpClient.get(`/reviews/package/${packageId}/stats`);
  return parseEnvelope(ReviewStatsResult, response.data, 'GET /reviews/package/:id/stats').data;
};

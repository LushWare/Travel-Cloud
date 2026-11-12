// Local, trimmed copy of billing-service's org-settings client
// (Services/billing-service/src/config/orgSettings.js) — package-service only
// needs the identity/branding fields the package PDF's header, footer and
// page-1 letterhead render (company name, tagline, logo, address, contact),
// plus supportEmail/whatsappNumber for the trip-planning wizard's
// answer_policy_question fallback (docs/designs/ai-trip-planning-assistant.md),
// not the full billing branding shape (bank details, payment terms, reviews,
// etc.). Duplicated rather than shared: these are independently deployable
// services with no shared workspace.

import { createTenantCache } from '../../../shared/tenancy/src/index.js';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;

const FALLBACK = {
  companyName: process.env.COMPANY_NAME || 'Travel CRM',
  tagline: process.env.COMPANY_TAGLINE || 'Your Travel Partner',
  ratingTagline: process.env.QUOTATION_RATING_TAGLINE || 'Rated 4.9  |  10k+ Travellers  |  30+ Destinations',
  logoUrl: process.env.COMPANY_LOGO || '',
  companyAddress: process.env.COMPANY_ADDRESS || '',
  contactPhone: process.env.COMPANY_PHONE || '',
  contactEmail: process.env.COMPANY_EMAIL || '',
  website: process.env.COMPANY_WEBSITE || '',
  supportEmail: process.env.COMPANY_SUPPORT_EMAIL || '',
  whatsappNumber: process.env.COMPANY_WHATSAPP_NUMBER || '',
};

// Keyed by the requesting agency — a single shared slot would put the first
// agency's name and logo on every other agency's package PDFs.
const cache = createTenantCache({ ttlMs: CACHE_TTL_MS });

async function fetchFromUserService(fetchImpl) {
  const res = await fetchImpl(`${USER_SERVICE_URL}/api/v1/admin/internal/organization-settings`, {
    headers: { 'x-internal-token': INTERNAL_SERVICE_KEY },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`user-service returned ${res.status}`);
  const body = await res.json();
  return body.data.settings;
}

/**
 * Org branding for the PDF header/footer/letterhead, cached for
 * CACHE_TTL_MS. Falls back to env-var/static defaults when user-service
 * can't be reached and there's no usable cache — never throws, so a
 * branding lookup never blocks PDF generation.
 */
export async function getOrgSettings({ fetchImpl = fetch } = {}) {
  const cached = cache.get();
  if (cached) return cached;
  try {
    const settings = await fetchFromUserService(fetchImpl);
    const value = {
      companyName: settings.companyName || FALLBACK.companyName,
      tagline: settings.tagline || FALLBACK.tagline,
      ratingTagline: settings.ratingTagline || FALLBACK.ratingTagline,
      logoUrl: settings.logoUrl || FALLBACK.logoUrl,
      companyAddress: settings.companyAddress || FALLBACK.companyAddress,
      contactPhone: settings.contactPhone || FALLBACK.contactPhone,
      contactEmail: settings.contactEmail || FALLBACK.contactEmail,
      website: settings.website || FALLBACK.website,
      supportEmail: settings.supportEmail || FALLBACK.supportEmail,
      whatsappNumber: settings.whatsappNumber || FALLBACK.whatsappNumber,
    };
    cache.set(value);
    return value;
  } catch {
    return cache.getStale() ?? FALLBACK;
  }
}

/** Test-only: clear the cache between test cases. */
export function _resetCache() {
  cache.clear();
}

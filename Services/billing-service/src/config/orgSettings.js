// Replaces the old env-var-only branding.js. Company identity, contact info,
// quotation defaults, and bank details are now edited by admins through
// Management (PUT /api/v1/admin/settings on user-service) instead of
// per-deployment .env values. billing-service reads them here over a direct,
// token-authenticated service-to-service call — see
// Services/user-service/src/routes/admin.routes.js for the matching endpoint.
//
// The FALLBACK object below is what this file used to export as a static
// constant. It's kept as a resilience layer: quotation/invoice generation
// must not hard-fail just because user-service is briefly unreachable.

import { createTenantCache } from '../../../shared/tenancy/src/index.js';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 3_000;

const FALLBACK = {
  companyName: process.env.COMPANY_NAME || 'Travel CRM',
  companyShortName: process.env.COMPANY_SHORT_NAME || 'CRM',
  companyLegalName: process.env.COMPANY_LEGAL_NAME || 'Travel CRM Solutions',
  companyAddress: process.env.COMPANY_ADDRESS || '',
  companyGstNumber: process.env.COMPANY_GST_NUMBER || '',
  tagline: process.env.COMPANY_TAGLINE || 'Your Travel Partner',
  logoUrl: process.env.COMPANY_LOGO || '',

  contactEmail: process.env.COMPANY_EMAIL || 'info@example.com',
  salesEmail: process.env.SALES_EMAIL || 'sales@example.com',
  contactPhone: process.env.COMPANY_PHONE || '+1-800-000-0000',
  whatsappNumber: process.env.COMPANY_WHATSAPP || '',
  website: process.env.COMPANY_WEBSITE || 'https://www.example.com',

  themeInk: process.env.BRAND_INK || '#1F2937',
  themeMuted: process.env.BRAND_MUTED || '#64748B',
  themeAccent: process.env.BRAND_ACCENT || '#F5A623',
  themeAccentDark: process.env.BRAND_ACCENT_DARK || '#D98A0B',

  defaultCurrency: 'USD',
  defaultTaxRate: 0,
  defaultServiceChargeRate: 0,
  quotationValidityDays: 30,
  quotationTerms: process.env.QUOTATION_DEFAULT_TERMS ||
    'This is a quotation only; no reservation has been made at the time of this request. ' +
    'Rates are subject to availability and verification at the time of confirmed booking, and ' +
    'may be revised if package requirements change. Images are for representation only.',
  cancellationPolicy: process.env.QUOTATION_CANCELLATION_POLICY ||
    'Cancellation charges apply from the date we receive written notice. Booking amounts may be ' +
    'non-refundable once a package is confirmed. Rooms and flights are subject to availability.',
  invoicePaymentTerms: process.env.INVOICE_PAYMENT_TERMS ||
    'A non-refundable booking amount is required to confirm the package. The remaining balance ' +
    'must be cleared prior to the departure date. All bookings are subject to availability. ' +
    'Cancellation charges will be applicable as per the cancellation policy. No refund for unused ' +
    'services or no-show.',
  invoicePaymentInstructions: process.env.INVOICE_PAYMENT_INSTRUCTIONS ||
    'Please share the payment screenshot or UTR number after completing the transfer.',
  ratingTagline: process.env.QUOTATION_RATING_TAGLINE || 'Rated 4.9  |  10k+ Travellers  |  30+ Destinations',
  paymentMethods: ['Bank Transfer', 'UPI', 'Visa', 'Mastercard', 'Cards', 'Wallets'],
  docNumberPrefixes: null,

  bankName: process.env.BANK_NAME || '',
  bankAccountName: process.env.BANK_ACCOUNT_NAME || '',
  bankAccountNumber: process.env.BANK_ACCOUNT_NUMBER || '',
  bankIfscCode: process.env.BANK_IFSC_CODE || '',
  bankSwiftCode: process.env.BANK_SWIFT_CODE || '',
  bankBranch: process.env.BANK_BRANCH || '',
  bankAccountType: process.env.BANK_ACCOUNT_TYPE || 'Current Account',
  upiId: process.env.UPI_ID || '',
};

// Static marketing content — never became an env var or org setting in the
// original branding.js either; left as-is (see plan's out-of-scope note).
const STATIC_REVIEWS = [
  { name: 'A. Traveller', rating: 5, text: 'Excellent service — the whole trip was planned exactly as we wanted.' },
  { name: 'B. Explorer', rating: 5, text: 'Great value for money and the support team was available whenever we needed.' },
  { name: 'C. Wanderer', rating: 5, text: 'Well-planned itinerary and comfortable stays throughout. Highly recommended.' },
];

// Keyed by the requesting agency — a single shared slot would put the first
// agency's branding and bank details on every other agency's documents.
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
 * Org settings for quotation/invoice generation, cached for CACHE_TTL_MS.
 * Falls back to env-var defaults (identical to the pre-migration branding.js
 * literals) when user-service can't be reached and there's no usable cache.
 */
export async function getOrgSettings({ fetchImpl = fetch } = {}) {
  const cached = cache.get();
  if (cached) return cached;
  try {
    const settings = await fetchFromUserService(fetchImpl);
    cache.set(settings);
    return settings;
  } catch {
    return cache.getStale() ?? FALLBACK;
  }
}

/** Test-only: clear the cache between test cases. */
export function _resetCache() {
  cache.clear();
}

/** Reshapes the flat OrganizationSettings row into the nested structure the
 * PDF generator, email, and WhatsApp templates were already written against. */
export function toBrandingShape(settings) {
  const paymentMethods = settings.paymentMethods?.length ? settings.paymentMethods : FALLBACK.paymentMethods;
  return {
    company: {
      name: settings.companyName || FALLBACK.companyName,
      shortName: settings.companyShortName,
      tagline: settings.tagline,
      legalName: settings.companyLegalName,
      address: settings.companyAddress,
      gstNumber: settings.companyGstNumber,
    },
    contact: {
      email: settings.contactEmail,
      salesEmail: settings.salesEmail,
      phone: settings.contactPhone,
      whatsapp: settings.whatsappNumber,
    },
    urls: {
      website: settings.website,
      logo: settings.logoUrl,
    },
    theme: {
      ink: settings.themeInk || FALLBACK.themeInk,
      muted: settings.themeMuted || FALLBACK.themeMuted,
      brand: settings.themeAccent || FALLBACK.themeAccent,
      brandDark: settings.themeAccentDark || FALLBACK.themeAccentDark,
      slate50: '#F8FAFC',
      slate200: '#E2E8F0',
      cream: '#FDF3D8',
      white: '#FFFFFF',
      accents: ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'],
    },
    content: {
      ratingTagline: settings.ratingTagline || FALLBACK.ratingTagline,
      signatoryName: settings.companyName || FALLBACK.companyName,
      paymentMethods,
      reviews: STATIC_REVIEWS,
      defaultTerms: settings.quotationTerms || FALLBACK.quotationTerms,
      cancellationPolicy: settings.cancellationPolicy || FALLBACK.cancellationPolicy,
      invoiceTerms: settings.invoicePaymentTerms || FALLBACK.invoicePaymentTerms,
      invoicePaymentInstructions: settings.invoicePaymentInstructions || FALLBACK.invoicePaymentInstructions,
    },
    payment: {
      bankName: settings.bankName,
      accountName: settings.bankAccountName || settings.companyName || FALLBACK.companyName,
      accountNumber: settings.bankAccountNumber,
      ifscCode: settings.bankIfscCode,
      swiftCode: settings.bankSwiftCode,
      branch: settings.bankBranch,
      accountType: settings.bankAccountType,
      upiId: settings.upiId,
    },
  };
}

export const getBankDetails = (branding) => branding.payment;

/** True when at least a bank name + account number are configured. */
export const hasBankDetails = (branding) => Boolean(branding.payment.bankName && branding.payment.accountNumber);

/**
 * An invoice is a formal, customer-facing financial document — it must never
 * render blank/null fields where a real value belongs. Checks the fields the
 * invoice PDF's "Bill From" and "Payment Instructions" sections depend on and
 * reports every field that's still missing, so the caller can fail loud with
 * a specific, actionable error instead of generating an incomplete PDF.
 */
export const hasRequiredOrgFieldsForInvoice = (branding) => {
  const missing = [];
  if (!branding.company.name) missing.push('companyName');
  if (!branding.company.address) missing.push('companyAddress');
  if (!branding.contact.phone && !branding.contact.email) missing.push('contactPhone or contactEmail');
  if (!hasBankDetails(branding)) missing.push('bank details (bankName + bankAccountNumber)');
  return { ok: missing.length === 0, missing };
};

/**
 * A payment receipt confirms money already received — it renders company
 * identity and contact details but, unlike the invoice, no bank-transfer
 * instructions, so bank details aren't required here.
 */
export const hasRequiredOrgFieldsForReceipt = (branding) => {
  const missing = [];
  if (!branding.company.name) missing.push('companyName');
  if (!branding.company.address) missing.push('companyAddress');
  if (!branding.contact.phone && !branding.contact.email) missing.push('contactPhone or contactEmail');
  return { ok: missing.length === 0, missing };
};

/**
 * A voucher is a booking confirmation document, not a financial one — it
 * renders company identity and contact details but, unlike the invoice, no
 * bank-transfer instructions, so bank details aren't required here (same
 * requirement set as the payment receipt).
 */
export const hasRequiredOrgFieldsForVoucher = (branding) => {
  const missing = [];
  if (!branding.company.name) missing.push('companyName');
  if (!branding.company.address) missing.push('companyAddress');
  if (!branding.contact.phone && !branding.contact.email) missing.push('contactPhone or contactEmail');
  return { ok: missing.length === 0, missing };
};

export const getEmailFrom = (branding) =>
  process.env.EMAIL_FROM || `${branding.company.name} <${branding.contact.email}>`;

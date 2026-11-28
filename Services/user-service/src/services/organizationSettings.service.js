import prisma from '../db/client.js';

// Single row, enforced here rather than at the DB level — same convention as
// lead-service's Settings model. Column @default()s on the Prisma model cover
// the fields that previously had hardcoded literal defaults in billing-service's
// and Management's branding.js (company name, currency, theme colors, validity
// window), so a freshly-seeded row behaves identically to the pre-migration
// env-var-driven config until an admin actually edits something.
export async function getOrCreateSingleton() {
  const existing = await prisma.organizationSettings.findFirst();
  if (existing) return existing;
  return prisma.organizationSettings.create({ data: {} });
}

const EDITABLE_FIELDS = [
  'companyName', 'companyShortName', 'companyLegalName', 'companyAddress', 'companyGstNumber', 'tagline', 'logoUrl',
  'contactEmail', 'salesEmail', 'supportEmail', 'contactPhone', 'whatsappNumber', 'website',
  'themeInk', 'themeMuted', 'themeAccent', 'themeAccentDark',
  'defaultCurrency', 'defaultTaxRate', 'defaultServiceChargeRate', 'quotationValidityDays',
  'quotationTerms', 'cancellationPolicy', 'invoicePaymentTerms', 'invoicePaymentInstructions',
  'ratingTagline', 'paymentMethods', 'docNumberPrefixes', 'pricingDefaults',
  'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfscCode', 'bankSwiftCode',
  'bankBranch', 'bankAccountType', 'upiId',
];

export async function updateSingleton(data, updatedById) {
  const singleton = await getOrCreateSingleton();
  const update = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) update[field] = data[field];
  }
  update.updatedById = updatedById ?? null;
  return prisma.organizationSettings.update({ where: { id: singleton.id }, data: update });
}

import prisma from '../db/client.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// One row per agency (unique on tenantId). A new agency starts with its own name,
// never the column default, so its first documents don't carry another company's name.
export async function getOrCreateSingleton() {
  const existing = await prisma.organizationSettings.findFirst();
  if (existing) return existing;
  const tenant = await prisma.tenant.findUnique({ where: { id: requireTenantId() }, select: { name: true } });
  try {
    return await prisma.organizationSettings.create({ data: tenant?.name ? { companyName: tenant.name } : {} });
  } catch (err) {
    // Two first requests raced; the other one created the row.
    if (err?.code !== 'P2002') throw err;
    return prisma.organizationSettings.findFirst();
  }
}

const EDITABLE_FIELDS = [
  'companyName', 'companyShortName', 'companyLegalName', 'companyAddress', 'companyGstNumber', 'tagline', 'logoUrl',
  'contactEmail', 'salesEmail', 'supportEmail', 'contactPhone', 'whatsappNumber', 'website',
  'themeInk', 'themeMuted', 'themeAccent', 'themeAccentDark',
  'defaultCurrency', 'defaultTaxRate', 'defaultServiceChargeRate', 'quotationValidityDays',
  'quotationTerms', 'cancellationPolicy', 'invoicePaymentTerms', 'invoicePaymentInstructions',
  'ratingTagline', 'paymentMethods', 'docNumberPrefixes',
  'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfscCode', 'bankSwiftCode',
  'bankBranch', 'bankAccountType', 'upiId',
];

export const BANK_FIELDS = [
  'bankName', 'bankAccountName', 'bankAccountNumber', 'bankIfscCode', 'bankSwiftCode', 'bankBranch', 'bankAccountType', 'upiId',
];

// Prisma Decimals serialise to their string value, so equal amounts compare equal.
const comparable = (v) => JSON.stringify(v ?? null);

/** Names of the editable fields whose value differs between two settings rows. */
export function changedSettingsFields(before = {}, after = {}) {
  return EDITABLE_FIELDS.filter((f) => comparable(before[f]) !== comparable(after[f]));
}

export async function updateSingleton(data, updatedById) {
  const singleton = await getOrCreateSingleton();
  const update = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) update[field] = data[field];
  }
  update.updatedById = updatedById ?? null;
  return prisma.organizationSettings.update({ where: { id: singleton.id }, data: update });
}

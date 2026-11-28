import { z } from 'zod';

// Prisma Decimal columns (defaultTaxRate, defaultServiceChargeRate) serialize
// to JSON as strings — coerce like moneyField in money.js.
const percentField = z.coerce.number().min(0).max(100).nullable().optional();

const docNumberPrefixesShape = {
  quotation: z.string().max(10).optional(),
  invoice: z.string().max(10).optional(),
  receipt: z.string().max(10).optional(),
  payment: z.string().max(10).optional(),
  creditNote: z.string().max(10).optional(),
  voucher: z.string().max(10).optional(),
};

const price = z.coerce.number().min(0).max(1_000_000);

export const TRANSPORT_RATE_MODES = ['CAR', 'VAN', 'BUS', 'TRAIN', 'BOAT'];

// Starting costs for package/lead pricing; every one is still editable per day or per package.
export const PricingDefaults = z
  .object({
    mealPrices: z.object({ breakfast: price, lunch: price, dinner: price }).strict(),
    // Both values are kept, so switching the type never turns 20% into $20.
    margin: z.object({
      type: z.enum(['PERCENTAGE', 'FIXED']),
      percentage: z.coerce.number().min(0).max(1000),
      fixed: price,
    }).strict(),
    // One rate per pricing model; `pricingModel` is the one a new row starts with.
    transportRates: z.object(Object.fromEntries(TRANSPORT_RATE_MODES.map((mode) => [
      mode,
      z.object({
        pricingModel: z.enum(['PER_VEHICLE', 'PER_KM', 'PER_PERSON']),
        PER_VEHICLE: price.optional(),
        PER_KM: price.optional(),
        PER_PERSON: price.optional(),
        // Passengers one vehicle carries; a bigger group is charged for more vehicles.
        seats: z.coerce.number().int().min(1).max(500).optional(),
      }).strict(),
    ]))).partial().strict(),
    // Travellers sharing one room when a lead's rooms are counted.
    peoplePerRoom: z.coerce.number().int().min(1).max(10),
  })
  .partial()
  .strict();

// Full singleton row as returned by GET /admin/settings and the internal
// user-service → billing-service endpoint. .passthrough() so id/createdAt/
// updatedAt/updatedById don't need to be re-declared field-by-field here.
export const OrganizationSettings = z
  .object({
    companyName: z.string(),
    companyShortName: z.string().nullable().optional(),
    companyLegalName: z.string().nullable().optional(),
    companyAddress: z.string().nullable().optional(),
    companyGstNumber: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),

    contactEmail: z.string().nullable().optional(),
    salesEmail: z.string().nullable().optional(),
    supportEmail: z.string().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    whatsappNumber: z.string().nullable().optional(),
    website: z.string().nullable().optional(),

    themeInk: z.string().nullable().optional(),
    themeMuted: z.string().nullable().optional(),
    themeAccent: z.string().nullable().optional(),
    themeAccentDark: z.string().nullable().optional(),

    defaultCurrency: z.string().length(3),
    defaultTaxRate: percentField,
    defaultServiceChargeRate: percentField,
    quotationValidityDays: z.coerce.number().int().positive(),
    quotationTerms: z.string().nullable().optional(),
    cancellationPolicy: z.string().nullable().optional(),
    invoicePaymentTerms: z.string().nullable().optional(),
    invoicePaymentInstructions: z.string().nullable().optional(),
    ratingTagline: z.string().nullable().optional(),
    paymentMethods: z.array(z.string()).optional(),
    docNumberPrefixes: z.object(docNumberPrefixesShape).partial().nullable().optional(),

    bankName: z.string().nullable().optional(),
    bankAccountName: z.string().nullable().optional(),
    bankAccountNumber: z.string().nullable().optional(),
    bankIfscCode: z.string().nullable().optional(),
    bankSwiftCode: z.string().nullable().optional(),
    bankBranch: z.string().nullable().optional(),
    bankAccountType: z.string().nullable().optional(),
    upiId: z.string().nullable().optional(),
  })
  .passthrough();

// PUT /admin/settings payload — every field optional (partial update), and
// strict (no .passthrough()): unknown keys are rejected outright rather than
// silently ignored, per the project's whitelist-validation convention.
export const OrganizationSettingsUpdate = z
  .object({
    companyName: z.string().min(1).optional(),
    companyShortName: z.string().nullable().optional(),
    companyLegalName: z.string().nullable().optional(),
    companyAddress: z.string().nullable().optional(),
    companyGstNumber: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),

    contactEmail: z.string().email().nullable().optional(),
    salesEmail: z.string().email().nullable().optional(),
    supportEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().nullable().optional(),
    whatsappNumber: z.string().nullable().optional(),
    website: z.string().nullable().optional(),

    themeInk: z.string().nullable().optional(),
    themeMuted: z.string().nullable().optional(),
    themeAccent: z.string().nullable().optional(),
    themeAccentDark: z.string().nullable().optional(),

    defaultCurrency: z.string().length(3).optional(),
    defaultTaxRate: percentField,
    defaultServiceChargeRate: percentField,
    quotationValidityDays: z.coerce.number().int().positive().optional(),
    quotationTerms: z.string().nullable().optional(),
    cancellationPolicy: z.string().nullable().optional(),
    invoicePaymentTerms: z.string().nullable().optional(),
    invoicePaymentInstructions: z.string().nullable().optional(),
    ratingTagline: z.string().nullable().optional(),
    paymentMethods: z.array(z.string()).optional(),
    docNumberPrefixes: z.object(docNumberPrefixesShape).partial().nullable().optional(),
    pricingDefaults: PricingDefaults.nullable().optional(),

    bankName: z.string().nullable().optional(),
    bankAccountName: z.string().nullable().optional(),
    bankAccountNumber: z.string().nullable().optional(),
    bankIfscCode: z.string().nullable().optional(),
    bankSwiftCode: z.string().nullable().optional(),
    bankBranch: z.string().nullable().optional(),
    bankAccountType: z.string().nullable().optional(),
    upiId: z.string().nullable().optional(),
  })
  .strict();

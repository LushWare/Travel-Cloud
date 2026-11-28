import { describe, it, expect } from 'vitest';
import { OrganizationSettings, OrganizationSettingsUpdate } from '../src/organizationSettings.js';

function settingsRow(overrides = {}) {
  return {
    id: 'org-settings-1',
    companyName: 'Travel CRM',
    defaultCurrency: 'USD',
    defaultTaxRate: '5.00',
    defaultServiceChargeRate: '2.50',
    quotationValidityDays: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('OrganizationSettings', () => {
  it('parses a full singleton row with Decimal fields serialized as strings', () => {
    const parsed = OrganizationSettings.parse(settingsRow());
    expect(parsed.defaultTaxRate).toBe(5);
    expect(parsed.defaultServiceChargeRate).toBe(2.5);
  });

  it('passes through id/timestamps not explicitly modeled', () => {
    const parsed = OrganizationSettings.parse(settingsRow());
    expect(parsed.id).toBe('org-settings-1');
  });

  it('rejects a currency code that is not exactly 3 characters', () => {
    expect(() => OrganizationSettings.parse(settingsRow({ defaultCurrency: 'US' }))).toThrow();
  });

  it('rejects a tax rate above 100', () => {
    expect(() => OrganizationSettings.parse(settingsRow({ defaultTaxRate: '150.00' }))).toThrow();
  });

  it('rejects a negative service charge rate', () => {
    expect(() =>
      OrganizationSettings.parse(settingsRow({ defaultServiceChargeRate: '-1.00' }))
    ).toThrow();
  });

  it('rejects a non-positive quotation validity window', () => {
    expect(() => OrganizationSettings.parse(settingsRow({ quotationValidityDays: 0 }))).toThrow();
  });

  it('parses the new company address/GST and invoice terms/instructions fields', () => {
    const parsed = OrganizationSettings.parse(settingsRow({
      companyAddress: '221B Baker Street, London',
      companyGstNumber: '07BGTPT9665E1ZH',
      invoicePaymentTerms: 'Balance due within 30 days.',
      invoicePaymentInstructions: 'Please share the UTR after payment.',
    }));
    expect(parsed.companyAddress).toBe('221B Baker Street, London');
    expect(parsed.companyGstNumber).toBe('07BGTPT9665E1ZH');
    expect(parsed.invoicePaymentTerms).toBe('Balance due within 30 days.');
    expect(parsed.invoicePaymentInstructions).toBe('Please share the UTR after payment.');
  });

  it('tolerates the new fields being absent (nullable/optional)', () => {
    expect(() => OrganizationSettings.parse(settingsRow())).not.toThrow();
  });
});

describe('OrganizationSettingsUpdate', () => {
  it('accepts a partial update payload with a single field', () => {
    expect(() => OrganizationSettingsUpdate.parse({ companyName: 'Lush Travel' })).not.toThrow();
  });

  it('accepts an empty payload (no-op update)', () => {
    expect(() => OrganizationSettingsUpdate.parse({})).not.toThrow();
  });

  it('rejects unknown keys (whitelist validation)', () => {
    expect(() => OrganizationSettingsUpdate.parse({ notARealField: true })).toThrow();
  });

  it('rejects an invalid contact email', () => {
    expect(() =>
      OrganizationSettingsUpdate.parse({ contactEmail: 'not-an-email' })
    ).toThrow();
  });

  it('accepts a partial docNumberPrefixes object', () => {
    const parsed = OrganizationSettingsUpdate.parse({
      docNumberPrefixes: { quotation: 'QUO' },
    });
    expect(parsed.docNumberPrefixes.quotation).toBe('QUO');
  });

  it('rejects a companyName that is an empty string', () => {
    expect(() => OrganizationSettingsUpdate.parse({ companyName: '' })).toThrow();
  });

  it('accepts the new company address/GST and invoice terms/instructions fields', () => {
    const parsed = OrganizationSettingsUpdate.parse({
      companyAddress: '221B Baker Street, London',
      companyGstNumber: '07BGTPT9665E1ZH',
      invoicePaymentTerms: 'Balance due within 30 days.',
      invoicePaymentInstructions: 'Please share the UTR after payment.',
    });
    expect(parsed.companyGstNumber).toBe('07BGTPT9665E1ZH');
  });

  it('accepts pricing defaults with meal prices, both margin values and transport rates', () => {
    const parsed = OrganizationSettingsUpdate.parse({
      pricingDefaults: {
        mealPrices: { breakfast: 8, lunch: 15, dinner: 20 },
        margin: { type: 'FIXED', percentage: 20, fixed: 100 },
        transportRates: { CAR: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 50, PER_KM: 0.6 } },
      },
    });
    expect(parsed.pricingDefaults.margin).toEqual({ type: 'FIXED', percentage: 20, fixed: 100 });
  });

  it('accepts seats per vehicle and people per room', () => {
    const parsed = OrganizationSettingsUpdate.parse({
      pricingDefaults: { transportRates: { CAR: { pricingModel: 'PER_VEHICLE', seats: 4 } }, peoplePerRoom: 3 },
    });
    expect(parsed.pricingDefaults).toMatchObject({ transportRates: { CAR: { seats: 4 } }, peoplePerRoom: 3 });
  });

  it('rejects a vehicle with zero seats', () => {
    expect(() => OrganizationSettingsUpdate.parse({
      pricingDefaults: { transportRates: { CAR: { pricingModel: 'PER_VEHICLE', seats: 0 } } },
    })).toThrow();
  });

  it('rejects a percentage margin above 1000', () => {
    expect(() => OrganizationSettingsUpdate.parse({
      pricingDefaults: { margin: { type: 'PERCENTAGE', percentage: 1001, fixed: 0 } },
    })).toThrow();
  });

  it('rejects a negative meal price', () => {
    expect(() => OrganizationSettingsUpdate.parse({
      pricingDefaults: { mealPrices: { breakfast: -1, lunch: 15, dinner: 20 } },
    })).toThrow();
  });

  it('rejects a transport rate for a mode without a default rate', () => {
    expect(() => OrganizationSettingsUpdate.parse({
      pricingDefaults: { transportRates: { FLIGHT: { pricingModel: 'PER_PERSON', PER_PERSON: 300 } } },
    })).toThrow();
  });

  it('accepts an explicit null to clear the new nullable fields', () => {
    const parsed = OrganizationSettingsUpdate.parse({ companyAddress: null, invoicePaymentTerms: null });
    expect(parsed.companyAddress).toBeNull();
    expect(parsed.invoicePaymentTerms).toBeNull();
  });
});

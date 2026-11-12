import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';
import { getOrgSettings, _resetCache, toBrandingShape, getBankDetails, hasBankDetails, hasRequiredOrgFieldsForInvoice, hasRequiredOrgFieldsForVoucher } from '../orgSettings.js';

const ACME = '00000000-0000-4000-8000-000000000002';
const GLOBE = '00000000-0000-4000-8000-000000000003';

const COMPLETE_SETTINGS = {
  companyName: 'Lush Travel',
  companyAddress: '221B Baker Street, London',
  companyGstNumber: '07BGTPT9665E1ZH',
  contactPhone: '+44 20 0000 0000',
  contactEmail: 'hi@lush.test',
  bankName: 'Test Bank',
  bankAccountNumber: '12345',
  invoicePaymentTerms: 'Balance due within 30 days.',
  invoicePaymentInstructions: 'Please share the UTR after payment.',
};

function fakeSettingsResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: { settings: { companyName: 'Lush Travel', defaultCurrency: 'USD', ...overrides } },
    }),
  };
}

beforeEach(() => {
  _resetCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getOrgSettings', () => {
  it('fetches from user-service and returns the settings row', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Lush Travel');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value on a second call within the TTL, without refetching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never serves one agency's cached settings to another agency", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeSettingsResponse({ companyName: 'Acme Tours', bankAccountNumber: 'ACME-1' }))
      .mockResolvedValueOnce(fakeSettingsResponse({ companyName: 'Globe DMC', bankAccountNumber: 'GLOBE-1' }));

    const acme = await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    const globe = await runWithTenant(GLOBE, () => getOrgSettings({ fetchImpl }));

    expect(acme.bankAccountNumber).toBe('ACME-1');
    expect(globe.bankAccountNumber).toBe('GLOBE-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refetches once the cache TTL has expired', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    vi.advanceTimersByTime(61_000);
    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to env-var defaults without throwing when the fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Travel CRM');
    expect(settings.defaultCurrency).toBe('USD');
    expect(settings.quotationValidityDays).toBe(30);
  });

  it('falls back without throwing when user-service responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Travel CRM');
  });

  it('serves the last good cached value (not the static fallback) when a later refetch fails', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeSettingsResponse({ companyName: 'Lush Travel' }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    vi.advanceTimersByTime(61_000);
    const settings = await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    expect(settings.companyName).toBe('Lush Travel');
  });

  it("serves the static fallback, not another agency's stale value, when an agency's own fetch fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(fakeSettingsResponse({ companyName: 'Acme Tours', bankAccountNumber: 'ACME-1' }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await runWithTenant(ACME, () => getOrgSettings({ fetchImpl }));
    const globe = await runWithTenant(GLOBE, () => getOrgSettings({ fetchImpl }));

    expect(globe.companyName).toBe('Travel CRM');
    expect(globe.bankAccountNumber).not.toBe('ACME-1');
  });
});

describe('toBrandingShape', () => {
  it('maps flat OrganizationSettings fields onto the nested branding structure', () => {
    const branding = toBrandingShape({
      companyName: 'Lush Travel',
      tagline: 'Explore More',
      contactEmail: 'hi@lush.test',
      contactPhone: '+1-555-0100',
      website: 'https://lush.test',
      logoUrl: 'https://cdn.lush.test/logo.png',
    });
    expect(branding.company.name).toBe('Lush Travel');
    expect(branding.company.tagline).toBe('Explore More');
    expect(branding.contact.email).toBe('hi@lush.test');
    expect(branding.urls.logo).toBe('https://cdn.lush.test/logo.png');
  });

  it('falls back to the default payment methods list when none are configured', () => {
    const branding = toBrandingShape({ companyName: 'Lush Travel', paymentMethods: [] });
    expect(branding.content.paymentMethods).toContain('Bank Transfer');
  });

  it('uses the configured payment methods list when present', () => {
    const branding = toBrandingShape({ companyName: 'Lush Travel', paymentMethods: ['Cash'] });
    expect(branding.content.paymentMethods).toEqual(['Cash']);
  });
});

describe('hasBankDetails', () => {
  it('is true when both bank name and account number are configured', () => {
    const branding = toBrandingShape({ companyName: 'X', bankName: 'Test Bank', bankAccountNumber: '12345' });
    expect(hasBankDetails(branding)).toBe(true);
    expect(getBankDetails(branding).bankName).toBe('Test Bank');
  });

  it('is false when bank details are absent', () => {
    const branding = toBrandingShape({ companyName: 'X' });
    expect(hasBankDetails(branding)).toBe(false);
  });
});

describe('toBrandingShape — invoice fields (companyAddress/companyGstNumber/invoiceTerms)', () => {
  it('maps the new company address/GST fields onto branding.company', () => {
    const branding = toBrandingShape(COMPLETE_SETTINGS);
    expect(branding.company.address).toBe('221B Baker Street, London');
    expect(branding.company.gstNumber).toBe('07BGTPT9665E1ZH');
  });

  it('maps invoicePaymentTerms/invoicePaymentInstructions onto branding.content', () => {
    const branding = toBrandingShape(COMPLETE_SETTINGS);
    expect(branding.content.invoiceTerms).toBe('Balance due within 30 days.');
    expect(branding.content.invoicePaymentInstructions).toBe('Please share the UTR after payment.');
  });

  it('falls back to the built-in default invoice terms when unset', () => {
    const branding = toBrandingShape({ companyName: 'X' });
    expect(branding.content.invoiceTerms).toMatch(/non-refundable booking amount/i);
    expect(branding.content.invoicePaymentInstructions).toMatch(/payment screenshot/i);
  });
});

describe('hasRequiredOrgFieldsForInvoice', () => {
  it('is ok with no missing fields when every required field is configured', () => {
    const branding = toBrandingShape(COMPLETE_SETTINGS);
    const result = hasRequiredOrgFieldsForInvoice(branding);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it('reports companyAddress as missing when unset', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, companyAddress: undefined });
    const result = hasRequiredOrgFieldsForInvoice(branding);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('companyAddress');
  });

  it('reports bank details as missing when bank name/account number are unset', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, bankName: undefined, bankAccountNumber: undefined });
    const result = hasRequiredOrgFieldsForInvoice(branding);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes('bank details'))).toBe(true);
  });

  it('is still ok when only contactPhone is set and contactEmail is missing (either satisfies the check)', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, contactEmail: undefined });
    expect(hasRequiredOrgFieldsForInvoice(branding).ok).toBe(true);
  });

  it('reports contact info as missing only when both phone and email are unset', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, contactPhone: undefined, contactEmail: undefined });
    const result = hasRequiredOrgFieldsForInvoice(branding);
    expect(result.missing).toContain('contactPhone or contactEmail');
  });

  it('reports every missing field at once for a bare-minimum settings row', () => {
    const branding = toBrandingShape({ companyName: 'X' });
    const result = hasRequiredOrgFieldsForInvoice(branding);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(['companyAddress', 'contactPhone or contactEmail', 'bank details (bankName + bankAccountNumber)']),
    );
  });
});

describe('hasRequiredOrgFieldsForVoucher', () => {
  it('is ok with no missing fields when every required field is configured', () => {
    const branding = toBrandingShape(COMPLETE_SETTINGS);
    expect(hasRequiredOrgFieldsForVoucher(branding)).toEqual({ ok: true, missing: [] });
  });

  it('reports companyAddress as missing when unset', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, companyAddress: undefined });
    const result = hasRequiredOrgFieldsForVoucher(branding);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('companyAddress');
  });

  it('does not require bank details (a voucher is not a financial document, unlike an invoice)', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, bankName: undefined, bankAccountNumber: undefined });
    expect(hasRequiredOrgFieldsForVoucher(branding).ok).toBe(true);
  });

  it('reports contact info as missing only when both phone and email are unset', () => {
    const branding = toBrandingShape({ ...COMPLETE_SETTINGS, contactPhone: undefined, contactEmail: undefined });
    const result = hasRequiredOrgFieldsForVoucher(branding);
    expect(result.missing).toContain('contactPhone or contactEmail');
  });
});

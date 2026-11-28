import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrgSettings, getPricingDefaults, _resetCache } from '../orgSettings.js';

function fakeSettingsResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      status: 'success',
      data: { settings: { companyName: 'Lush Travel', ratingTagline: 'Rated 5.0  |  Somewhere', ...overrides } },
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
  it('fetches from user-service and returns companyName/ratingTagline', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Lush Travel');
    expect(settings.ratingTagline).toBe('Rated 5.0  |  Somewhere');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches and returns the branding fields the PDF letterhead needs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse({
      tagline: 'Your Journey, Our Passion',
      logoUrl: 'https://cdn.example.com/logo.png',
      companyAddress: '123 Ocean Drive, Malé, Maldives',
      contactPhone: '+960 555 0100',
      contactEmail: 'info@lushtravel.example',
      website: 'https://www.lushtravel.example',
      supportEmail: 'support@lushtravel.example',
      whatsappNumber: '+960 555 0200',
    }));
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.tagline).toBe('Your Journey, Our Passion');
    expect(settings.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(settings.companyAddress).toBe('123 Ocean Drive, Malé, Maldives');
    expect(settings.contactPhone).toBe('+960 555 0100');
    expect(settings.contactEmail).toBe('info@lushtravel.example');
    expect(settings.website).toBe('https://www.lushtravel.example');
    expect(settings.supportEmail).toBe('support@lushtravel.example');
    expect(settings.whatsappNumber).toBe('+960 555 0200');
  });

  it('falls back to static defaults for branding fields the response omits', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.tagline).toBe('Your Travel Partner');
    expect(settings.logoUrl).toBe('');
    expect(settings.companyAddress).toBe('');
    expect(settings.contactPhone).toBe('');
    expect(settings.contactEmail).toBe('');
    expect(settings.website).toBe('');
    expect(settings.supportEmail).toBe('');
    expect(settings.whatsappNumber).toBe('');
  });

  it('serves the cached value on a second call within the TTL, without refetching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    await getOrgSettings({ fetchImpl });
    await getOrgSettings({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache TTL has expired', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse());
    await getOrgSettings({ fetchImpl });
    vi.advanceTimersByTime(61_000);
    await getOrgSettings({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to static defaults without throwing when the fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Travel CRM');
    expect(settings.ratingTagline).toMatch(/Rated/);
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
    await getOrgSettings({ fetchImpl });
    vi.advanceTimersByTime(61_000);
    const settings = await getOrgSettings({ fetchImpl });
    expect(settings.companyName).toBe('Lush Travel');
  });
});

describe('getPricingDefaults', () => {
  it('returns the saved pricing defaults', async () => {
    const pricingDefaults = { mealPrices: { breakfast: 8, lunch: 15, dinner: 20 } };
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse({ pricingDefaults }));
    expect(await getPricingDefaults({ fetchImpl })).toEqual(pricingDefaults);
  });

  it('refuses to price with made-up numbers when user-service is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    await expect(getPricingDefaults({ fetchImpl })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('returns empty defaults when the agency has saved none', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeSettingsResponse({ pricingDefaults: null }));
    expect(await getPricingDefaults({ fetchImpl })).toEqual({});
  });

  it('fails a fresh read when user-service is unreachable so a reprice never uses stale prices', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    await expect(getPricingDefaults({ fetchImpl, fresh: true })).rejects.toMatchObject({ statusCode: 503 });
  });
});

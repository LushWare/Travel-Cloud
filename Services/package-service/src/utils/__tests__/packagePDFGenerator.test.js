import { describe, it, expect, vi, afterEach } from 'vitest';
import zlib from 'node:zlib';
import { generatePackagePDF } from '../packagePDFGenerator.js';
import { getOrgSettings } from '../../config/orgSettings.js';

// Avoids a real network call to user-service during unit tests.
vi.mock('../../config/orgSettings.js', async () => {
  const actual = await vi.importActual('../../config/orgSettings.js');
  return {
    ...actual,
    getOrgSettings: vi.fn().mockResolvedValue({
      companyName: 'Travel CRM',
      tagline: 'Your Travel Partner',
      ratingTagline: 'Rated 4.9  |  10k+ Travellers  |  30+ Destinations',
      logoUrl: '',
      companyAddress: '',
      contactPhone: '',
      contactEmail: '',
      website: '',
    }),
  };
});

const BASE_ORG_SETTINGS = {
  companyName: 'Travel CRM',
  tagline: 'Your Travel Partner',
  ratingTagline: 'Rated 4.9  |  10k+ Travellers  |  30+ Destinations',
  logoUrl: '',
  companyAddress: '',
  contactPhone: '',
  contactEmail: '',
  website: '',
};

/**
 * Build a real, minimal, decodable 1x1 PNG at test time (rather than trust a
 * hand-typed base64 constant) so doc.image() actually succeeds during tests
 * — a corrupt/undecodable buffer gets silently swallowed by the generator's
 * own try/catch, defeating the point of asserting an image was genuinely
 * embedded.
 */
function makeTinyPngBuffer() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc32 = (buf) => {
    let crc = ~0;
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return ~crc >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  const raw = Buffer.from([0, 255, 0, 0]); // filter byte + 1 RGB pixel
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mockFetchResolvingImage = () => {
  const pngBuffer = makeTinyPngBuffer();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
    }),
  );
};

/** Count page objects in the PDF (`/Type /Page` but not the `/Pages` tree). */
const countPages = (buffer) => {
  const s = buffer.toString('latin1');
  return (s.match(/\/Type\s*\/Page(?![s])/g) || []).length;
};

const makeDay = (n, overrides = {}) => ({
  id: `day-${n}`,
  dayNumber: n,
  title: `Day ${n} Title`,
  description: null,
  breakfastCount: 0,
  lunchCount: 0,
  dinnerCount: 0,
  places: [],
  activities: [],
  transports: [],
  ...overrides,
});

const makeRichDay = (n) =>
  makeDay(n, {
    description: 'A full day exploring the region with a private guide.',
    breakfastCount: 1,
    lunchCount: 1,
    dinnerCount: 0,
    places: [{ place: { name: 'Old Town' }, customName: null }, { place: null, customName: 'Hidden Beach' }],
    activities: [
      { activity: { name: 'City Tour', description: 'A guided walking tour of the old town.' } },
      { activity: { name: 'Sunset Cruise', description: null } },
    ],
    transports: [{ transportMode: 'PRIVATE_CAR', pricingModel: 'PER_VEHICLE' }],
  });

const makeDays = (n) => Array.from({ length: n }, (_, i) => makeDay(i + 1));

const basePackage = {
  id: 'pkg-1',
  title: 'Coco Bodu Hithi Honeymoon Escape',
  description: 'An unforgettable overwater-villa honeymoon package in the Maldives.',
  destination: 'Maldives',
  durationDays: 6,
  category: 'HONEYMOON',
  coverImage: null,
  inclusions: ['Breakfast daily', 'Airport transfers'],
  exclusions: ['International airfare'],
  termsAndConditions: 'Rates are subject to availability at the time of confirmed booking.',
  basePrice: 1899,
  currency: 'USD',
  itineraryDays: [],
};

describe('generatePackagePDF', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getOrgSettings).mockResolvedValue(BASE_ORG_SETTINGS);
  });

  it('returns a PDF Buffer with a valid %PDF header', async () => {
    const buffer = await generatePackagePDF(basePackage);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('produces at least one page for a minimal package', async () => {
    const buffer = await generatePackagePDF({
      id: 'pkg-min',
      title: 'Bare Package',
      itineraryDays: [],
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(buffer)).toBeGreaterThanOrEqual(1);
  });

  it('grows the page count as itinerary content grows', async () => {
    const few = await generatePackagePDF({ ...basePackage, itineraryDays: makeDays(1) });
    const many = await generatePackagePDF({ ...basePackage, itineraryDays: makeDays(20) });
    expect(countPages(many)).toBeGreaterThan(countPages(few));
  });

  it('degrades gracefully when every optional field is absent', async () => {
    const buffer = await generatePackagePDF({
      id: 'pkg-empty',
      title: 'Minimal Package',
      description: null,
      destination: null,
      durationDays: null,
      category: null,
      coverImage: null,
      inclusions: [],
      exclusions: [],
      termsAndConditions: null,
      basePrice: 0,
      currency: 'USD',
      itineraryDays: [],
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(buffer)).toBeGreaterThanOrEqual(1);
  });

  it('renders a longer cover when destination is present vs. absent', async () => {
    const withDest = await generatePackagePDF({ ...basePackage, destination: 'Maldives' });
    const withoutDest = await generatePackagePDF({ ...basePackage, destination: null });
    expect(withDest.length).not.toBe(withoutDest.length);
  });

  it('grows the buffer when inclusions/exclusions are populated vs. empty', async () => {
    const empty = await generatePackagePDF({ ...basePackage, inclusions: [], exclusions: [] });
    const populated = await generatePackagePDF({
      ...basePackage,
      inclusions: ['Breakfast', 'Airport transfers', 'Welcome drink', 'Daily housekeeping'],
      exclusions: ['Airfare', 'Travel insurance', 'Personal expenses'],
    });
    expect(populated.length).toBeGreaterThan(empty.length);
  });

  it('grows the buffer when a day carries places/activities/transport/meals vs. a bare day', async () => {
    const bare = await generatePackagePDF({ ...basePackage, itineraryDays: [makeDay(1)] });
    const rich = await generatePackagePDF({ ...basePackage, itineraryDays: [makeRichDay(1)] });
    expect(rich.length).toBeGreaterThan(bare.length);
  });

  it('renders without throwing across different category enum values', async () => {
    const safari = await generatePackagePDF({ ...basePackage, category: 'WILD_SAFARI' });
    const honeymoon = await generatePackagePDF({ ...basePackage, category: 'HONEYMOON' });
    expect(safari.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(honeymoon.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('omits the price row when the package has no price', async () => {
    const priced = await generatePackagePDF({ ...basePackage, basePrice: 1899 });
    const unpriced = await generatePackagePDF({ ...basePackage, basePrice: 0 });
    expect(priced.length).not.toBe(unpriced.length);
  });

  it('prints the selling price, not the cost', async () => {
    // A stored selling price prints even when the cost field is empty.
    const withSellPrice = await generatePackagePDF({ ...basePackage, basePrice: 0, sellPrice: 2279 });
    const unpriced = await generatePackagePDF({ ...basePackage, basePrice: 0, sellPrice: 0 });
    expect(withSellPrice.length).not.toBe(unpriced.length);
  });

  it('renders a cover image fetched from a remote https URL instead of the banner fallback', async () => {
    mockFetchResolvingImage();
    const withCover = await generatePackagePDF({ ...basePackage, coverImage: 'https://images.example.com/cover.jpg' });
    const withoutCover = await generatePackagePDF({ ...basePackage, coverImage: null });
    expect(withCover.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(withCover.length).not.toBe(withoutCover.length);
  });

  it('falls back to the banner cover instead of crashing when the remote image fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const buffer = await generatePackagePDF({ ...basePackage, coverImage: 'https://images.example.com/cover.jpg' });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('falls back to the banner cover when the remote fetch resolves but is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const buffer = await generatePackagePDF({ ...basePackage, coverImage: 'https://images.example.com/missing.jpg' });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('falls back to the banner cover when coverImage is missing entirely', async () => {
    const buffer = await generatePackagePDF({ ...basePackage, coverImage: null });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a different footer when org settings differ', async () => {
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      ratingTagline: 'Short tagline',
    });
    const short = await generatePackagePDF(basePackage);
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      companyName: 'A Much Longer Configured Company Name Ltd',
      ratingTagline: 'A meaningfully longer, differently worded rating tagline',
    });
    const long = await generatePackagePDF(basePackage);
    expect(short.length).not.toBe(long.length);
  });

  it('renders a different header and footer when the configured company name changes', async () => {
    vi.mocked(getOrgSettings).mockResolvedValueOnce({ ...BASE_ORG_SETTINGS, companyName: 'Travel CRM' });
    const withShortName = await generatePackagePDF({ ...basePackage, itineraryDays: makeDays(2) });
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      companyName: 'A Much Longer Configured Travel Company Name Pvt Ltd',
    });
    const withLongName = await generatePackagePDF({ ...basePackage, itineraryDays: makeDays(2) });
    expect(withShortName.length).not.toBe(withLongName.length);
  });

  it('renders a larger page-1 letterhead when address/phone/email/website are configured', async () => {
    const bare = await generatePackagePDF(basePackage);
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      companyAddress: '123 Ocean Drive, Malé, Maldives',
      contactPhone: '+960 555 0100',
      contactEmail: 'info@travelcrm.example',
      website: 'https://www.travelcrm.example',
    });
    const withBranding = await generatePackagePDF(basePackage);
    expect(withBranding.length).toBeGreaterThan(bare.length);
  });

  it('renders a remote logo image in the letterhead instead of the text-only fallback', async () => {
    mockFetchResolvingImage();
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      logoUrl: 'https://images.example.com/logo.png',
    });
    const withLogo = await generatePackagePDF(basePackage);
    vi.mocked(getOrgSettings).mockResolvedValueOnce({ ...BASE_ORG_SETTINGS, logoUrl: '' });
    const withoutLogo = await generatePackagePDF(basePackage);
    expect(withLogo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(withLogo.length).not.toBe(withoutLogo.length);
  });

  it('does not throw and still produces a valid PDF when the logo URL fails to resolve', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    vi.mocked(getOrgSettings).mockResolvedValueOnce({
      ...BASE_ORG_SETTINGS,
      logoUrl: 'https://images.example.com/logo.png',
    });
    const buffer = await generatePackagePDF(basePackage);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('does not force a page break before the itinerary beyond the one after the cover', async () => {
    // Page 1 is always the cover only (matches quotation's coverPage(),
    // which also ends with an unconditional page break). But there's no
    // *additional* forced break ahead of the itinerary itself (the old
    // inline controller used to unconditionally doc.addPage() before it) —
    // a thin package's overview/inclusions/itinerary should all still fit
    // together on page 2.
    const thin = await generatePackagePDF({
      id: 'pkg-thin',
      title: 'Quick Getaway',
      destination: 'Bali',
      itineraryDays: makeDays(1),
    });
    expect(countPages(thin)).toBe(2);
  });

});

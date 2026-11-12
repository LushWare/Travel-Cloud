import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExecuteTool = vi.hoisted(() => vi.fn());

// The registry is the outbound edge; stubbing it keeps this suite off the
// network while leaving every pure helper in the module real.
vi.mock('../../tools/toolRegistry.js', () => ({
  executeTool: mockExecuteTool,
  PUBLIC_TOOL_NAMES: ['listPackages', 'countPackages', 'getPackageDetail'],
}));

import {
  lastShownPackage,
  loadPackageDetail,
  loadFilteredPackages,
  countSentenceWithNames,
  packageFactValues,
  _resetPackageDetailCache,
} from '../packageContext.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const ACME = '00000000-0000-4000-8000-000000000002';
const GLOBE = '00000000-0000-4000-8000-000000000003';

const CATALOGUE = [
  { id: 'p-1', title: 'Thailand Family Adventure' },
  { id: 'p-2', title: 'Japan Cultural Journey' },
];

describe('lastShownPackage', () => {
  it('returns the most recently shown package', () => {
    expect(lastShownPackage(CATALOGUE, ['p-1', 'p-2'])?.id).toBe('p-2');
  });

  it('skips an id the catalogue does not contain rather than trusting the client', () => {
    expect(lastShownPackage(CATALOGUE, ['p-2', 'invented'])?.id).toBe('p-2');
  });

  it('returns null when nothing is usable', () => {
    expect(lastShownPackage(CATALOGUE, [])).toBeNull();
    expect(lastShownPackage(CATALOGUE, null)).toBeNull();
    expect(lastShownPackage(CATALOGUE, 'p-1')).toBeNull();
    expect(lastShownPackage(CATALOGUE, ['invented'])).toBeNull();
    expect(lastShownPackage([], ['p-1'])).toBeNull();
    expect(lastShownPackage(null, ['p-1'])).toBeNull();
  });
});

describe('packageFactValues', () => {
  it('allows the numbers the detail block contains, and still refuses an invention', () => {
    // The detail is part of what the model was shown, so its numbers are not
    // inventions. Without this, "Day 1: Bangkok Arrival, Day 2: …" — the
    // obvious answer to a question about the days — was rejected wholesale.
    const values = packageFactValues(
      [{ id: 'p-1', durationDays: 5, price: 2100 }],
      {
        itinerary: [
          { dayNumber: 1, title: 'Bangkok Arrival' },
          { dayNumber: 2, title: 'Floating Market' },
        ],
        inclusions: ['Checked bag up to 23kg'],
      },
    );

    expect(values.has('2100')).toBe(true);
    expect(values.has('1')).toBe(true);
    expect(values.has('2')).toBe(true);
    expect(values.has('23')).toBe(true);
    expect(values.has('999')).toBe(false);
  });

  it('works without a detail, as a turn that never fetched one', () => {
    const values = packageFactValues([{ id: 'p-1', durationDays: 9 }]);

    expect(values.has('9')).toBe(true);
    expect(values.has('8')).toBe(true);
  });
});

describe('loadPackageDetail', () => {
  beforeEach(() => {
    mockExecuteTool.mockReset();
    _resetPackageDetailCache();
  });

  it('reads the tool once for repeated reads inside the TTL', async () => {
    // The endpoint increments the package's view counter on every read, so a
    // conversation about one package must not count a view per message.
    mockExecuteTool.mockResolvedValue({ data: [{ id: 'p-1', title: 'One' }] });

    const first = await loadPackageDetail('p-1');
    const second = await loadPackageDetail('p-1');

    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("never serves one agency's memoized detail to another agency", async () => {
    mockExecuteTool
      .mockResolvedValueOnce({ data: [{ id: 'p-1', title: 'Acme Edition' }] })
      .mockResolvedValueOnce({ data: [{ id: 'p-1', title: 'Globe Edition' }] });

    const acme = await runWithTenant(ACME, () => loadPackageDetail('p-1'));
    const globe = await runWithTenant(GLOBE, () => loadPackageDetail('p-1'));

    expect(acme.title).toBe('Acme Edition');
    expect(globe.title).toBe('Globe Edition');
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('reads again once the memo is dropped', async () => {
    mockExecuteTool.mockResolvedValue({ data: [{ id: 'p-1' }] });

    await loadPackageDetail('p-1');
    _resetPackageDetailCache();
    await loadPackageDetail('p-1');

    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed read, so one bad minute does not blind the rest', async () => {
    mockExecuteTool.mockResolvedValueOnce({ unavailable: true });

    await expect(loadPackageDetail('p-1')).resolves.toBeNull();

    mockExecuteTool.mockResolvedValue({ data: [{ id: 'p-1', title: 'One' }] });
    await expect(loadPackageDetail('p-1')).resolves.toEqual({ id: 'p-1', title: 'One' });
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('returns null without reading when there is no id', async () => {
    await expect(loadPackageDetail('')).resolves.toBeNull();
    await expect(loadPackageDetail(undefined)).resolves.toBeNull();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it('returns null when the detail record is not an object', async () => {
    mockExecuteTool.mockResolvedValue({ data: [] });

    await expect(loadPackageDetail('p-1')).resolves.toBeNull();
  });
});

describe('loadFilteredPackages', () => {
  it('asks for the matching page and reports the total from the same response', async () => {
    mockExecuteTool.mockResolvedValue({
      data: [{ id: 'p-1', title: 'Bali Honeymoon Bliss', sellPrice: 618, currency: 'USD', durationDays: 5 }],
      total: 7,
    });

    const result = await loadFilteredPackages({ priceMax: 1000, destinationLabel: 'Bali' }, { limit: 3 });

    // Only the filter keys the tool declares cross the wire: `destinationLabel`
    // is prose for the sentence, not a query key.
    expect(mockExecuteTool).toHaveBeenCalledWith(
      'listPackages',
      { limit: 3, priceMax: 1000 },
      {},
      expect.anything(),
      undefined,
    );
    // One read answers both questions, so they cannot describe different sets.
    expect(result.total).toBe(7);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toMatchObject({ id: 'p-1', title: 'Bali Honeymoon Bliss', price: 618 });
  });

  it('reports nothing usable rather than composing a sentence it cannot back', async () => {
    for (const failure of [{ error: 'invalid args' }, { unavailable: true }, { notAuthorized: true }, null]) {
      mockExecuteTool.mockResolvedValue(failure);
      await expect(loadFilteredPackages({})).resolves.toEqual({ packages: [], total: null });
    }

    mockExecuteTool.mockRejectedValue(new Error('package-service is down'));
    await expect(loadFilteredPackages({})).resolves.toEqual({ packages: [], total: null });
  });

  it('treats a total the service did not report as unknown', async () => {
    mockExecuteTool.mockResolvedValue({ data: [] });

    await expect(loadFilteredPackages({})).resolves.toEqual({ packages: [], total: null });
  });
});

describe('countSentenceWithNames', () => {
  it('states the count alone when nothing matched or nothing is named', () => {
    expect(countSentenceWithNames(0, { priceMax: 100 }, 'USD', [])).toBe('There are 0 packages under $100.');
    expect(countSentenceWithNames(4, {}, 'USD', [])).toBe('There are 4 packages.');
  });

  it('names every match when they all fit, in the way a person lists names', () => {
    expect(countSentenceWithNames(1, { priceMax: 1000 }, 'USD', ['Bali Honeymoon Bliss'])).toBe(
      'There is 1 package under $1,000: Bali Honeymoon Bliss.',
    );
    expect(
      countSentenceWithNames(2, { priceMax: 1000 }, 'USD', ['Bali Honeymoon Bliss', 'Dubai Luxury Experience']),
    ).toBe('There are 2 packages under $1,000: Bali Honeymoon Bliss and Dubai Luxury Experience.');
    expect(countSentenceWithNames(3, {}, 'USD', ['A', 'B', 'C'])).toBe('There are 3 packages: A, B and C.');
  });

  it('says there are more and points at the list when it names only some', () => {
    // A partial list presented as the whole answer would be a quiet lie.
    expect(countSentenceWithNames(7, { priceMax: 5000 }, 'USD', ['A', 'B', 'C'])).toBe(
      'There are 7 packages under $5,000, including A, B and C. Open the list to see them all.',
    );
  });

  it('never names more than the preview limit, even when handed more', () => {
    expect(countSentenceWithNames(5, {}, 'USD', ['A', 'B', 'C', 'D', 'E'])).toBe(
      'There are 5 packages, including A, B and C. Open the list to see them all.',
    );
  });
});

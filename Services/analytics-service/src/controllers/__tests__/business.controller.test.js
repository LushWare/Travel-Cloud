import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../db/pool.js', () => ({ default: mockPool }));

const { getBusinessSignals } = await import('../business.controller.js');

const rows = (value) => ({ rows: [value] });
const zeroRow = { count: '0', value: '0', ids: [] };
const mockRes = () => {
  const res = {};
  res.json = vi.fn(() => res);
  return res;
};

/**
 * node-pg rejects a statement whose bound-parameter count exceeds its
 * placeholders ("bind message supplies 3 parameters, but prepared statement
 * requires 2"), and a missing binding is silently wrong. Both are caught here
 * rather than only at runtime against a live database.
 */
function expectEveryQueryBindsItsPlaceholders(expectedRepId) {
  const mismatches = [];
  for (const [sql, params] of mockPool.query.mock.calls) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    if (params.length !== Math.max(...placeholders)) {
      mismatches.push(`placeholders=${Math.max(...placeholders)} bound=${params.length} :: ${sql.slice(0, 90)}`);
    }
  }
  expect(mismatches).toEqual([]);
  for (const [sql, params] of mockPool.query.mock.calls) {
    const placeholders = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    expect(params[0]).toBeInstanceOf(Date);
    // The concentration statement binds the currency at $2 (it has no owner
    // predicate); every other statement that binds $2 binds the owner there.
    const bindsOwner = placeholders.includes(2) && (sql.includes('"assignedToId" = $2') || sql.includes('"createdById" = $2'));
    if (bindsOwner) expect(params[1]).toBe(expectedRepId);
    if (placeholders.includes(3)) expect(params[2]).toBe('USD');
  }
}

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue(rows(zeroRow));
});

describe('getBusinessSignals', () => {
  it('returns all 21 named signals for an admin and scopes every query company-wide', async () => {
    const req = { user: { id: 'admin-1', role: 'admin' } };
    const res = mockRes();

    await getBusinessSignals(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.scope).toBe('org');
    expect(Object.keys(payload.data.signals)).toHaveLength(21);
    expect(payload.data.signals.unconvertedQuotes).toEqual({ count: 0, value: 0, oldestAgeDays: 0, ids: [] });
    expect(payload.data.signals.flightsNeedingReview).toEqual({ count: 0, nearestDeparture: null, ids: [] });
    expect(payload.data.signals.hotelsNeedingReview).toEqual({ count: 0, nearestCheckin: null, ids: [] });
    expect(mockPool.query).toHaveBeenCalledTimes(21);
    expectEveryQueryBindsItsPlaceholders(null);
  });

  it('passes the sales rep id into every data query and zeros org-only signals without querying them', async () => {
    const req = { user: { id: 'rep-7', role: 'salesRep' } };
    const res = mockRes();

    await getBusinessSignals(req, res, vi.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.scope).toBe('own');
    expect(payload.data.signals.unassignedLeads.count).toBe(0);
    expect(payload.data.signals.cancellationSpike).toEqual({ cur: 0, baseline: 0 });
    expect(payload.data.signals.silentPackages.count).toBe(0);
    expect(mockPool.query).toHaveBeenCalledTimes(15);
    expectEveryQueryBindsItsPlaceholders('rep-7');
  });

  it('normalizes database strings, nullable dates, and id arrays for the wire response', async () => {
    mockPool.query.mockResolvedValue(rows(zeroRow));
    mockPool.query.mockResolvedValueOnce(rows({
      count: '8',
      value: '24000.50',
      oldestAgeDays: '12',
      ids: ['quote-1', null, 'quote-2'],
    }));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.unconvertedQuotes).toEqual({
      count: 8,
      value: 24000.5,
      oldestAgeDays: 12,
      ids: ['quote-1', 'quote-2'],
    });
    expect(res.json.mock.calls[0][0].data.signals.departuresOutstanding.nearestDeparture).toBeNull();
  });

  it('returns the package ids behind the quiet-packages signal', async () => {
    const packageIds = ['4a958671-d29b-465c-b68c-e855472133f9', 'ed7c45b7-2eed-4690-87d8-c53bdf4408e6'];
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('FROM crm_packages."Package" package')
        ? { count: '2', ids: packageIds }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    expect(res.json.mock.calls[0][0].data.signals.silentPackages).toEqual({ count: 2, ids: packageIds });
    expect(mockPool.query.mock.calls.find(([sql]) => sql.includes('FROM crm_packages."Package" package'))[0])
      .toContain('ARRAY_AGG(package.id');
  });

  it('returns all linked lead ids when a signal count exceeds fifty', async () => {
    const leadIds = Array.from({ length: 63 }, (_, index) => `lead-${index + 1}`);
    mockPool.query.mockImplementation((sql) => rows(
      sql.includes('COALESCE(pricing."sellSubtotal", 0) >= 2000')
        ? { count: '63', oldestAgeDays: '12', ids: leadIds }
        : zeroRow,
    ));
    const res = mockRes();

    await getBusinessSignals({ user: { id: 'admin-1', role: 'admin' } }, res, vi.fn());

    const coldLeadQuery = mockPool.query.mock.calls.find(([sql]) => sql.includes('COALESCE(pricing."sellSubtotal", 0) >= 2000'))[0];
    expect(coldLeadQuery).toContain('[1:100]');
    expect(res.json.mock.calls[0][0].data.signals.coldLeads).toMatchObject({ count: 63, ids: leadIds });
  });
});

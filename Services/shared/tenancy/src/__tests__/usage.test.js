import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  meteredSend, reserveUsage, currentUsage, usagePeriod, usageLimitMessage, runWithTenant,
} from '../index.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';

// Answers by statement: the agency's plan, plus an in-memory counter row for this month.
function fakeDb(entitlements, { used = 0, warned = false } = {}) {
  const state = { count: used, warnedAt: warned ? new Date() : null, inserts: [] };
  const db = {
    $queryRawUnsafe: vi.fn(async (sql, ...params) => {
      if (sql.includes('"TenantPlan"')) {
        return entitlements === null ? [] : [{
          id: 'v', planId: 'p', version: 1, name: 'Plan', entitlements, catalogPlanId: 'p', planKey: 'plan',
        }];
      }
      if (sql.includes('"PlanEntitlementOverride"')) return [];
      if (sql.includes('INSERT INTO crm_platform."UsageCounter"')) {
        state.inserts.push(params);
        const limit = params[3];
        if (limit !== null && state.count >= limit) return [];
        state.count += 1;
        return [{ count: state.count, warnedAt: state.warnedAt }];
      }
      if (sql.includes('SET "warnedAt"')) {
        if (state.warnedAt) return [];
        state.warnedAt = new Date();
        return [{ tenantId: params[0] }];
      }
      if (sql.includes('SELECT "metric", "count"')) return [{ metric: 'emails', count: state.count }];
      return [];
    }),
    $executeRawUnsafe: vi.fn(async () => { state.count = Math.max(state.count - 1, 0); return 1; }),
  };
  return { db, state };
}
const inAgency = (fn) => runWithTenant(AGENCY, fn);
const send = () => vi.fn().mockResolvedValue('sent');

describe('usagePeriod', () => {
  it('names the first day of the UTC month', () => {
    expect(usagePeriod(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11-01');
  });

  it('moves to the next month at UTC midnight on the 1st', () => {
    expect(usagePeriod(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12-01');
  });
});

describe('reserveUsage', () => {
  it('counts a send for the current agency, metric and month', async () => {
    const { db, state } = fakeDb({ emails_per_month: 100 });

    const result = await inAgency(() => reserveUsage(db, 'emails', { now: new Date('2026-11-12T10:00:00Z') }));

    expect(result).toMatchObject({ allowed: true, limit: 100, used: 1 });
    expect(state.inserts[0]).toEqual([AGENCY, 'emails', '2026-11-01', 100]);
  });

  it('refuses without counting when the allowance is used up', async () => {
    const { db, state } = fakeDb({ emails_per_month: 5 }, { used: 5 });

    const result = await inAgency(() => reserveUsage(db, 'emails'));

    expect(result).toEqual({ allowed: false, limit: 5, used: 5 });
    expect(state.count).toBe(5);
  });

  it('refuses every send when the allowance is zero, without touching the counter', async () => {
    const { db, state } = fakeDb({ whatsapp_per_month: 0 });

    const result = await inAgency(() => reserveUsage(db, 'whatsapp'));

    expect(result.allowed).toBe(false);
    expect(state.inserts).toEqual([]);
  });

  it('still counts, with no limit, for an agency with no plan', async () => {
    const { db, state } = fakeDb(null);

    const result = await inAgency(() => reserveUsage(db, 'emails'));

    expect(result).toMatchObject({ allowed: true, limit: null, used: 1 });
    expect(state.inserts[0][3]).toBeNull();
  });

  it('flags the send that first reaches 80% of the limit', async () => {
    const { db } = fakeDb({ emails_per_month: 10 }, { used: 7 });

    const result = await inAgency(() => reserveUsage(db, 'emails'));

    expect(result).toMatchObject({ used: 8, crossedWarning: true });
  });

  it('does not flag a send below 80%', async () => {
    const { db } = fakeDb({ emails_per_month: 10 }, { used: 6 });

    expect((await inAgency(() => reserveUsage(db, 'emails'))).crossedWarning).toBe(false);
  });

  it('flags the 80% mark only once a month', async () => {
    const { db } = fakeDb({ emails_per_month: 10 }, { used: 8, warned: true });

    expect((await inAgency(() => reserveUsage(db, 'emails'))).crossedWarning).toBe(false);
  });

  it('rejects an unknown metric', async () => {
    const { db } = fakeDb({});

    await expect(inAgency(() => reserveUsage(db, 'sms'))).rejects.toThrow(/Unknown usage metric/);
  });

  it('refuses to count outside an agency', async () => {
    const { db } = fakeDb({});

    await expect(reserveUsage(db, 'emails')).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });
});

describe('meteredSend', () => {
  it('sends and keeps the count when the send succeeds', async () => {
    const { db, state } = fakeDb({ emails_per_month: 10 });

    const result = await inAgency(() => meteredSend(db, 'emails', send()));

    expect(result).toBe('sent');
    expect(state.count).toBe(1);
  });

  it('gives the unit back when the send fails', async () => {
    const { db, state } = fakeDb({ emails_per_month: 10 }, { used: 4 });
    const failing = vi.fn().mockRejectedValue(new Error('smtp down'));

    await expect(inAgency(() => meteredSend(db, 'emails', failing))).rejects.toThrow('smtp down');
    expect(state.count).toBe(4);
  });

  it('throws the caller\'s limit error and never sends once the allowance is used up', async () => {
    const { db } = fakeDb({ emails_per_month: 2 }, { used: 2 });
    const sender = send();
    const onLimit = vi.fn(({ limit }) => Object.assign(new Error('limit'), { limit }));

    await expect(inAgency(() => meteredSend(db, 'emails', sender, { onLimit }))).rejects.toMatchObject({ limit: 2 });
    expect(sender).not.toHaveBeenCalled();
  });

  it('runs the warning once, after the send that reaches 80%', async () => {
    const { db } = fakeDb({ emails_per_month: 10 }, { used: 7 });
    const onWarning = vi.fn();

    await inAgency(() => meteredSend(db, 'emails', send(), { onWarning }));

    expect(onWarning).toHaveBeenCalledWith({ metric: 'emails', limit: 10, used: 8 });
  });

  it('still sends, and logs an error, when the counter cannot be reached', async () => {
    const db = { $queryRawUnsafe: vi.fn().mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' })) };
    const logger = { error: vi.fn() };
    const sender = send();

    const result = await inAgency(() => meteredSend(db, 'emails', sender, { logger }));

    expect(result).toBe('sent');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('keeps the send even when recording the warning fails', async () => {
    const { db } = fakeDb({ emails_per_month: 10 }, { used: 7 });
    const logger = { error: vi.fn() };

    const result = await inAgency(() => meteredSend(db, 'emails', send(), {
      logger, onWarning: vi.fn().mockRejectedValue(new Error('audit down')),
    }));

    expect(result).toBe('sent');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('currentUsage', () => {
  it('reports every metric, with zero for one not used this month', async () => {
    const { db } = fakeDb({}, { used: 12 });

    expect(await inAgency(() => currentUsage(db))).toEqual({ emails: 12, whatsapp: 0 });
  });
});

describe('usageLimitMessage', () => {
  it('names the allowance and when sending resumes', () => {
    expect(usageLimitMessage('whatsapp', 500)).toMatch(/allowance of 500 WhatsApp messages.*1st of next month/);
  });
});

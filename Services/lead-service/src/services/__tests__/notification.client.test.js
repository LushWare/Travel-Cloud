import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn(), $executeRaw: vi.fn() } }));
vi.mock('../../db/client.js', () => ({ default: db }));

import { sendWhatsappText } from '../notification.client.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';

// A database that answers by statement: the agency's plan, and a usage counter at `used`.
function agencyOn(entitlements, { used = 0 } = {}) {
  let count = used;
  db.$queryRawUnsafe.mockImplementation(async (sql, ...params) => {
    if (sql.includes('"TenantPlan"')) {
      return [{ id: 'v', planId: 'p', version: 1, name: 'Starter', entitlements, catalogPlanId: 'p', planKey: 'starter' }];
    }
    if (sql.includes('"PlanEntitlementOverride"')) return [];
    if (sql.includes('INSERT INTO crm_platform."UsageCounter"')) {
      const limit = params[3];
      if (limit !== null && count >= limit) return [];
      count += 1;
      return [{ count, warnedAt: new Date() }];
    }
    return [];
  });
  db.$executeRawUnsafe.mockImplementation(async () => { count -= 1; return 1; });
  return { usage: () => count };
}
const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
const reply = (fetchImpl) => runWithTenant(AGENCY, () => sendWhatsappText({ to: '+15550001111', body: 'Hi', fetchImpl }));

beforeEach(() => vi.clearAllMocks());

describe('sendWhatsappText', () => {
  it('refuses a reply with FEATURE_NOT_IN_PLAN and sends nothing when the plan leaves WhatsApp out', async () => {
    agencyOn({ features: { whatsapp: false } });
    const fetchImpl = okFetch();

    await expect(reply(fetchImpl)).rejects.toMatchObject({ statusCode: 403, code: 'FEATURE_NOT_IN_PLAN' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the reply through notification-service when the plan includes WhatsApp', async () => {
    agencyOn({ features: { whatsapp: true } });
    const fetchImpl = okFetch();

    await reply(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ type: 'text', to: '+15550001111', body: 'Hi' });
  });

  it('counts a sent reply against the monthly WhatsApp allowance', async () => {
    const agency = agencyOn({ whatsapp_per_month: 10, features: { whatsapp: true } }, { used: 3 });

    await reply(okFetch());

    expect(agency.usage()).toBe(4);
  });

  it('refuses with 429 USAGE_LIMIT_REACHED and sends nothing once the allowance is used up', async () => {
    agencyOn({ whatsapp_per_month: 10, features: { whatsapp: true } }, { used: 10 });
    const fetchImpl = okFetch();

    await expect(reply(fetchImpl)).rejects.toMatchObject({ statusCode: 429, code: 'USAGE_LIMIT_REACHED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not count a reply notification-service failed to send', async () => {
    const agency = agencyOn({ whatsapp_per_month: 10, features: { whatsapp: true } }, { used: 3 });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });

    await expect(reply(fetchImpl)).rejects.toThrow();
    expect(agency.usage()).toBe(3);
  });
});

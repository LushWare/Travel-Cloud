import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    membership: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));
vi.mock('../../db/client.js', () => ({ default: db, identityPrisma: db }));

import { runWithTenant } from '../../../../shared/tenancy/src/index.js';
import { getAgencyPlan } from '../admin.controller.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';

async function call() {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  await runWithTenant(AGENCY, () => getAgencyPlan({}, res, next));
  return { body: res.json.mock.calls[0]?.[0], next };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.membership.count.mockResolvedValue(4);
  db.$queryRaw.mockResolvedValue([{ count: 12 }]);
});

describe('getAgencyPlan usage', () => {
  it('reports this month\'s customer emails and WhatsApp messages next to the other usage', async () => {
    db.$queryRawUnsafe.mockImplementation(async (sql) => (String(sql).includes('"UsageCounter"')
      ? [{ metric: 'emails', count: 830 }, { metric: 'whatsapp', count: 41 }]
      : []));

    const { body } = await call();

    expect(body.data.usage).toEqual({ staff_seats: 4, packages: 12, emails_per_month: 830, whatsapp_per_month: 41 });
  });

  it('shows zero sends instead of failing when the usage table cannot be read', async () => {
    db.$queryRawUnsafe.mockImplementation(async (sql) => {
      if (String(sql).includes('"UsageCounter"')) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
      return [];
    });

    const { body, next } = await call();

    expect(next).not.toHaveBeenCalled();
    expect(body.data.usage).toMatchObject({ emails_per_month: 0, whatsapp_per_month: 0 });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, tx } = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
  const db = { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() };
  return { db, tx };
});

vi.mock('../../db/client.js', () => ({ default: db }));

import bcrypt from 'bcryptjs';
import {
  createAgencySignup,
  listSignupPlans,
  resendAgencySignupCode,
  verifyAgencySignup,
} from '../agencySignup.service.js';

const STARTER_ID = '11111111-1111-4111-8111-111111111111';
const GROWTH_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const plans = [
  {
    key: 'starter', planVersionId: STARTER_ID, name: 'Starter', description: 'For small agencies.',
    priceMinorUnits: 4900, currency: 'USD', billingInterval: 'monthly', entitlements: {},
  },
  {
    key: 'growth', planVersionId: GROWTH_ID, name: 'Growth', description: 'For growing teams.',
    priceMinorUnits: 14900, currency: 'USD', billingInterval: 'monthly', entitlements: {},
  },
];

const sql = ([strings]) => strings.join('');

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((callback) => callback(tx));
  tx.$queryRaw.mockImplementation((strings) => {
    const query = strings.join('');
    if (query.includes('crm_platform."Plan"')) return plans;
    if (query.includes('crm_users."User"')) return [];
    return [];
  });
  tx.$executeRaw.mockResolvedValue(1);
  db.$executeRaw.mockResolvedValue(1);
});

describe('public signup plan catalogue', () => {
  it('returns only active paid plans and trims database currency values', async () => {
    db.$queryRaw.mockResolvedValue(plans);

    const result = await listSignupPlans();

    expect(result.map((plan) => plan.key)).toEqual(['starter', 'growth']);
    expect(result[0].currency).toBe('USD');
    expect(sql(db.$queryRaw.mock.calls[0])).toContain("p.key <> 'internal'");
    expect(sql(db.$queryRaw.mock.calls[0])).toContain('pv."isCurrent" = true');
  });
});

describe('agency signup provisioning', () => {
  it('creates an owner membership on a Growth trial and remembers the chosen post-trial plan', async () => {
    const result = await createAgencySignup({
      agencyName: 'North Star Travel',
      ownerName: 'Alex Owner',
      email: 'alex@example.com',
      password: 'a secure password',
      planKey: 'starter',
    });

    const statements = tx.$executeRaw.mock.calls.map(sql);
    expect(statements.some((statement) => statement.includes('"postTrialPlanVersionId"'))).toBe(true);
    expect(statements.some((statement) => statement.includes('crm_users."Membership"') && statement.includes("'invited'"))).toBe(true);
    expect(statements.some((statement) => statement.includes('crm_platform."TenantPlan"'))).toBe(true);
    expect(statements.some((statement) => statement.includes('crm_users."OrganizationSettings"'))).toBe(true);
    expect(result).toMatchObject({ ownerName: 'Alex Owner', email: 'alex@example.com' });
    expect(result.code).toMatch(/^\d{6}$/);
    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it('rejects signup when the email already belongs to an account', async () => {
    tx.$queryRaw.mockImplementation((strings) => (
      strings.join('').includes('crm_platform."Plan"') ? plans : [{ id: USER_ID }]
    ));

    await expect(createAgencySignup({
      agencyName: 'North Star Travel',
      ownerName: 'Alex Owner',
      email: 'alex@example.com',
      password: 'a secure password',
      planKey: 'starter',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('agency signup email verification', () => {
  it('activates the owner membership only after a valid, unexpired code', async () => {
    db.$queryRaw.mockResolvedValue([{
      id: USER_ID,
      emailVerificationToken: await bcrypt.hash('123456', 4),
      emailVerificationExpire: new Date(Date.now() + 60_000),
      isEmailVerified: false,
    }]);

    await expect(verifyAgencySignup({ email: 'alex@example.com', code: '123456' })).resolves.toBe(USER_ID);

    expect(sql(tx.$executeRaw.mock.calls[0])).toContain('"isEmailVerified" = true');
    expect(sql(tx.$executeRaw.mock.calls[1])).toContain('status = \'active\'');
  });

  it('rejects an incorrect code without activating the membership', async () => {
    db.$queryRaw.mockResolvedValue([{
      id: USER_ID,
      emailVerificationToken: await bcrypt.hash('123456', 4),
      emailVerificationExpire: new Date(Date.now() + 60_000),
      isEmailVerified: false,
    }]);

    await expect(verifyAgencySignup({ email: 'alex@example.com', code: '654321' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not report verification success if the owner membership changed concurrently', async () => {
    db.$queryRaw.mockResolvedValue([{
      id: USER_ID,
      emailVerificationToken: await bcrypt.hash('123456', 4),
      emailVerificationExpire: new Date(Date.now() + 60_000),
      isEmailVerified: false,
    }]);
    tx.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(verifyAgencySignup({ email: 'alex@example.com', code: '123456' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('resending agency signup verification', () => {
  it('does not return a code when the signup was verified concurrently', async () => {
    db.$queryRaw.mockResolvedValue([{ id: USER_ID, name: 'Alex Owner', email: 'alex@example.com' }]);
    db.$executeRaw.mockResolvedValue(0);

    await expect(resendAgencySignupCode('alex@example.com')).resolves.toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    decryptSecret: vi.fn(),
    verifySmtp: vi.fn(),
    getStripeAccount: vi.fn(),
    getWhatsappPhoneNumber: vi.fn(),
    checkFacebookPageToken: vi.fn(),
  },
}));
vi.mock('../crypto.js', () => ({ decryptSecret: mocks.decryptSecret }));
vi.mock('../smtp.js', () => ({ verifySmtp: mocks.verifySmtp }));
vi.mock('../stripe.js', () => ({ getStripeAccount: mocks.getStripeAccount }));
vi.mock('../whatsapp.js', () => ({ getWhatsappPhoneNumber: mocks.getWhatsappPhoneNumber }));
vi.mock('../facebook.js', () => ({ checkFacebookPageToken: mocks.checkFacebookPageToken }));
vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));

import { emailOwners, runHealthChecks } from '../healthChecks.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';
const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
const row = (over = {}) => ({ id: 'int-1', tenantId: AGENCY, provider: 'email', status: 'connected', config: { host: 'smtp.agency.test' }, ...over });

function poolWith(rows) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM crm_integrations."TenantIntegration"')) return { rows };
      if (sql.includes('crm_users."Membership"')) return { rows: [{ name: 'Alex', email: 'alex@agency.test' }] };
      return { rows: [], rowCount: 1 };
    }),
  };
}
const updates = (pool) => pool.calls.filter((c) => c.sql.includes('UPDATE crm_integrations')).map((c) => c.params.slice(0, 2));
const audits = (pool) => pool.calls.filter((c) => c.sql.includes('INSERT INTO crm_platform."AuditLog"')).map((c) => c.params[1]);

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mocks)) fn.mockReset().mockResolvedValue(undefined);
  mocks.decryptSecret.mockResolvedValue({ password: 'pw', accessToken: 'tok' });
});

describe('runHealthChecks', () => {
  it('keeps a working connection connected and only notes when it was checked', async () => {
    const pool = poolWith([row()]);
    const notifyOwners = vi.fn();

    const totals = await runHealthChecks({ pool, logger, notifyOwners });

    expect(totals).toMatchObject({ checked: 1, healthy: 1, broke: 0 });
    expect(updates(pool)).toEqual([['connected', null]]);
    expect(notifyOwners).not.toHaveBeenCalled();
  });

  it('marks a connection that stopped working as broken and emails the owner', async () => {
    mocks.verifySmtp.mockRejectedValue(new Error('535 auth failed'));
    const pool = poolWith([row()]);
    const notifyOwners = vi.fn();

    const totals = await runHealthChecks({ pool, logger, notifyOwners });

    expect(totals.broke).toBe(1);
    expect(updates(pool)[0][0]).toBe('error');
    expect(audits(pool)).toEqual(['integration.health_failed']);
    expect(notifyOwners).toHaveBeenCalledWith(expect.objectContaining({ tenantId: AGENCY, provider: 'email' }));
  });

  it('never shows the provider\'s raw error to the agency', async () => {
    mocks.verifySmtp.mockRejectedValue(new Error('535 5.7.8 password=hunter2 rejected'));
    const pool = poolWith([row()]);

    await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    expect(updates(pool)[0][1]).not.toContain('hunter2');
  });

  it('emails the owner only once while a connection stays broken', async () => {
    mocks.verifySmtp.mockRejectedValue(new Error('still down'));
    const pool = poolWith([row({ status: 'error' })]);
    const notifyOwners = vi.fn();

    const totals = await runHealthChecks({ pool, logger, notifyOwners });

    expect(totals.stillBroken).toBe(1);
    expect(notifyOwners).not.toHaveBeenCalled();
  });

  it('marks a broken connection connected again when it recovers', async () => {
    const pool = poolWith([row({ status: 'error' })]);

    const totals = await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    expect(totals.recovered).toBe(1);
    expect(updates(pool)).toEqual([['connected', null]]);
    expect(audits(pool)).toEqual(['integration.health_recovered']);
  });

  it('checks WhatsApp with the stored business account and phone number', async () => {
    const pool = poolWith([row({ provider: 'whatsapp', config: { wabaId: '111', phoneNumberId: '222' } })]);

    await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    expect(mocks.getWhatsappPhoneNumber).toHaveBeenCalledWith('111', '222', 'tok');
  });

  it('checks only the Facebook pages the agency selected', async () => {
    mocks.decryptSecret.mockResolvedValue({ pages: [{ id: 'p1', accessToken: 'a1' }, { id: 'p2', accessToken: 'a2' }] });
    const pool = poolWith([row({ provider: 'facebook', config: { pages: [{ id: 'p1', selected: true }, { id: 'p2', selected: false }] } })]);

    await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    expect(mocks.checkFacebookPageToken.mock.calls).toEqual([['p1', 'a1']]);
  });

  it('treats a Stripe token for a different account as broken', async () => {
    mocks.getStripeAccount.mockResolvedValue({ id: 'acct_other' });
    const pool = poolWith([row({ provider: 'stripe', config: { accountId: 'acct_1' } })]);

    expect((await runHealthChecks({ pool, logger, notifyOwners: vi.fn() })).broke).toBe(1);
  });

  it('names the agency in every database write', async () => {
    mocks.verifySmtp.mockRejectedValue(new Error('down'));
    const pool = poolWith([row()]);

    await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    const writes = pool.calls.filter((c) => /UPDATE|INSERT/.test(c.sql));
    expect(writes.every((c) => c.params.includes(AGENCY))).toBe(true);
  });

  it('keeps checking other agencies when recording one fails', async () => {
    const pool = poolWith([row(), row({ id: 'int-2', tenantId: '00000000-0000-4000-8000-000000000004' })]);
    let first = true;
    const original = pool.query;
    pool.query = vi.fn(async (sql, params) => {
      if (first && sql.includes('UPDATE')) { first = false; throw new Error('db blip'); }
      return original(sql, params);
    });

    const totals = await runHealthChecks({ pool, logger, notifyOwners: vi.fn() });

    expect(totals).toMatchObject({ checked: 2, crashed: 1, healthy: 1 });
  });
});

describe('emailOwners', () => {
  it('emails each active owner through notification-service with a Google ID token', async () => {
    const pool = poolWith([]);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await emailOwners({ pool, logger, tenantId: AGENCY, provider: 'whatsapp', fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ to: 'alex@agency.test', subject: 'Action needed: your WhatsApp connection stopped working' });
    expect(init.headers.Authorization).toBe('Bearer id-token');
  });

  it('escapes the owner\'s name in the email', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ name: '<b>x</b>', email: 'o@a.test' }] })) };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await emailOwners({ pool, logger, tenantId: AGENCY, provider: 'email', fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('logs and carries on when an email cannot be sent', async () => {
    const pool = poolWith([]);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(emailOwners({ pool, logger, tenantId: AGENCY, provider: 'email', fetchImpl })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

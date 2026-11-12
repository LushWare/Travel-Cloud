import { describe, it, expect, vi } from 'vitest';
import { recordAudit, redactDetails } from '../audit.js';
import { runWithTenant } from '../context.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';

// Captures the tagged-template call: the SQL text and the bound values, in order.
const fakeDb = (impl = async () => 1) => {
  const calls = [];
  return {
    calls,
    $executeRaw: vi.fn(async (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return impl(); }),
  };
};

const req = {
  user: { id: 'user-1', email: 'admin@acme.test', role: 'admin' },
  headers: { 'x-client-ip': '203.0.113.7', 'x-request-id': 'req-1' },
};

describe('recordAudit', () => {
  it('writes the entry for the current agency with the acting user, IP and request id', async () => {
    const db = fakeDb();

    const ok = await runWithTenant(AGENCY, () => recordAudit(db, req, {
      action: 'staff.role_changed', targetType: 'user', targetId: 'user-2', summary: 'Changed role', details: { from: 'salesRep', to: 'admin' },
    }));

    expect(ok).toBe(true);
    expect(db.calls[0].sql).toContain('INSERT INTO crm_platform."AuditLog"');
    expect(db.calls[0].values).toEqual([
      AGENCY, 'user-1', 'admin@acme.test', 'admin', 'staff.role_changed', 'user', 'user-2', 'Changed role',
      JSON.stringify({ from: 'salesRep', to: 'admin' }), '203.0.113.7', 'req-1',
    ]);
  });

  it('falls back to the gateway identity headers when there is no req.user', async () => {
    const db = fakeDb();
    const headerReq = { headers: { 'x-user-id': 'u-9', 'x-user-email': 'h@acme.test', 'x-user-role': 'superAdmin' } };

    await runWithTenant(AGENCY, () => recordAudit(db, headerReq, { action: 'staff.invited', summary: 'Invited' }));

    expect(db.calls[0].values.slice(1, 4)).toEqual(['u-9', 'h@acme.test', 'superAdmin']);
  });

  it('never stores a bank account number or password passed in details', async () => {
    const db = fakeDb();

    await runWithTenant(AGENCY, () => recordAudit(db, req, {
      action: 'settings.updated', summary: 'Updated', details: { fields: ['bankName'], bankAccountNumber: '123456', password: 'x' },
    }));

    const stored = JSON.parse(db.calls[0].values[8]);
    expect(stored).toEqual({ fields: ['bankName'], bankAccountNumber: '[redacted]', password: '[redacted]' });
  });

  it('writes nothing and reports false outside an agency', async () => {
    const db = fakeDb();
    const logger = { error: vi.fn() };

    const ok = await recordAudit(db, req, { action: 'staff.invited', summary: 'x' }, { logger });

    expect(ok).toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed action name without writing', async () => {
    const db = fakeDb();

    const ok = await runWithTenant(AGENCY, () => recordAudit(db, req, { action: 'DROP TABLE', summary: 'x' }));

    expect(ok).toBe(false);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('logs and swallows a database failure so the recorded action still succeeds', async () => {
    const db = fakeDb(async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }); });
    const logger = { error: vi.fn() };

    const ok = await runWithTenant(AGENCY, () => recordAudit(db, req, { action: 'staff.invited', summary: 'x' }, { logger }));

    expect(ok).toBe(false);
    expect(logger.error.mock.calls[0][0].err).toEqual({ message: 'permission denied', code: '42501' });
  });

  it('clips an over-long summary to the column size', async () => {
    const db = fakeDb();

    await runWithTenant(AGENCY, () => recordAudit(db, req, { action: 'staff.invited', summary: 'x'.repeat(500) }));

    expect(db.calls[0].values[7]).toHaveLength(300);
  });
});

describe('redactDetails', () => {
  it('redacts sensitive keys at any depth, including inside arrays', () => {
    expect(redactDetails({ a: { apiKey: 'k', b: [{ upiId: 'u', ok: 1 }] } }))
      .toEqual({ a: { apiKey: '[redacted]', b: [{ upiId: '[redacted]', ok: 1 }] } });
  });

  it('leaves ordinary values alone', () => {
    expect(redactDetails({ from: 'admin', to: 'salesRep', fields: ['companyName'] }))
      .toEqual({ from: 'admin', to: 'salesRep', fields: ['companyName'] });
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({ default: {}, identityPrisma: {} }));

import { accessChangeEntries } from '../accountGuard.js';
import { changedSettingsFields } from '../../services/organizationSettings.service.js';

const PERSON = { id: 'u-1', name: 'Kavindi', email: 'k@acme.test' };
const MEMBER = { id: 'm-1', role: 'salesRep', permissions: ['view_reports'], status: 'active' };
const actions = (entries) => entries.map((e) => e.action);

describe('accessChangeEntries', () => {
  it('records a role change with where it came from and went to', () => {
    const [entry] = accessChangeEntries(PERSON, MEMBER, { ...MEMBER, role: 'admin' });

    expect(entry).toMatchObject({
      action: 'staff.role_changed', targetType: 'user', targetId: 'u-1',
      summary: 'Changed Kavindi (k@acme.test) from salesRep to admin', details: { from: 'salesRep', to: 'admin' },
    });
  });

  it('records becoming an owner as its own action', () => {
    expect(actions(accessChangeEntries(PERSON, MEMBER, { ...MEMBER, role: 'superAdmin' }))).toEqual(['staff.owner_granted']);
  });

  it('records losing owner access as its own action', () => {
    const owner = { ...MEMBER, role: 'superAdmin' };

    expect(actions(accessChangeEntries(PERSON, owner, { ...owner, role: 'admin' }))).toEqual(['staff.owner_revoked']);
  });

  it('lists exactly which permissions were added and removed', () => {
    const [entry] = accessChangeEntries(PERSON, MEMBER, { ...MEMBER, permissions: ['manage_billing'] });

    expect(entry.details).toEqual({ added: ['manage_billing'], removed: ['view_reports'] });
  });

  it('ignores the same permissions in a different order', () => {
    const member = { ...MEMBER, permissions: ['a', 'b'] };

    expect(accessChangeEntries(PERSON, member, { ...member, permissions: ['b', 'a'] })).toEqual([]);
  });

  it('records suspending, but not suspending someone already suspended', () => {
    expect(actions(accessChangeEntries(PERSON, MEMBER, { ...MEMBER, status: 'suspended' }))).toEqual(['staff.suspended']);
    const suspended = { ...MEMBER, status: 'suspended' };
    expect(accessChangeEntries(PERSON, suspended, suspended)).toEqual([]);
  });

  it('records reactivation from suspended', () => {
    const suspended = { ...MEMBER, status: 'suspended' };

    expect(actions(accessChangeEntries(PERSON, suspended, { ...suspended, status: 'active' }))).toEqual(['staff.reactivated']);
  });

  it('records nothing when nothing changed', () => {
    expect(accessChangeEntries(PERSON, MEMBER, { ...MEMBER })).toEqual([]);
  });
});

describe('changedSettingsFields', () => {
  it('names only the editable fields whose value changed', () => {
    const before = { companyName: 'Acme', bankName: 'A Bank', updatedAt: 1 };
    const after = { companyName: 'Acme Tours', bankName: 'A Bank', updatedAt: 2 };

    expect(changedSettingsFields(before, after)).toEqual(['companyName']);
  });

  it('treats a cleared value as a change', () => {
    expect(changedSettingsFields({ upiId: 'acme@upi' }, { upiId: null })).toEqual(['upiId']);
  });

  it('compares lists and numbers by value', () => {
    const row = { paymentMethods: ['UPI'], quotationValidityDays: 30 };

    expect(changedSettingsFields(row, { paymentMethods: ['UPI'], quotationValidityDays: 30 })).toEqual([]);
  });
});

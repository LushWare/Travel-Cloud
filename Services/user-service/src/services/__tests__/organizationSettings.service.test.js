import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockCreate, mockUpdate, mockTenantFind } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockTenantFind: vi.fn(),
}));

vi.mock('../../db/client.js', () => {
  const client = {
    organizationSettings: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
    },
    tenant: { findUnique: mockTenantFind },
  };
  return { default: client, identityPrisma: client };
});

import { runWithTenant } from '../../../../shared/tenancy/src/index.js';
import { getOrCreateSingleton, updateSingleton } from '../organizationSettings.service.js';

const ACME = '00000000-0000-4000-8000-000000000002';
const inAcme = (fn) => runWithTenant(ACME, fn);

describe('getOrCreateSingleton', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCreate.mockReset();
    mockTenantFind.mockReset();
  });

  it('returns the existing row when one is already present', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });

    const settings = await inAcme(() => getOrCreateSingleton());

    expect(settings.id).toBe('org-1');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("starts a new agency's settings with that agency's own name", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockTenantFind.mockResolvedValue({ name: 'Acme Tours' });
    mockCreate.mockResolvedValue({ id: 'org-new', companyName: 'Acme Tours' });

    const settings = await inAcme(() => getOrCreateSingleton());

    expect(mockTenantFind).toHaveBeenCalledWith({ where: { id: ACME }, select: { name: true } });
    expect(mockCreate).toHaveBeenCalledWith({ data: { companyName: 'Acme Tours' } });
    expect(settings.companyName).toBe('Acme Tours');
  });

  it('falls back to column defaults when the agency row has no name', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockTenantFind.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'org-new' });

    await inAcme(() => getOrCreateSingleton());

    expect(mockCreate).toHaveBeenCalledWith({ data: {} });
  });

  it('returns the row a concurrent request created when the create hits the unique rule', async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'org-raced', companyName: 'Acme Tours' });
    mockTenantFind.mockResolvedValue({ name: 'Acme Tours' });
    mockCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const settings = await inAcme(() => getOrCreateSingleton());

    expect(settings.id).toBe('org-raced');
  });

  it('rethrows any other create error', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockTenantFind.mockResolvedValue({ name: 'Acme Tours' });
    mockCreate.mockRejectedValue(Object.assign(new Error('connection lost'), { code: 'P1001' }));

    await expect(inAcme(() => getOrCreateSingleton())).rejects.toThrow('connection lost');
  });

  it('refuses to create settings when no agency is set', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(getOrCreateSingleton()).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('updateSingleton', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockTenantFind.mockReset();
  });

  it('merges only whitelisted fields onto the existing singleton', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Old Name' });
    mockUpdate.mockResolvedValue({ id: 'org-1', companyName: 'New Name' });

    await inAcme(() => updateSingleton({ companyName: 'New Name', id: 'attacker-supplied-id', notAField: true }, 'user-1'));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { companyName: 'New Name', updatedById: 'user-1' },
    });
  });

  it('records updatedById as null when no acting user is supplied', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1' });
    mockUpdate.mockResolvedValue({ id: 'org-1' });

    await inAcme(() => updateSingleton({ companyName: 'X' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { companyName: 'X', updatedById: null },
    });
  });

  it('creates the singleton first when updating before any row exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockTenantFind.mockResolvedValue({ name: 'Acme Tours' });
    mockCreate.mockResolvedValue({ id: 'org-new' });
    mockUpdate.mockResolvedValue({ id: 'org-new', companyName: 'X' });

    await inAcme(() => updateSingleton({ companyName: 'X' }, 'user-1'));

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-new' },
      data: { companyName: 'X', updatedById: 'user-1' },
    });
  });
});

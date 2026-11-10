import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../db/client.js', () => {
  const client = {
    organizationSettings: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
    },
  };
  return { default: client, identityPrisma: client };
});

import { getOrCreateSingleton, updateSingleton } from '../organizationSettings.service.js';

describe('getOrCreateSingleton', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCreate.mockReset();
  });

  it('returns the existing row when one is already present', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });

    const settings = await getOrCreateSingleton();

    expect(settings.id).toBe('org-1');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a new row seeded from Prisma column defaults when none exists', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'org-new', companyName: 'Travel CRM' });

    const settings = await getOrCreateSingleton();

    expect(settings.id).toBe('org-new');
    expect(mockCreate).toHaveBeenCalledWith({ data: {} });
  });
});

describe('updateSingleton', () => {
  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  it('merges only whitelisted fields onto the existing singleton', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Old Name' });
    mockUpdate.mockResolvedValue({ id: 'org-1', companyName: 'New Name' });

    await updateSingleton({ companyName: 'New Name', id: 'attacker-supplied-id', notAField: true }, 'user-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { companyName: 'New Name', updatedById: 'user-1' },
    });
  });

  it('records updatedById as null when no acting user is supplied', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1' });
    mockUpdate.mockResolvedValue({ id: 'org-1' });

    await updateSingleton({ companyName: 'X' });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { companyName: 'X', updatedById: null },
    });
  });

  it('creates the singleton first when updating before any row exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValue({ id: 'org-new' });
    mockUpdate.mockResolvedValue({ id: 'org-new', companyName: 'X' });

    await updateSingleton({ companyName: 'X' }, 'user-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-new' },
      data: { companyName: 'X', updatedById: 'user-1' },
    });
  });
});

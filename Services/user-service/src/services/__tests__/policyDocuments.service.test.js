import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany, mockFindUnique, mockCreate, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../db/client.js', () => {
  const client = {
    policyDocument: {
      findMany: mockFindMany,
      findUnique: mockFindUnique,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    },
  };
  return { default: client, identityPrisma: client };
});

import {
  listPolicyDocuments, getPolicyDocumentById, createPolicyDocument, updatePolicyDocument, deletePolicyDocument,
} from '../policyDocuments.service.js';

beforeEach(() => {
  mockFindMany.mockReset();
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
});

describe('listPolicyDocuments', () => {
  it('lists documents ordered by title', async () => {
    mockFindMany.mockResolvedValue([{ id: 'doc-1', title: 'Refunds' }]);
    const result = await listPolicyDocuments();
    expect(mockFindMany).toHaveBeenCalledWith({ orderBy: { title: 'asc' } });
    expect(result).toEqual([{ id: 'doc-1', title: 'Refunds' }]);
  });
});

describe('getPolicyDocumentById', () => {
  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await getPolicyDocumentById('missing')).toBeNull();
  });
});

describe('createPolicyDocument', () => {
  it('creates a document and stamps updatedById', async () => {
    mockCreate.mockResolvedValue({ id: 'doc-1', title: 'Refunds', body: 'Full refunds within 24h.' });
    const result = await createPolicyDocument({ title: 'Refunds', body: 'Full refunds within 24h.' }, 'admin-1');

    expect(mockCreate).toHaveBeenCalledWith({
      data: { title: 'Refunds', body: 'Full refunds within 24h.', updatedById: 'admin-1' },
    });
    expect(result.id).toBe('doc-1');
  });
});

describe('updatePolicyDocument', () => {
  it('only updates the fields present in the partial update', async () => {
    mockUpdate.mockResolvedValue({ id: 'doc-1', title: 'Refund Policy' });
    await updatePolicyDocument('doc-1', { title: 'Refund Policy' }, 'admin-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { title: 'Refund Policy', updatedById: 'admin-1' },
    });
  });
});

describe('deletePolicyDocument', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValue({ id: 'doc-1' });
    await deletePolicyDocument('doc-1');
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });
});

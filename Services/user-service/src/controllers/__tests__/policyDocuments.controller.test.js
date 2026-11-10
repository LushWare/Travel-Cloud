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
  getPolicyDocuments, getPolicyDocument, postPolicyDocument, putPolicyDocument,
  deletePolicyDocumentHandler, getInternalPolicyDocuments,
} from '../policyDocuments.controller.js';

const VALID_ID = 'a0000000-0000-4000-8000-000000000001';

function buildReqRes({ body = {}, params = {}, user = { id: 'admin-1', role: 'admin' } } = {}) {
  const req = { body, params, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockFindUnique.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
});

describe('getPolicyDocuments', () => {
  it('returns every document wrapped in the standard envelope', async () => {
    mockFindMany.mockResolvedValue([{ id: 'doc-1', title: 'Refunds' }]);
    const { req, res, next } = buildReqRes();

    await getPolicyDocuments(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { documents: [{ id: 'doc-1', title: 'Refunds' }] } });
  });
});

describe('getPolicyDocument', () => {
  it('returns 404 via next(AppError) when not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: VALID_ID } });

    await getPolicyDocument(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('postPolicyDocument', () => {
  it('rejects an empty title with a 400 AppError instead of touching the DB', async () => {
    const { req, res, next } = buildReqRes({ body: { title: '', body: 'text' } });

    await postPolicyDocument(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a document and stamps updatedById from the acting admin', async () => {
    mockCreate.mockResolvedValue({ id: 'doc-1', title: 'Refunds', body: 'Full refunds within 24h.' });
    const { req, res, next } = buildReqRes({ body: { title: 'Refunds', body: 'Full refunds within 24h.' }, user: { id: 'admin-42', role: 'admin' } });

    await postPolicyDocument(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith({
      data: { title: 'Refunds', body: 'Full refunds within 24h.', updatedById: 'admin-42' },
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('putPolicyDocument', () => {
  it('returns 404 when the document does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: VALID_ID }, body: { title: 'New title' } });

    await putPolicyDocument(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('persists a valid partial update', async () => {
    mockFindUnique.mockResolvedValue({ id: VALID_ID, title: 'Old title' });
    mockUpdate.mockResolvedValue({ id: VALID_ID, title: 'New title' });
    const { req, res, next } = buildReqRes({ params: { id: VALID_ID }, body: { title: 'New title' } });

    await putPolicyDocument(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: VALID_ID }, data: { title: 'New title', updatedById: 'admin-1' } });
  });
});

describe('deletePolicyDocumentHandler', () => {
  it('returns 404 when the document does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: VALID_ID } });

    await deletePolicyDocumentHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes an existing document', async () => {
    mockFindUnique.mockResolvedValue({ id: VALID_ID });
    const { req, res, next } = buildReqRes({ params: { id: VALID_ID } });

    await deletePolicyDocumentHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: VALID_ID } });
  });
});

describe('getInternalPolicyDocuments', () => {
  it('returns every document (token auth already enforced by the route middleware)', async () => {
    mockFindMany.mockResolvedValue([{ id: 'doc-1', title: 'Refunds', body: 'Full refunds within 24h.' }]);
    const { req, res, next } = buildReqRes();

    await getInternalPolicyDocuments(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { documents: [{ id: 'doc-1', title: 'Refunds', body: 'Full refunds within 24h.' }] },
    });
  });
});

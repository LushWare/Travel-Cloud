import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockFindMany, mockCount, mockCreate, mockUpdate, mockDelete, mockGroupBy } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockGroupBy: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    user: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      count: mockCount,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      groupBy: mockGroupBy,
    },
  },
}));

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
}));

import bcrypt from 'bcryptjs';
import {
  getCurrentUserProfile, updateCurrentUserProfile, getAllUsers, getUser, createUser,
  updateUser, updateUserPassword, deleteUser, toggleUserStatus, getUsersByRole,
  assignUserRole, getUserStats,
} from '../user.controller.js';

const ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR = { id: '22222222-2222-4222-8222-222222222222', role: 'admin' };

function buildReqRes({ body = {}, params = {}, query = {}, user = ACTOR } = {}) {
  const req = { body, params, query, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockFindMany.mockReset();
  mockCount.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockGroupBy.mockReset();
});

describe('getCurrentUserProfile', () => {
  it('returns the acting user without the password field', async () => {
    mockFindUnique.mockResolvedValue({ id: ACTOR.id, name: 'Alice', password: 'hash' });
    const { req, res, next } = buildReqRes();

    await getCurrentUserProfile(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { user: { id: ACTOR.id, name: 'Alice' } } });
  });

  it('returns 404 when the user no longer exists', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes();

    await getCurrentUserProfile(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('updateCurrentUserProfile', () => {
  it('updates name and phone', async () => {
    mockUpdate.mockResolvedValue({ id: ACTOR.id, name: 'New Name', phone: '+94770000000' });
    const { req, res, next } = buildReqRes({ body: { name: 'New Name', phone: '+94770000000' } });

    await updateCurrentUserProfile(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: ACTOR.id },
      data: { name: 'New Name', phone: '+94770000000' },
    });
  });

  it('rejects an unrecognized field with 400 and does not touch the DB', async () => {
    const { req, res, next } = buildReqRes({ body: { role: 'admin' } });

    await updateCurrentUserProfile(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('updates the email field', async () => {
    mockUpdate.mockResolvedValue({ id: ACTOR.id, name: 'New Name', email: 'new@example.com', phone: '+94770000000' });
    const { req, res, next } = buildReqRes({
      body: { name: 'New Name', email: 'new@example.com', phone: '+94770000000' },
    });

    await updateCurrentUserProfile(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: ACTOR.id },
      data: { name: 'New Name', email: 'new@example.com', phone: '+94770000000' },
    });
  });

  it('maps a duplicate-email conflict (P2002) to a 400 error', async () => {
    mockUpdate.mockRejectedValue({ code: 'P2002' });
    const { req, res, next } = buildReqRes({ body: { email: 'taken@example.com' } });

    await updateCurrentUserProfile(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getAllUsers', () => {
  it('returns a flat array in data and pagination at the top level', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, name: 'Bob', password: 'hash' }]);
    mockCount.mockResolvedValue(1);
    const { req, res, next } = buildReqRes({ query: { page: '1', limit: '10' } });

    await getAllUsers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: [{ id: ID, name: 'Bob' }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });
  });

  it('filters by role, isActive, and search', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const { req, res, next } = buildReqRes({ query: { role: 'vendor', isActive: 'true', search: 'sun' } });

    await getAllUsers(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        role: 'vendor',
        isActive: true,
        OR: [
          { name: { contains: 'sun', mode: 'insensitive' } },
          { email: { contains: 'sun', mode: 'insensitive' } },
        ],
      },
    }));
  });

  it('filters by a bounded list of opaque record IDs', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    const firstRecordId = 'customer-legacy-A';
    const secondRecordId = 'customer-legacy-B';
    const { req, res, next } = buildReqRes({ query: { role: 'customer', ids: `${firstRecordId},${secondRecordId}` } });

    await getAllUsers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: 'customer', id: { in: [firstRecordId, secondRecordId] } },
    }));
  });

  it('rejects more than 100 IDs before querying users', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `customer-${index}`).join(',');
    const { req, res, next } = buildReqRes({ query: { ids } });

    await getAllUsers(req, res, next);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an invalid role filter with 400', async () => {
    const { req, res, next } = buildReqRes({ query: { role: 'ceo' } });

    await getAllUsers(req, res, next);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getUser', () => {
  it('returns 404 when not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('rejects a non-UUID id with 400 before hitting the DB', async () => {
    const { req, res, next } = buildReqRes({ params: { id: 'not-a-uuid' } });

    await getUser(req, res, next);

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('createUser', () => {
  const valid = { name: 'New User', email: 'new@test.com', role: 'customer' };

  it('creates a user with a generated temp password when none is supplied', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: ID, name: 'New User', email: 'new@test.com', role: 'customer', password: 'hashed-password' });
    const { req, res, next } = buildReqRes({ body: valid });

    await createUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isTempPassword: true, mustChangePassword: true, createdById: ACTOR.id }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.user.password).toBeUndefined();
    expect(payload.data.tempPassword).toBeTruthy();
  });

  it('does not return a tempPassword when the caller supplied a password', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: ID, name: 'New User', email: 'new@test.com', role: 'customer', password: 'hashed-password' });
    const { req, res, next } = buildReqRes({ body: { ...valid, password: 'explicitpass' } });

    await createUser(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isTempPassword: false, mustChangePassword: false }),
    }));
    expect(res.json.mock.calls[0][0].data.tempPassword).toBeUndefined();
  });

  it('rejects a duplicate email with 400 and does not create', async () => {
    mockFindUnique.mockResolvedValue({ id: 'existing' });
    const { req, res, next } = buildReqRes({ body: valid });

    await createUser(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an invalid payload before ever checking for a duplicate email', async () => {
    const { req, res, next } = buildReqRes({ body: { name: '', email: 'bad', role: 'customer' } });

    await createUser(req, res, next);

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateUser', () => {
  it('updates the provided fields only', async () => {
    mockUpdate.mockResolvedValue({ id: ID, name: 'Updated', password: 'hash' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'Updated' } });

    await updateUser(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { name: 'Updated' } });
    expect(res.json.mock.calls[0][0].data.user.password).toBeUndefined();
  });
});

describe('updateUserPassword', () => {
  it('hashes and stores the new password, clearing temp-password flags', async () => {
    mockUpdate.mockResolvedValue({ id: ID, password: 'hashed-password' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { password: 'newpassword' } });

    await updateUserPassword(req, res, next);

    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword', 12);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: ID },
      data: expect.objectContaining({ password: 'hashed-password', mustChangePassword: false, isTempPassword: false }),
    });
  });
});

describe('deleteUser', () => {
  it('deletes when canBeDeleted is true', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, canBeDeleted: true });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteUser(req, res, next);

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: ID } });
    expect(res.json).toHaveBeenCalledWith({ status: 'success', message: 'User deleted', data: {} });
  });

  it('returns 403 and does not delete when canBeDeleted is false', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, canBeDeleted: false });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteUser(req, res, next);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('returns 404 when the user does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteUser(req, res, next);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('toggleUserStatus', () => {
  it('flips isActive from true to false', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, isActive: true });
    mockUpdate.mockResolvedValue({ id: ID, isActive: false });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await toggleUserStatus(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { isActive: false } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'User deactivated' }));
  });

  it('returns 404 when the user does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await toggleUserStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('getUsersByRole', () => {
  it('returns users for a valid role', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, name: 'Rep', password: 'hash' }]);
    const { req, res, next } = buildReqRes({ params: { role: 'salesRep' } });

    await getUsersByRole(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith({ where: { role: 'salesRep' }, orderBy: { name: 'asc' } });
    expect(res.json).toHaveBeenCalledWith({ status: 'success', count: 1, data: [{ id: ID, name: 'Rep' }] });
  });

  it('rejects an unknown role param with 400', async () => {
    const { req, res, next } = buildReqRes({ params: { role: 'ceo' } });

    await getUsersByRole(req, res, next);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('assignUserRole', () => {
  it('updates the role', async () => {
    mockUpdate.mockResolvedValue({ id: ID, role: 'vendor' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { role: 'vendor' } });

    await assignUserRole(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { role: 'vendor' } });
  });
});

describe('getUserStats', () => {
  it('returns total/active/inactive/byRole', async () => {
    mockCount.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    mockGroupBy.mockResolvedValue([{ role: 'customer', _count: 8 }, { role: 'admin', _count: 2 }]);
    const { req, res, next } = buildReqRes();

    await getUserStats(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { total: 10, active: 7, inactive: 3, byRole: [{ role: 'customer', _count: 8 }, { role: 'admin', _count: 2 }] },
    });
  });
});

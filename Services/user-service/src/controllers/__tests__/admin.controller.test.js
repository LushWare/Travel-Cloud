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


// Target lookups go through findFirst; unless a test stubs findUnique, the target is an ordinary staff account.
const defaultTarget = (args) => ({ id: args?.where?.id, role: args?.where?.role || 'salesRep', canBeDeleted: true, isActive: true });
const mockFindFirst = vi.fn();
const resetFindFirst = () => mockFindFirst.mockReset().mockImplementation(async (args) =>
  (mockFindUnique.getMockImplementation() ? mockFindUnique(args) : defaultTarget(args)));

vi.mock('../../db/client.js', () => {
  const client = {
    user: {
      findUnique: mockFindUnique,
      findFirst: (...args) => mockFindFirst(...args),
      findMany: mockFindMany,
      count: mockCount,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      groupBy: mockGroupBy,
    },
  };
  return { default: client, identityPrisma: client };
});

import {
  getDashboardStats, getAllUsers, getUserById, createStaff, updateUser, deleteUser,
  updateUserStatus, getAdminPermissions, updateAdminPermissions,
  getAvailablePermissions, getSuperAdminInfo, listSuperAdmins, promoteSuperAdmin, demoteSuperAdmin,
} from '../admin.controller.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = { id: '22222222-2222-4222-8222-222222222222', role: 'admin', tenantId: '00000000-0000-4000-8000-000000000001' };

function buildReqRes({ body = {}, params = {}, query = {}, user = ACTOR } = {}) {
  const req = { body, params, query, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  resetFindFirst();
  mockFindUnique.mockReset();
  mockFindMany.mockReset();
  mockCount.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockGroupBy.mockReset();
});

describe('getDashboardStats', () => {
  it('aggregates total/active/inactive/byRole/recentUsers', async () => {
    mockCount.mockResolvedValueOnce(5).mockResolvedValueOnce(4);
    mockGroupBy.mockResolvedValue([{ role: 'customer', _count: 5 }]);
    mockFindMany.mockResolvedValue([{ id: ID, name: 'Recent' }]);
    const { req, res, next } = buildReqRes();

    await getDashboardStats(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { total: 5, active: 4, inactive: 1, byRole: [{ role: 'customer', _count: 5 }], recentUsers: [{ id: ID, name: 'Recent' }] },
    });
  });
});

describe('getAllUsers', () => {
  it('returns a flat array with top-level pagination', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, password: 'hash' }]);
    mockCount.mockResolvedValue(1);
    const { req, res, next } = buildReqRes();

    await getAllUsers(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: [{ id: ID }],
      pagination: { total: 1, page: 1, limit: 10, pages: 1 },
    });
  });
});

describe('getUserById', () => {
  it('returns 404 when not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getUserById(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('createStaff', () => {
  const valid = { name: 'New Admin', email: 'newadmin@test.com', role: 'admin' };

  it('creates staff that must set a password, without returning one', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: ID, name: 'New Admin', password: 'hashed' });
    const { req, res, next } = buildReqRes({ body: { ...valid, permissions: ['manage_leads'] } });

    await createStaff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ permissions: ['manage_leads'], isTempPassword: true, mustChangePassword: true }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.tempPassword).toBeUndefined();
  });

  it('rejects a permissions entry that is not on the allowed list at the validation layer', async () => {
    const { req, res, next } = buildReqRes({ body: { ...valid, permissions: ['not_a_real_permission'] } });

    await createStaff(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a duplicate email', async () => {
    mockFindUnique.mockResolvedValue({ id: 'existing' });
    const { req, res, next } = buildReqRes({ body: valid });

    await createStaff(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('updateUser', () => {
  it('filters the permissions array through the allowed list on update', async () => {
    mockUpdate.mockResolvedValue({ id: ID, permissions: ['manage_vendors'] });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { permissions: ['manage_vendors'] } });

    await updateUser(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: ID },
      data: { permissions: ['manage_vendors'] },
    });
  });
});

describe('deleteUser', () => {
  it('returns 403 when canBeDeleted is false', async () => {
    mockFindUnique.mockResolvedValue({ id: ID, canBeDeleted: false });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await deleteUser(req, res, next);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});

describe('updateUserStatus', () => {
  it('sets isActive explicitly', async () => {
    mockUpdate.mockResolvedValue({ id: ID, isActive: false });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { isActive: false } });

    await updateUserStatus(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { isActive: false } });
  });

  it('rejects a missing isActive with 400', async () => {
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: {} });

    await updateUserStatus(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('super admin protection', () => {
  const NORMAL_ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'admin', isSuperAdmin: false };
  const SUPER = { id: '88888888-8888-4888-8888-888888888888', role: 'superAdmin', isSuperAdmin: true, tenantId: '00000000-0000-4000-8000-000000000001' };
  const valid = { name: 'New Admin', email: 'newadmin@test.com', role: 'admin' };
  const superTarget = () => mockFindFirst.mockResolvedValue({ id: ID, role: 'superAdmin', isSuperAdmin: true, canBeDeleted: true });

  it('stops a normal admin from creating a super admin', async () => {
    const { req, res, next } = buildReqRes({ body: { ...valid, role: 'superAdmin' }, user: NORMAL_ADMIN });

    await createStaff(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('lets a super admin create a super admin', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: ID, role: 'superAdmin' });
    const { req, res, next } = buildReqRes({ body: { ...valid, role: 'superAdmin' }, user: SUPER });

    await createStaff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('stops a normal admin from promoting anyone to super admin', async () => {
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { role: 'superAdmin' }, user: NORMAL_ADMIN });

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stops a normal admin from editing a super admin', async () => {
    superTarget();
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'Taken over' }, user: NORMAL_ADMIN });

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stops a normal admin from deactivating a super admin', async () => {
    superTarget();
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { isActive: false }, user: NORMAL_ADMIN });

    await updateUserStatus(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('stops a normal admin from deleting a super admin', async () => {
    superTarget();
    const { req, res, next } = buildReqRes({ params: { id: ID }, user: NORMAL_ADMIN });

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('stops a normal admin from changing a super admin\'s permissions', async () => {
    superTarget();
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { permissions: [] }, user: NORMAL_ADMIN });

    await updateAdminPermissions(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('stops an admin from changing their own role', async () => {
    const { req, res, next } = buildReqRes({ params: { id: NORMAL_ADMIN.id }, body: { role: 'admin' }, user: NORMAL_ADMIN });

    await updateUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('stops an admin from deleting their own account', async () => {
    const { req, res, next } = buildReqRes({ params: { id: NORMAL_ADMIN.id }, user: NORMAL_ADMIN });

    await deleteUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('lets a super admin edit another super admin', async () => {
    superTarget();
    mockUpdate.mockResolvedValue({ id: ID, name: 'Renamed' });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { name: 'Renamed' }, user: SUPER });

    await updateUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe('getAdminPermissions', () => {
  it('returns permissions and role', async () => {
    mockFindUnique.mockResolvedValue({ permissions: ['manage_leads'], role: 'admin' });
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getAdminPermissions(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { permissions: ['manage_leads'], role: 'admin' } });
  });

  it('returns 404 when the user does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);
    const { req, res, next } = buildReqRes({ params: { id: ID } });

    await getAdminPermissions(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('updateAdminPermissions', () => {
  it('clears permissions to an empty array when the body omits the field', async () => {
    mockUpdate.mockResolvedValue({ id: ID, permissions: [] });
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: {} });

    await updateAdminPermissions(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { permissions: [] } });
  });

  it('rejects an unknown permission string', async () => {
    const { req, res, next } = buildReqRes({ params: { id: ID }, body: { permissions: ['hack_the_mainframe'] } });

    await updateAdminPermissions(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('getAvailablePermissions', () => {
  it('returns the canonical permission list', async () => {
    const { req, res, next } = buildReqRes();

    await getAvailablePermissions(req, res, next);

    const permissions = res.json.mock.calls[0][0].data.permissions;
    expect(permissions).toContain('manage_users');
    expect(permissions).toContain('manage_admins');
  });
});

describe('getSuperAdminInfo', () => {
  it('returns the acting user', async () => {
    mockFindUnique.mockResolvedValue({ id: ACTOR.id, role: 'superAdmin', password: 'hash' });
    const { req, res, next } = buildReqRes();

    await getSuperAdminInfo(req, res, next);

    expect(res.json.mock.calls[0][0].data.user.password).toBeUndefined();
  });
});

describe('listSuperAdmins', () => {
  it('lists only superAdmin-role users', async () => {
    mockFindMany.mockResolvedValue([{ id: ID, role: 'superAdmin' }]);
    const { req, res, next } = buildReqRes();

    await listSuperAdmins(req, res, next);

    expect(mockFindMany).toHaveBeenCalledWith({ where: { role: 'superAdmin' } });
  });
});

describe('promoteSuperAdmin', () => {
  it('sets role and isSuperAdmin flag', async () => {
    mockUpdate.mockResolvedValue({ id: ID, role: 'superAdmin', isSuperAdmin: true });
    const { req, res, next } = buildReqRes({ body: { userId: ID } });

    await promoteSuperAdmin(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { role: 'superAdmin', isSuperAdmin: true } });
  });

  it('rejects a non-UUID userId', async () => {
    const { req, res, next } = buildReqRes({ body: { userId: 'nope' } });

    await promoteSuperAdmin(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('demoteSuperAdmin', () => {
  it('reverts role and isSuperAdmin flag', async () => {
    mockUpdate.mockResolvedValue({ id: ID, role: 'admin', isSuperAdmin: false });
    const { req, res, next } = buildReqRes({ body: { userId: ID } });

    await demoteSuperAdmin(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ID }, data: { role: 'admin', isSuperAdmin: false } });
  });
});

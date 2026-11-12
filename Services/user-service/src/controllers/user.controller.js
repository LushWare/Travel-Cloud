import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma, { identityPrisma } from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { idParamSchema, formatZodError } from '../validators/common.js';
import {
  createUserSchema, updateUserSchema, updateCurrentUserProfileSchema,
  assignUserRoleSchema, listUsersQuerySchema,
} from '../validators/user.validator.js';
import { z } from 'zod';
import { USER_ROLES } from '../validators/common.js';
import {
  agencyMemberWhere, assertMayGrantRole, assertNotSelf, changeAccess, findManageableUser, newMembership,
  removeAccess, withAgencyAccess, auditStaffCreated,
} from '../utils/accountGuard.js';
import { audit } from '../utils/audit.js';
import { withStaffSeat } from '../services/plan.service.js';

const roleParamSchema = z.object({ role: z.enum(USER_ROLES) });

const safeUser = (u) => {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
};

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  return parsed.data;
}

export const getCurrentUserProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { vendorProfile: true } });
  if (!user) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const updateCurrentUserProfile = asyncHandler(async (req, res) => {
  const { name, email, phone } = parseOrThrow(updateCurrentUserProfileSchema, req.body);
  let user;
  try {
    user = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(name && { name }), ...(email && { email }), ...(phone !== undefined && { phone }) },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      throw new AppError('A user with this email already exists', 400);
    }
    throw error;
  }
  // A login email change is a classic account-takeover step, so it is always recorded.
  if (email && email !== req.user.email) {
    await audit(req, { action: 'account.email_changed', targetType: 'user', targetId: req.user.id, summary: `Changed own login email to ${email}` });
  }
  res.json({ status: 'success', message: 'Profile updated', data: { user: safeUser(user) } });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search, isActive, ids } = parseOrThrow(listUsersQuerySchema, req.query);
  const where = { ...agencyMemberWhere({ role, isActive: isActive === undefined ? undefined : isActive === 'true' }) };
  if (ids) where.id = { in: ids.split(',') };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: { vendorProfile: true } }),
    prisma.user.count({ where }),
  ]);
  res.json({
    status: 'success',
    data: (await withAgencyAccess(users)).map(safeUser),
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = await prisma.user.findFirst({ where: { id }, include: { vendorProfile: true } });
  if (!user) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, phone, role, password } = parseOrThrow(createUserSchema, req.body);
  assertMayGrantRole(req.user, role);

  const existing = await identityPrisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('User with this email already exists', 400);

  const tempPassword = password || crypto.randomBytes(8).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  const create = (client) => client.user.create({
    data: {
      name,
      email,
      phone: phone || null,
      password: hashedPassword,
      role,
      createdById: req.user.id,
      isTempPassword: !password,
      mustChangePassword: !password,
      // Website customers are not agency staff; an admin who set the password needs no invitation.
      ...(role !== 'customer' && { memberships: newMembership(req.user, role, [], { active: Boolean(password) }) }),
    },
  });
  const user = role === 'customer' ? await create(prisma) : await withStaffSeat(create);

  if (role !== 'customer') await auditStaffCreated(req, user, role);

  res.status(201).json({
    status: 'success',
    message: 'User created successfully',
    data: { user: safeUser(user) },
  });
});

// Name and phone belong to the person's account; role, permissions and status to this agency.
export const updateUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { name, phone, role, isActive, permissions } = parseOrThrow(updateUserSchema, req.body);
  const target = await findManageableUser(req.user, id);
  if (role || isActive !== undefined || permissions) assertNotSelf(req.user, id);
  assertMayGrantRole(req.user, role);
  await changeAccess(target, { role, isActive, permissions }, req);
  const user = name || phone !== undefined
    ? await prisma.user.update({ where: { id }, data: { ...(name && { name }), ...(phone !== undefined && { phone }) } })
    : await prisma.user.findFirst({ where: { id } });
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const target = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  if (!target.canBeDeleted) throw new AppError('This user cannot be deleted', 403);
  await removeAccess(target, req);
  res.json({ status: 'success', message: 'User deleted', data: {} });
});

export const toggleUserStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const target = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  const current = await withAgencyAccess(target);
  await changeAccess(target, { isActive: !current.isActive }, req);
  const updated = await withAgencyAccess(await prisma.user.findFirst({ where: { id } }));
  res.json({ status: 'success', message: `User ${updated.isActive ? 'activated' : 'deactivated'}`, data: { user: safeUser(updated) } });
});

export const getUsersByRole = asyncHandler(async (req, res) => {
  const { role } = parseOrThrow(roleParamSchema, req.params);
  const users = await prisma.user.findMany({
    where: agencyMemberWhere({ role }),
    orderBy: { name: 'asc' },
  });
  res.json({ status: 'success', count: users.length, data: (await withAgencyAccess(users)).map(safeUser) });
});

export const assignUserRole = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { role } = parseOrThrow(assignUserRoleSchema, req.body);
  const target = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  assertMayGrantRole(req.user, role);
  await changeAccess(target, { role }, req);
  const user = await withAgencyAccess(await prisma.user.findFirst({ where: { id } }));
  res.json({ status: 'success', message: 'Role updated', data: { user: safeUser(user) } });
});

export const getUserStats = asyncHandler(async (req, res) => {
  const [byRole, active, suspended] = await Promise.all([
    prisma.membership.groupBy({ by: ['role'], _count: true }),
    prisma.membership.count({ where: { status: { in: ['active', 'invited'] } } }),
    prisma.membership.count({ where: { status: 'suspended' } }),
  ]);
  res.json({ status: 'success', data: { total: active + suspended, active, inactive: suspended, byRole } });
});

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OrganizationSettingsUpdate } from '@travel-crm/contracts';
import prisma, { identityPrisma } from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrCreateSingleton, updateSingleton } from '../services/organizationSettings.service.js';
import { assertMayGrantRole, assertNotSelf, findManageableUser, newMembership } from '../utils/accountGuard.js';
import { idParamSchema, formatZodError, AVAILABLE_PERMISSIONS } from '../validators/common.js';
import {
  createStaffSchema, updateUserSchema, updateUserStatusSchema, updateAdminPermissionsSchema,
  listUsersQuerySchema, promoteSuperAdminSchema, demoteSuperAdminSchema,
} from '../validators/admin.validator.js';

const safeUser = (u) => { if (!u) return null; const { password, ...r } = u; return r; };

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  return parsed.data;
}

export const getDashboardStats = asyncHandler(async (req, res) => {
  const [total, byRole, active, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, email: true, role: true, createdAt: true } }),
  ]);
  res.json({ status: 'success', data: { total, active, inactive: total - active, byRole, recentUsers } });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search, isActive } = parseOrThrow(listUsersQuerySchema, req.query);
  const where = {};
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);
  res.json({ status: 'success', data: users.map(safeUser), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

export const getUserById = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = await prisma.user.findUnique({ where: { id }, include: { vendorProfile: true } });
  if (!user) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { user: safeUser(user) } });
});

export const createStaff = asyncHandler(async (req, res) => {
  const { name, email, phone, role, permissions = [] } = parseOrThrow(createStaffSchema, req.body);
  assertMayGrantRole(req.user, role);

  const existing = await identityPrisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('User with this email already exists', 400);

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  const user = await prisma.user.create({
    data: {
      name, email, phone: phone || null,
      password: hashedPassword, role,
      permissions: permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p)),
      createdById: req.user.id,
      isTempPassword: true, mustChangePassword: true,
      memberships: newMembership(req.user, role, permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p))),
    },
  });

  res.status(201).json({ status: 'success', message: 'Staff created', data: { user: safeUser(user) } });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { name, phone, role, isActive, permissions } = parseOrThrow(updateUserSchema, req.body);
  await findManageableUser(req.user, id);
  if (role || isActive !== undefined || permissions) assertNotSelf(req.user, id);
  assertMayGrantRole(req.user, role);
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(name && { name }), ...(phone !== undefined && { phone }),
      ...(role && { role }), ...(isActive !== undefined && { isActive }),
      ...(permissions && { permissions: permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p)) }),
    },
  });
  res.json({ status: 'success', data: { user: safeUser(user) } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  if (!user.canBeDeleted) throw new AppError('This user cannot be deleted', 403);
  await prisma.user.delete({ where: { id } });
  res.json({ status: 'success', data: {} });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { isActive } = parseOrThrow(updateUserStatusSchema, req.body);
  await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  const user = await prisma.user.update({ where: { id }, data: { isActive } });
  res.json({ status: 'success', data: { user: safeUser(user) } });
});

export const getAdminPermissions = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = await prisma.user.findUnique({ where: { id }, select: { permissions: true, role: true } });
  if (!user) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { permissions: user.permissions, role: user.role } });
});

export const updateAdminPermissions = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { permissions } = parseOrThrow(updateAdminPermissionsSchema, req.body);
  await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  const user = await prisma.user.update({
    where: { id },
    data: { permissions },
  });
  res.json({ status: 'success', data: { user: safeUser(user) } });
});

export const getAvailablePermissions = asyncHandler(async (req, res) => {
  res.json({ status: 'success', data: { permissions: AVAILABLE_PERMISSIONS } });
});

export const getSuperAdminInfo = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({ status: 'success', data: { user: safeUser(user) } });
});

export const listSuperAdmins = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ where: { role: 'superAdmin' } });
  res.json({ status: 'success', data: users.map(safeUser) });
});

export const promoteSuperAdmin = asyncHandler(async (req, res) => {
  const { userId } = parseOrThrow(promoteSuperAdminSchema, req.body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: 'superAdmin', isSuperAdmin: true },
  });
  res.json({ status: 'success', message: 'User promoted to superAdmin', data: { user: safeUser(user) } });
});

export const demoteSuperAdmin = asyncHandler(async (req, res) => {
  const { userId } = parseOrThrow(demoteSuperAdminSchema, req.body);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: 'admin', isSuperAdmin: false },
  });
  res.json({ status: 'success', message: 'SuperAdmin demoted to admin', data: { user: safeUser(user) } });
});

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSingleton();
  res.json({ status: 'success', data: { settings } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const parsed = OrganizationSettingsUpdate.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const settings = await updateSingleton(parsed.data, req.user.id);
  res.json({ status: 'success', message: 'Settings updated', data: { settings } });
});

// Token-authenticated (see admin.routes.js) — includes bank details, unlike
// the public-facing surface this data would otherwise need on a customer site.
export const getInternalOrganizationSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSingleton();
  res.json({ status: 'success', data: { settings } });
});

// Any logged-in Management user (not just admin/superAdmin) — the sidebar
// shows the company name/logo to every role, and salesRep needs the invoice
// payment terms/instructions defaults to prefill the invoice dialog. Narrow,
// display-only subset: no bank details, no quotation config, nothing an
// admin edits via /settings that isn't also mailed straight to customers.
export const getOrganizationBranding = asyncHandler(async (req, res) => {
  const { companyName, companyShortName, tagline, logoUrl, invoicePaymentTerms, invoicePaymentInstructions } = await getOrCreateSingleton();
  res.json({
    status: 'success',
    data: { branding: { companyName, companyShortName, tagline, logoUrl, invoicePaymentTerms, invoicePaymentInstructions } },
  });
});

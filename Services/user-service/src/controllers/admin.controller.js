import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OrganizationSettingsUpdate } from '@travel-crm/contracts';
import prisma, { identityPrisma } from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrCreateSingleton, updateSingleton, changedSettingsFields, BANK_FIELDS } from '../services/organizationSettings.service.js';
import {
  agencyMemberWhere, assertMayGrantRole, assertNotSelf, changeAccess, findManageableUser, newMembership,
  removeAccess, withAgencyAccess, auditStaffCreated,
} from '../utils/accountGuard.js';
import { audit } from '../utils/audit.js';
import { idParamSchema, formatZodError, AVAILABLE_PERMISSIONS } from '../validators/common.js';
import { currentUsage, getCurrentTenantEntitlements } from '../../../shared/tenancy/src/index.js';
import logger from '../config/logger.js';
import { withStaffSeat } from '../services/plan.service.js';
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
  const [byRole, active, suspended, recentUsers] = await Promise.all([
    prisma.membership.groupBy({ by: ['role'], _count: true }),
    prisma.membership.count({ where: { status: { in: ['active', 'invited'] } } }),
    prisma.membership.count({ where: { status: 'suspended' } }),
    prisma.user.findMany({ where: agencyMemberWhere(), orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, email: true, role: true, createdAt: true } }),
  ]);
  res.json({
    status: 'success',
    data: { total: active + suspended, active, inactive: suspended, byRole, recentUsers: await withAgencyAccess(recentUsers) },
  });
});

export const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, role, search, isActive } = parseOrThrow(listUsersQuerySchema, req.query);
  const where = { ...agencyMemberWhere({ role, isActive: isActive === undefined ? undefined : isActive === 'true' }) };
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.user.count({ where }),
  ]);
  res.json({ status: 'success', data: (await withAgencyAccess(users)).map(safeUser), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

export const getUserById = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const user = await prisma.user.findFirst({ where: { id }, include: { vendorProfile: true } });
  if (!user) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const createStaff = asyncHandler(async (req, res) => {
  const { name, email, phone, role, permissions = [] } = parseOrThrow(createStaffSchema, req.body);
  assertMayGrantRole(req.user, role);

  const existing = await identityPrisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('User with this email already exists', 400);

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, 12);

  const user = await withStaffSeat((tx) => tx.user.create({
    data: {
      name, email, phone: phone || null,
      password: hashedPassword, role,
      permissions: permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p)),
      createdById: req.user.id,
      isTempPassword: true, mustChangePassword: true,
      memberships: newMembership(req.user, role, permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p))),
    },
  }));
  await auditStaffCreated(req, user, role);

  res.status(201).json({ status: 'success', message: 'Staff created', data: { user: safeUser(user) } });
});

// Name and phone belong to the person's account; role, permissions and status to this agency.
export const updateUser = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { name, phone, role, isActive, permissions } = parseOrThrow(updateUserSchema, req.body);
  const target = await findManageableUser(req.user, id);
  if (role || isActive !== undefined || permissions) assertNotSelf(req.user, id);
  assertMayGrantRole(req.user, role);
  await changeAccess(target, {
    role, isActive,
    permissions: permissions && permissions.filter((p) => AVAILABLE_PERMISSIONS.includes(p)),
  }, req);
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
  res.json({ status: 'success', data: {} });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { isActive } = parseOrThrow(updateUserStatusSchema, req.body);
  const target = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  await changeAccess(target, { isActive }, req);
  const user = await prisma.user.findFirst({ where: { id } });
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const getAdminPermissions = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const membership = await prisma.membership.findFirst({ where: { userId: id }, select: { permissions: true, role: true } });
  if (!membership) throw new AppError('User not found', 404);
  res.json({ status: 'success', data: { permissions: membership.permissions, role: membership.role } });
});

export const updateAdminPermissions = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { permissions } = parseOrThrow(updateAdminPermissionsSchema, req.body);
  const target = await findManageableUser(req.user, id);
  assertNotSelf(req.user, id);
  await changeAccess(target, { permissions }, req);
  const user = await prisma.user.findFirst({ where: { id } });
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const getAvailablePermissions = asyncHandler(async (req, res) => {
  res.json({ status: 'success', data: { permissions: AVAILABLE_PERMISSIONS } });
});

export const getSuperAdminInfo = asyncHandler(async (req, res) => {
  const user = await prisma.user.findFirst({ where: { id: req.user.id } });
  res.json({ status: 'success', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const listSuperAdmins = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ where: agencyMemberWhere({ role: 'superAdmin' }) });
  res.json({ status: 'success', data: (await withAgencyAccess(users)).map(safeUser) });
});

// "Super admin" in an agency is its owner. These only change the role within this agency.
export const promoteSuperAdmin = asyncHandler(async (req, res) => {
  const { userId } = parseOrThrow(promoteSuperAdminSchema, req.body);
  assertMayGrantRole(req.user, 'superAdmin');
  assertNotSelf(req.user, userId);
  const target = await findManageableUser(req.user, userId);
  if (!target.membership) throw new AppError('User not found', 404);
  await changeAccess(target, { role: 'superAdmin' }, req);
  const user = await prisma.user.findFirst({ where: { id: userId } });
  res.json({ status: 'success', message: 'User promoted to superAdmin', data: { user: safeUser(await withAgencyAccess(user)) } });
});

export const demoteSuperAdmin = asyncHandler(async (req, res) => {
  const { userId } = parseOrThrow(demoteSuperAdminSchema, req.body);
  assertNotSelf(req.user, userId);
  const target = await findManageableUser(req.user, userId, { role: 'superAdmin' });
  await changeAccess(target, { role: 'admin' }, req);
  const user = await prisma.user.findFirst({ where: { id: userId } });
  res.json({ status: 'success', message: 'SuperAdmin demoted to admin', data: { user: safeUser(await withAgencyAccess(user)) } });
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
  const before = await getOrCreateSingleton();
  const settings = await updateSingleton(parsed.data, req.user.id);
  const changed = changedSettingsFields(before, settings);
  const bank = changed.filter((f) => BANK_FIELDS.includes(f));
  const other = changed.filter((f) => !BANK_FIELDS.includes(f));
  // Bank details decide where customers send money, so their change is its own, easy-to-find entry.
  if (bank.length) {
    await audit(req, { action: 'settings.bank_details_changed', targetType: 'settings', summary: 'Changed bank / payment details', details: { fields: bank } });
  }
  if (other.length) {
    await audit(req, { action: 'settings.updated', targetType: 'settings', summary: `Changed organization settings: ${other.join(', ')}`.slice(0, 300), details: { fields: other } });
  }
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

export const getAgencyPlan = asyncHandler(async (_req, res) => {
  const [resolved, staffSeatsUsed, packageUsage, sends] = await Promise.all([
    getCurrentTenantEntitlements(prisma),
    prisma.membership.count({
      where: {
        role: { in: ['superAdmin', 'admin', 'salesRep', 'vendor'] },
        status: { in: ['active', 'invited'] },
      },
    }),
    prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM crm_packages."Package"`,
    // The counter table arrives with a migration; until then the screen shows zero sends.
    currentUsage(prisma).catch((err) => {
      logger.error({ err: { message: err.message, code: err.code } }, 'Could not read monthly send usage');
      return { emails: 0, whatsapp: 0 };
    }),
  ]);
  res.json({
    status: 'success',
    data: {
      ...resolved,
      usage: {
        staff_seats: staffSeatsUsed,
        packages: Number(packageUsage[0]?.count ?? 0),
        emails_per_month: sends.emails,
        whatsapp_per_month: sends.whatsapp,
      },
    },
  });
});

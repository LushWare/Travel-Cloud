import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma, { identityPrisma } from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { idParamSchema, formatZodError } from '../validators/common.js';
import {
  createSalesRepSchema, updateSalesRepSchema, updateCommissionSchema, listSalesRepsQuerySchema, DEFAULT_COMMISSION_RATE,
} from '../validators/salesRep.validator.js';
import {
  agencyMemberWhere, changeAccess, findManageableUser, newMembership, removeAccess, withAgencyAccess, auditStaffCreated,
} from '../utils/accountGuard.js';
import { audit, describePerson } from '../utils/audit.js';
import { withStaffSeat } from '../services/plan.service.js';

const findRep = (req, id) => findManageableUser(req.user, id, { role: 'salesRep', notFound: 'Sales representative not found' });

// commissionRate is a Prisma Decimal; send it as a plain number.
const safeUser = (u) => {
  if (!u) return null;
  const { password, ...r } = u;
  return { ...r, commissionRate: r.commissionRate == null ? null : Number(r.commissionRate) };
};

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  return parsed.data;
}

const asRate = (v) => (v == null ? null : Number(v));

async function auditCommission(req, rep, rate) {
  if (asRate(rep.commissionRate) === asRate(rate)) return;
  await audit(req, {
    action: 'staff.commission_changed', targetType: 'user', targetId: rep.id,
    summary: `Changed commission for ${describePerson(rep)} from ${asRate(rep.commissionRate) ?? 'none'}% to ${asRate(rate)}%`,
    details: { from: asRate(rep.commissionRate), to: asRate(rate) },
  });
}

export const getAllSalesReps = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, isActive } = parseOrThrow(listSalesRepsQuerySchema, req.query);
  const where = agencyMemberWhere({ role: 'salesRep', isActive: isActive === undefined ? undefined : isActive === 'true' });
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];
  const skip = (page - 1) * limit;
  const [reps, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
    prisma.user.count({ where }),
  ]);
  res.json({ status: 'success', data: (await withAgencyAccess(reps)).map(safeUser), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

export const getSalesRepById = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const rep = await prisma.user.findFirst({ where: { id, ...agencyMemberWhere({ role: 'salesRep' }) } });
  if (!rep) throw new AppError('Sales representative not found', 404);
  res.json({ status: 'success', data: { salesRep: safeUser(await withAgencyAccess(rep)) } });
});

export const createSalesRep = asyncHandler(async (req, res) => {
  const { name, email, phone, phoneCountry, commissionRate = DEFAULT_COMMISSION_RATE } = parseOrThrow(createSalesRepSchema, req.body);

  const existing = await identityPrisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('User with this email already exists', 400);

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hashed = await bcrypt.hash(tempPassword, 12);

  const rep = await withStaffSeat((tx) => tx.user.create({
    data: {
      name, email, phone: phone || null, ...(phoneCountry && { phoneCountry }),
      password: hashed, role: 'salesRep', commissionRate,
      createdById: req.user.id,
      isTempPassword: true, mustChangePassword: true,
      permissions: ['view_reports', 'manage_packages'],
      memberships: newMembership(req.user, 'salesRep', ['view_reports', 'manage_packages']),
    },
  }));
  await auditStaffCreated(req, rep, 'salesRep');
  res.status(201).json({ status: 'success', data: { salesRep: safeUser(rep) } });
});

export const updateSalesRep = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { name, phone, email, phoneCountry, commissionRate } = parseOrThrow(updateSalesRepSchema, req.body);
  const target = await findRep(req, id);
  // The email is the person's login in every agency they work for; only they may change it.
  if (email && email !== target.email) {
    throw new AppError("A rep's login email can't be changed here. They can change it in their own profile.", 400);
  }
  const rep = await prisma.user.update({
    where: { id },
    data: { ...(name && { name }), ...(phone !== undefined && { phone }), ...(phoneCountry && { phoneCountry }), ...(commissionRate !== undefined && { commissionRate }) },
  });
  if (commissionRate !== undefined) await auditCommission(req, target, commissionRate);
  res.json({ status: 'success', data: { salesRep: safeUser(await withAgencyAccess(rep)) } });
});

export const deleteSalesRep = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  await removeAccess(await findRep(req, id), req);
  res.json({ status: 'success', data: {} });
});

export const getSalesRepStats = asyncHandler(async (req, res) => {
  const total = await prisma.membership.count({ where: { role: 'salesRep' } });
  const active = await prisma.membership.count({ where: { role: 'salesRep', status: { in: ['active', 'invited'] } } });
  res.json({ status: 'success', data: { total, active, inactive: total - active } });
});

export const toggleSalesRepStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const target = await findRep(req, id);
  const current = await withAgencyAccess(target);
  await changeAccess(target, { isActive: !current.isActive }, req);
  const updated = await withAgencyAccess(await prisma.user.findFirst({ where: { id } }));
  res.json({ status: 'success', data: { salesRep: safeUser(updated) } });
});

export const getSalesRepPerformance = asyncHandler(async (req, res) => {
  // Aggregation across services — simplified response for now
  const { id } = parseOrThrow(idParamSchema, req.params);
  const rep = await prisma.user.findFirst({ where: { id, ...agencyMemberWhere({ role: 'salesRep' }) } });
  if (!rep) throw new AppError('Sales representative not found', 404);
  res.json({ status: 'success', data: { salesRepId: id, name: rep.name, metrics: { note: 'Detailed performance available via analytics-service' } } });
});

export const updateSalesRepCommission = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { commissionRate } = parseOrThrow(updateCommissionSchema, req.body);
  const target = await findRep(req, id);
  const rep = await prisma.user.update({ where: { id }, data: { commissionRate } });
  await auditCommission(req, target, commissionRate);
  res.json({ status: 'success', message: 'Commission rate updated', data: { salesRep: safeUser(await withAgencyAccess(rep)) } });
});

export const getInternalNotifyTargets = asyncHandler(async (req, res) => {
  const reps = await prisma.user.findMany({
    where: { isActive: true, ...agencyMemberWhere({ role: 'salesRep', isActive: true }) },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: 50,
  });
  res.json({ status: 'success', data: { reps } });
});

export const getOnlineSalesReps = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000); // online = active in last 5 min
  const reps = await prisma.user.findMany({
    where: { isActive: true, lastActivity: { gte: cutoff }, ...agencyMemberWhere({ role: 'salesRep', isActive: true }) },
    select: { id: true, name: true, email: true, lastActivity: true },
  });
  res.json({ status: 'success', data: reps });
});

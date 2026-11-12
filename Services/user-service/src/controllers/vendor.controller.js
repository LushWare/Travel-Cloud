import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma, { identityPrisma } from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { idParamSchema, formatZodError, SERVICE_TYPES } from '../validators/common.js';
import {
  createVendorSchema, updateVendorSchema, updateVendorStatusSchema,
  updateVendorRatingSchema, listVendorsQuerySchema,
} from '../validators/vendor.validator.js';
import { z } from 'zod';
import { withStaffSeat } from '../services/plan.service.js';
import {
  agencyMemberWhere, changeAccess, findManageableUser, newMembership, removeAccess, withAgencyAccess, auditStaffCreated,
} from '../utils/accountGuard.js';

const findVendor = (req, id) => findManageableUser(req.user, id, { role: 'vendor', notFound: 'Vendor not found' });

const safeUser = (u) => { if (!u) return null; const { password, ...r } = u; return r; };

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(formatZodError(parsed.error), 400);
  return parsed.data;
}

const serviceTypeParamSchema = z.object({ serviceType: z.enum(SERVICE_TYPES) });

export const getAllVendors = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, search, isActive, serviceType, vendorStatus } = parseOrThrow(listVendorsQuerySchema, req.query);
  const where = agencyMemberWhere({ role: 'vendor', isActive: isActive === undefined ? undefined : isActive === 'true' });
  if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }];
  const vpWhere = {};
  if (serviceType || vendorStatus) {
    vpWhere.vendorProfile = {
      ...(serviceType && { serviceType }),
      ...(vendorStatus && { vendorStatus }),
    };
  }
  const skip = (page - 1) * limit;
  const [vendors, total] = await Promise.all([
    prisma.user.findMany({ where: { ...where, ...vpWhere }, skip, take: limit, orderBy: { name: 'asc' }, include: { vendorProfile: true } }),
    prisma.user.count({ where: { ...where, ...vpWhere } }),
  ]);
  res.json({ status: 'success', data: (await withAgencyAccess(vendors)).map(safeUser), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
});

export const getVendorById = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const vendor = await prisma.user.findFirst({ where: { id, ...agencyMemberWhere({ role: 'vendor' }) }, include: { vendorProfile: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  res.json({ status: 'success', data: { vendor: safeUser(await withAgencyAccess(vendor)) } });
});

export const createVendor = asyncHandler(async (req, res) => {
  const { name, email, phone, phoneCountry, businessName, serviceType, businessRegistrationNumber,
    taxIdentificationNumber, address, contactPerson, bankDetails } = parseOrThrow(createVendorSchema, req.body);

  const existing = await identityPrisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('User with this email already exists', 400);

  const tempPassword = crypto.randomBytes(8).toString('hex');
  const hashed = await bcrypt.hash(tempPassword, 12);

  const vendor = await withStaffSeat((tx) => tx.user.create({
    data: {
      name, email, phone: phone || null, ...(phoneCountry && { phoneCountry }),
      password: hashed, role: 'vendor',
      memberships: newMembership(req.user, 'vendor'),
      createdById: req.user.id,
      isTempPassword: true, mustChangePassword: true,
      vendorProfile: {
        create: {
          businessName: businessName || null,
          serviceType: serviceType || null,
          businessRegistrationNumber: businessRegistrationNumber || null,
          taxIdentificationNumber: taxIdentificationNumber || null,
          addressStreet: address?.street || null,
          addressCity: address?.city || null,
          addressState: address?.state || null,
          addressZipCode: address?.zipCode || null,
          addressCountry: address?.country || null,
          contactPersonName: contactPerson?.name || null,
          contactPersonPhone: contactPerson?.phone || null,
          contactPersonEmail: contactPerson?.email || null,
          contactPersonDesignation: contactPerson?.designation || null,
          bankAccountName: bankDetails?.accountName || null,
          bankAccountNumber: bankDetails?.accountNumber || null,
          bankName: bankDetails?.bankName || null,
          bankBranchName: bankDetails?.branchName || null,
          bankIfscCode: bankDetails?.ifscCode || null,
          bankSwiftCode: bankDetails?.swiftCode || null,
        },
      },
    },
    include: { vendorProfile: true },
  }));
  await auditStaffCreated(req, vendor, 'vendor');
  res.status(201).json({ status: 'success', data: { vendor: safeUser(vendor) } });
});

export const updateVendor = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { name, phone, phoneCountry, businessName, serviceType, address, contactPerson, bankDetails, taxIdentificationNumber } = parseOrThrow(updateVendorSchema, req.body);
  await findVendor(req, id);
  const vendor = await prisma.user.update({
    where: { id },
    data: {
      ...(name && { name }), ...(phone !== undefined && { phone }), ...(phoneCountry && { phoneCountry }),
      vendorProfile: {
        update: {
          ...(businessName !== undefined && { businessName }),
          ...(serviceType && { serviceType }),
          ...(taxIdentificationNumber !== undefined && { taxIdentificationNumber }),
          ...(address?.street !== undefined && { addressStreet: address.street }),
          ...(address?.city !== undefined && { addressCity: address.city }),
          ...(address?.country !== undefined && { addressCountry: address.country }),
          ...(contactPerson?.name !== undefined && { contactPersonName: contactPerson.name }),
          ...(bankDetails?.accountNumber !== undefined && { bankAccountNumber: bankDetails.accountNumber }),
        },
      },
    },
    include: { vendorProfile: true },
  });
  res.json({ status: 'success', data: { vendor: safeUser(vendor) } });
});

export const deleteVendor = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  await removeAccess(await findVendor(req, id), req);
  res.json({ status: 'success', data: {} });
});

export const getVendorStats = asyncHandler(async (req, res) => {
  const [total, active, byService] = await Promise.all([
    prisma.membership.count({ where: { role: 'vendor' } }),
    prisma.membership.count({ where: { role: 'vendor', status: { in: ['active', 'invited'] } } }),
    prisma.vendorProfile.groupBy({ by: ['serviceType'], _count: true }),
  ]);
  res.json({ status: 'success', data: { total, active, inactive: total - active, byServiceType: byService } });
});

export const toggleVendorStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const target = await findVendor(req, id);
  const current = await withAgencyAccess(target);
  await changeAccess(target, { isActive: !current.isActive }, req);
  const updated = await withAgencyAccess(await prisma.user.findFirst({ where: { id } }));
  res.json({ status: 'success', data: { vendor: safeUser(updated) } });
});

export const getVendorPerformance = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const vendor = await prisma.user.findFirst({ where: { id, ...agencyMemberWhere({ role: 'vendor' }) }, include: { vendorProfile: true } });
  if (!vendor) throw new AppError('Vendor not found', 404);
  res.json({ status: 'success', data: { vendorId: id, profile: vendor.vendorProfile } });
});

export const updateVendorStatus = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { vendorStatus } = parseOrThrow(updateVendorStatusSchema, req.body);
  await findVendor(req, id);
  const profile = await prisma.vendorProfile.update({ where: { userId: id }, data: { vendorStatus } });
  res.json({ status: 'success', data: { vendorProfile: profile } });
});

export const updateVendorRating = asyncHandler(async (req, res) => {
  const { id } = parseOrThrow(idParamSchema, req.params);
  const { rating } = parseOrThrow(updateVendorRatingSchema, req.body);
  await findVendor(req, id);
  const profile = await prisma.vendorProfile.update({ where: { userId: id }, data: { rating } });
  res.json({ status: 'success', data: { vendorProfile: profile } });
});

export const getVendorsByServiceType = asyncHandler(async (req, res) => {
  const { serviceType } = parseOrThrow(serviceTypeParamSchema, req.params);
  const vendors = await prisma.user.findMany({
    where: { vendorProfile: { serviceType }, ...agencyMemberWhere({ role: 'vendor' }) },
    include: { vendorProfile: true },
  });
  res.json({ status: 'success', count: vendors.length, data: (await withAgencyAccess(vendors)).map(safeUser) });
});

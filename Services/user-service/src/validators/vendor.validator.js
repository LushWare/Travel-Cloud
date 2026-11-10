import { z } from 'zod';
import { nameField, emailField, phoneField, phoneCountryField, SERVICE_TYPES, VENDOR_STATUSES } from './common.js';

const addressSchema = z
  .object({
    street: z.string().trim().max(255).optional().nullable(),
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    zipCode: z.string().trim().max(20).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
  })
  .strict()
  .optional();

const contactPersonSchema = z
  .object({
    name: z.string().trim().max(100).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().toLowerCase().email().or(z.literal('')).optional().nullable(),
    designation: z.string().trim().max(100).optional().nullable(),
  })
  .strict()
  .optional();

const bankDetailsSchema = z
  .object({
    accountName: z.string().trim().max(100).optional().nullable(),
    accountNumber: z.string().trim().max(50).optional().nullable(),
    bankName: z.string().trim().max(100).optional().nullable(),
    branchName: z.string().trim().max(100).optional().nullable(),
    ifscCode: z.string().trim().max(20).optional().nullable(),
    swiftCode: z.string().trim().max(20).optional().nullable(),
  })
  .strict()
  .optional();

export const createVendorSchema = z
  .object({
    name: nameField,
    email: emailField,
    phone: phoneField,
    phoneCountry: phoneCountryField,
    businessName: z.string().trim().max(255).optional().nullable(),
    serviceType: z.enum(SERVICE_TYPES).optional().nullable(),
    businessRegistrationNumber: z.string().trim().max(100).optional().nullable(),
    taxIdentificationNumber: z.string().trim().max(100).optional().nullable(),
    address: addressSchema,
    contactPerson: contactPersonSchema,
    bankDetails: bankDetailsSchema,
  })
  .strict();

export const updateVendorSchema = z
  .object({
    name: nameField.optional(),
    phone: phoneField,
    phoneCountry: phoneCountryField,
    businessName: z.string().trim().max(255).optional().nullable(),
    serviceType: z.enum(SERVICE_TYPES).optional(),
    taxIdentificationNumber: z.string().trim().max(100).optional().nullable(),
    address: addressSchema,
    contactPerson: contactPersonSchema,
    bankDetails: bankDetailsSchema,
  })
  .strict();

export const updateVendorStatusSchema = z
  .object({
    vendorStatus: z.enum(VENDOR_STATUSES, { message: `vendorStatus must be one of: ${VENDOR_STATUSES.join(', ')}` }),
  })
  .strict();

export const updateVendorRatingSchema = z
  .object({
    rating: z.coerce.number().min(0).max(5),
  })
  .strict();

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(255).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  serviceType: z.enum(SERVICE_TYPES).optional(),
  vendorStatus: z.enum(VENDOR_STATUSES).optional(),
});

import { z } from 'zod';
import { nameField, emailField, phoneField, phoneCountryField } from './common.js';

export const DEFAULT_COMMISSION_RATE = 10;

// Percent, 0–100, kept to two decimal places (the column is DECIMAL(5,2)).
const commissionRateField = z.coerce
  .number({ message: 'commissionRate must be a number' })
  .min(0, 'commissionRate must be between 0 and 100')
  .max(100, 'commissionRate must be between 0 and 100')
  .transform((n) => Math.round(n * 100) / 100);

export const createSalesRepSchema = z
  .object({
    name: nameField,
    email: emailField,
    phone: phoneField,
    phoneCountry: phoneCountryField,
    commissionRate: commissionRateField.optional(),
  })
  .strict();

export const updateSalesRepSchema = z
  .object({
    name: nameField.optional(),
    phone: phoneField,
    email: emailField.optional(),
    phoneCountry: phoneCountryField,
    commissionRate: commissionRateField.optional(),
  })
  .strict();

export const updateCommissionSchema = z.object({ commissionRate: commissionRateField }).strict();

export const listSalesRepsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().trim().max(255).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

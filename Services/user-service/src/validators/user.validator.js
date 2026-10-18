import { z } from 'zod';
import { nameField, emailField, phoneField, passwordField, permissionsField, USER_ROLES } from './common.js';

export const updateCurrentUserProfileSchema = z
  .object({
    name: nameField.optional(),
    email: emailField.optional(),
    phone: phoneField,
  })
  .strict();

export const createUserSchema = z
  .object({
    name: nameField,
    email: emailField,
    phone: phoneField,
    role: z.enum(USER_ROLES, { message: `role must be one of: ${USER_ROLES.join(', ')}` }),
    password: passwordField.optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    name: nameField.optional(),
    phone: phoneField,
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    permissions: permissionsField,
  })
  .strict();

export const updateUserPasswordSchema = z
  .object({
    password: passwordField,
  })
  .strict();

export const assignUserRoleSchema = z
  .object({
    role: z.enum(USER_ROLES, { message: `role must be one of: ${USER_ROLES.join(', ')}` }),
  })
  .strict();

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  search: z.string().trim().max(255).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  ids: z.string().max(12899).refine((value) => {
    const ids = value.split(',');
    return ids.length <= 100 && ids.every((id) => id.length > 0 && id.length <= 128 && !/[\s\u0000-\u001f\u007f]/.test(id));
  }, 'ids must contain at most 100 valid record IDs').optional(),
});

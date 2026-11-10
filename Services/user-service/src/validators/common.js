import { z } from 'zod';

// Valid permission strings — same list the service layer has always
// enforced via .filter(); now the single source of truth other validators
// import from, instead of each controller keeping its own copy.
export const AVAILABLE_PERMISSIONS = [
  'manage_users', 'manage_sales_reps', 'manage_vendors', 'manage_admins',
  'view_reports', 'manage_billing', 'view_billing', 'manage_leads', 'manage_packages',
];

export const USER_ROLES = ['customer', 'salesRep', 'vendor', 'admin', 'superAdmin'];
export const SERVICE_TYPES = ['hotel', 'transport', 'activity', 'restaurant', 'guide', 'other'];
export const VENDOR_STATUSES = ['pending_verification', 'verified', 'suspended', 'rejected'];

export const idParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export const permissionsField = z.array(z.enum(AVAILABLE_PERMISSIONS)).optional();

export const nameField = z.string().trim().min(1, 'name is required').max(50, 'name cannot exceed 50 characters');
export const emailField = z.string().trim().toLowerCase().email('email must be a valid email address').max(255);
export const phoneField = z.string().trim().max(30).optional().nullable();
export const phoneCountryField = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'phoneCountry must be a 2-letter country code').optional();
export const passwordField = z.string().min(6, 'password must be at least 6 characters').max(128);

export function formatZodError(error) {
  return error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

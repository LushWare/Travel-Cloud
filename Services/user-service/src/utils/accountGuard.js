import prisma from '../db/client.js';
import AppError from './appError.js';

export const isSuperAdmin = (user) => Boolean(user?.isSuperAdmin || user?.role === 'superAdmin');

/** Only a super admin may create, promote to, or edit a super admin account. */
export function assertMayGrantRole(actor, role) {
  if (role === 'superAdmin' && !isSuperAdmin(actor)) {
    throw new AppError("You don't have permission to do that.", 403);
  }
}

/**
 * Loads the account an admin is about to change, refusing super admin accounts to anyone
 * but a super admin. `role` restricts the lookup, so a sales-rep endpoint only reaches sales reps.
 */
export async function findManageableUser(actor, id, { role, notFound = 'User not found', include } = {}) {
  const target = await prisma.user.findFirst({ where: { id, ...(role && { role }) }, ...(include && { include }) });
  if (!target) throw new AppError(notFound, 404);
  if (isSuperAdmin(target) && !isSuperAdmin(actor)) {
    throw new AppError("You don't have permission to do that.", 403);
  }
  return target;
}

export function assertNotSelf(actor, id, message = "You can't change your own access here.") {
  if (actor?.id === id) throw new AppError(message, 400);
}

/**
 * The membership a newly created staff account gets in the creating admin's agency. It stays
 * "invited" until the person sets their password from the invitation email.
 */
export function newMembership(actor, role, permissions = [], { active = false } = {}) {
  if (!actor?.tenantId) throw new AppError('Your session has expired. Please sign in again.', 401);
  return {
    create: {
      tenantId: actor.tenantId,
      role,
      permissions,
      isOwner: role === 'superAdmin',
      status: active ? 'active' : 'invited',
      invitedById: actor.id,
    },
  };
}

import prisma from '../db/client.js';
import AppError from './appError.js';
import { audit, describePerson } from './audit.js';
import { withStaffSeat } from '../services/plan.service.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// A person's account is global; what they may do comes from their membership in each agency.
// Every staff-management action reads and changes the membership of the current agency only,
// so one agency can never change, suspend or delete someone's access to another agency.

export const isSuperAdmin = (user) => Boolean(user?.isSuperAdmin || user?.role === 'superAdmin');
export const isOwnerMembership = (m) => Boolean(m?.isOwner || m?.role === 'superAdmin');

const FORBIDDEN = "You don't have permission to do that.";

/** Only an owner (super admin) may create, promote to, or edit an owner. */
export function assertMayGrantRole(actor, role) {
  if (role === 'superAdmin' && !isSuperAdmin(actor)) throw new AppError(FORBIDDEN, 403);
}

export function assertNotSelf(actor, id, message = "You can't change your own access here.") {
  if (actor?.id === id) throw new AppError(message, 400);
}

/** Prisma `where` for people in this agency, filtered by their role and status here. */
export function agencyMemberWhere({ role, isActive } = {}) {
  if (role === 'customer') return { role: 'customer', ...(isActive !== undefined && { isActive }) };
  const status = isActive === undefined ? undefined : isActive ? { in: ['active', 'invited'] } : 'suspended';
  return {
    memberships: {
      some: { tenantId: requireTenantId(), ...(role && { role }), ...(status && { status }) },
    },
  };
}

/** Shows each account with its role, permissions and status in this agency. */
export async function withAgencyAccess(users) {
  const list = Array.isArray(users) ? users : [users];
  const ids = list.filter(Boolean).map((u) => u.id);
  if (!ids.length) return users;
  const memberships = await prisma.membership.findMany({ where: { userId: { in: ids } } });
  const byUser = new Map(memberships.map((m) => [m.userId, m]));
  const overlay = (u) => {
    const m = u && byUser.get(u.id);
    if (!m) return u;
    return {
      ...u,
      role: m.role,
      permissions: m.permissions,
      isActive: Boolean(u.isActive) && m.status !== 'suspended',
      isOwner: isOwnerMembership(m),
      isSuperAdmin: isOwnerMembership(m),
      membershipStatus: m.status,
    };
  };
  return Array.isArray(users) ? list.map(overlay) : overlay(users);
}

/**
 * Loads someone an admin is about to change: their account and their membership in this agency.
 * `role` limits the lookup to that role here (a sales-rep endpoint only reaches sales reps).
 * Owners can only be changed by an owner.
 */
export async function findManageableUser(actor, id, { role, notFound = 'User not found', include } = {}) {
  const membership = role === 'customer'
    ? null
    : await prisma.membership.findFirst({ where: { userId: id, ...(role && { role }) } });
  // Website customers have no membership; only the public-website agency can see them.
  const customerOnly = !membership && (!role || role === 'customer');
  if (!membership && !customerOnly) throw new AppError(notFound, 404);
  const user = await prisma.user.findFirst({
    where: { id, ...(customerOnly && { role: 'customer' }) },
    ...(include && { include }),
  });
  if (!user) throw new AppError(notFound, 404);
  if (isOwnerMembership(membership) && !isSuperAdmin(actor)) throw new AppError(FORBIDDEN, 403);
  return { ...user, membership };
}

const sameList = (a = [], b = []) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** The audit entries one access change produces, compared with the membership before it. */
export function accessChangeEntries(person, before, data) {
  const who = describePerson(person);
  const base = { targetType: 'user', targetId: person.id };
  const entries = [];
  if (data.role && data.role !== before.role) {
    if (data.role === 'superAdmin') entries.push({ ...base, action: 'staff.owner_granted', summary: `Made ${who} an owner` });
    else if (before.role === 'superAdmin') entries.push({ ...base, action: 'staff.owner_revoked', summary: `Removed owner access from ${who}`, details: { to: data.role } });
    else entries.push({ ...base, action: 'staff.role_changed', summary: `Changed ${who} from ${before.role} to ${data.role}`, details: { from: before.role, to: data.role } });
  }
  if (data.permissions && !sameList(data.permissions, before.permissions)) {
    const added = data.permissions.filter((p) => !(before.permissions || []).includes(p));
    const removed = (before.permissions || []).filter((p) => !data.permissions.includes(p));
    entries.push({ ...base, action: 'staff.permissions_changed', summary: `Changed permissions for ${who}`, details: { added, removed } });
  }
  if (data.status === 'suspended' && before.status !== 'suspended') entries.push({ ...base, action: 'staff.suspended', summary: `Suspended ${who}` });
  if (data.status && data.status !== 'suspended' && before.status === 'suspended') {
    entries.push({ ...base, action: 'staff.reactivated', summary: `Reactivated ${who}` });
  }
  return entries;
}

/** Applies an access change: to the agency membership for staff, to the account for website customers. */
export async function changeAccess(target, changes, req) {
  if (target.membership) {
    const before = target.membership;
    const after = await changeAgencyAccess(before, changes);
    if (req && after && after !== before) {
      for (const entry of accessChangeEntries(target, before, after)) await audit(req, entry);
    }
    return after;
  }
  const { role, permissions, isActive } = changes;
  if ((role && role !== 'customer') || permissions) {
    throw new AppError('A website customer cannot be given staff access. Create a staff account instead.', 400);
  }
  if (isActive === undefined) return null;
  const updated = await prisma.user.update({ where: { id: target.id }, data: { isActive } });
  if (req && Boolean(target.isActive) !== isActive) {
    await audit(req, {
      action: isActive ? 'customer.reactivated' : 'customer.deactivated',
      targetType: 'user', targetId: target.id,
      summary: `${isActive ? 'Reactivated' : 'Deactivated'} website customer ${describePerson(target)}`,
    });
  }
  return updated;
}

/** Removes a staff member from this agency, or deletes a website customer's account. */
export async function removeAccess(target, req) {
  if (target.membership) {
    await removeFromAgency(target.membership);
    if (req) {
      await audit(req, {
        action: 'staff.removed', targetType: 'user', targetId: target.id,
        summary: `Removed ${describePerson(target)} (${target.membership.role}) from the agency`,
      });
    }
    return;
  }
  await prisma.user.delete({ where: { id: target.id } });
  if (req) {
    await audit(req, { action: 'customer.deleted', targetType: 'user', targetId: target.id, summary: `Deleted website customer ${describePerson(target)}` });
  }
}

/** Records that a staff account was created in this agency. */
export const auditStaffCreated = (req, user, role) => audit(req, {
  action: 'staff.added', targetType: 'user', targetId: user.id,
  summary: `Added ${describePerson(user)} as ${role}`,
});

/** An agency must always keep at least one active owner. */
async function assertAnotherOwnerRemains(membership) {
  if (!isOwnerMembership(membership)) return;
  const others = await prisma.membership.count({
    where: { id: { not: membership.id }, status: 'active', OR: [{ isOwner: true }, { role: 'superAdmin' }] },
  });
  if (others === 0) throw new AppError('An agency must keep at least one owner. Make someone else an owner first.', 409);
}

/** Changes someone's role, permissions or active status in this agency only. */
export async function changeAgencyAccess(membership, { role, permissions, isActive } = {}) {
  const losesOwner = (role && role !== 'superAdmin') || isActive === false;
  if (losesOwner) await assertAnotherOwnerRemains(membership);

  const data = {};
  if (role) Object.assign(data, { role, isOwner: role === 'superAdmin' });
  if (permissions) data.permissions = permissions;
  if (isActive === false) data.status = 'suspended';
  if (isActive === true && membership.status === 'suspended') data.status = membership.joinedAt ? 'active' : 'invited';
  if (!Object.keys(data).length) return membership;
  const seatRoles = new Set(['superAdmin', 'admin', 'salesRep', 'vendor']);
  const countsAsSeat = ({ role: memberRole, status }) => seatRoles.has(memberRole) && ['active', 'invited'].includes(status);
  const nextMembership = { ...membership, ...data };
  const update = (client) => client.membership.update({ where: { id: membership.id }, data });
  return !countsAsSeat(membership) && countsAsSeat(nextMembership)
    ? withStaffSeat(update)
    : update(prisma);
}

/**
 * Removes someone from this agency. Their account stays, so their access to other agencies
 * and the history that names them (leads, documents) are untouched.
 */
export async function removeFromAgency(membership) {
  await assertAnotherOwnerRemains(membership);
  await prisma.membership.delete({ where: { id: membership.id } });
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

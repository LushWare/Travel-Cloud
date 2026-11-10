import { vi } from 'vitest';

export const TENANT_ID = '00000000-0000-4000-8000-000000000001';

/** The agency a staff member works in; by default everyone belongs to exactly one, with their account's role. */
export const workspaceFor = (user, over = {}) => ({
  tenantId: TENANT_ID,
  tenantSlug: 'lush-demo',
  tenantName: 'Lush Demo',
  membershipId: `m-${user.id}`,
  role: user.role,
  permissions: user.permissions || [],
  isOwner: Boolean(user.isSuperAdmin),
  ...over,
});

/** Stand-in for membershipQueries.js whose answers follow whatever userDb.findUserById returns. */
export function membershipMock(userDb) {
  const userFor = async (userId) => (await userDb.findUserById?.(userId)) || null;
  // Login looks people up by email, so an unknown id still gets a default admin membership.
  const userOrDefault = async (userId) => (await userFor(userId)) || { id: userId, role: 'admin', permissions: [] };
  return {
    listUsableMemberships: vi.fn(async (userId) => [workspaceFor(await userOrDefault(userId))]),
    findUsableMembership: vi.fn(async (userId, tenantId) => {
      const user = await userFor(userId);
      return user && tenantId === TENANT_ID ? workspaceFor(user) : null;
    }),
    findMembership: vi.fn(async (userId, tenantId) => {
      const user = await userFor(userId);
      return user && tenantId === TENANT_ID
        ? { ...workspaceFor(user), status: user.isActive === false ? 'suspended' : 'active' }
        : null;
    }),
    activateInvitedMemberships: vi.fn(async () => {}),
  };
}

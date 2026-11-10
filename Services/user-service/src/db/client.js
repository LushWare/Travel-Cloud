import { PrismaClient, Prisma } from '@prisma/client';
import { createTenantPrisma } from '../../../shared/tenancy/src/index.js';
import { DEMO_TENANT_ID } from '../../../shared/constants/src/index.js';

const base = new PrismaClient({ log: ['error'] });

// Accounts are global (one person, several agencies). Inside an agency an admin sees its members;
// the public-website agency also sees its website customers.
const PUBLIC_SITE_TENANT_ID = process.env.PUBLIC_SITE_TENANT_ID || DEMO_TENANT_ID;
const userScope = (tenantId) => (tenantId === PUBLIC_SITE_TENANT_ID
  ? { OR: [{ memberships: { some: { tenantId } } }, { role: 'customer' }] }
  : { memberships: { some: { tenantId } } });

/** Unfiltered access to the global account list, only for checks that must span agencies (e.g. email taken). */
export const identityPrisma = base;

// Every query is limited to the request's agency; see Services/shared/tenancy.
const prisma = createTenantPrisma(base, { Prisma, extraScopes: { User: userScope } });

export default prisma;

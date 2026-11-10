import { PrismaClient, Prisma } from '@prisma/client';
import { createTenantPrisma } from '../../../shared/tenancy/src/index.js';

const base = new PrismaClient({ log: ['error'] });
// Every query is limited to the request's agency; see Services/shared/tenancy.
const prisma = createTenantPrisma(base, { Prisma });

export default prisma;

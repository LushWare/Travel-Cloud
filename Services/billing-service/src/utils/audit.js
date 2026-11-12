import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { recordAudit } from '../../../shared/tenancy/src/index.js';

/** Records a privileged action in the current agency's audit log. Never throws. */
export const audit = (req, entry) => recordAudit(prisma, req, entry, { logger });

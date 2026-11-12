import { Router } from 'express';
import { getAgency, listAgencies, restoreAgency, startHelp, suspendAgency } from '../controllers/agencies.controller.js';
import { assignAgencyPlan, getAgencyPlan, removeAgencyOverride, setAgencyOverride } from '../controllers/plans.controller.js';
import { requirePlatformRole, requirePlatformSession } from '../middleware/requirePlatformSession.js';

const router = Router();

// Every platform role can look; only platform admins can suspend or restore.
router.use(requirePlatformSession);
router.get('/', listAgencies);
router.get('/:id', getAgency);
router.get('/:id/plan', getAgencyPlan);
router.put('/:id/plan', requirePlatformRole('platform_admin'), assignAgencyPlan);
router.put('/:id/overrides/:key', requirePlatformRole('platform_admin'), setAgencyOverride);
router.delete('/:id/overrides/:key', requirePlatformRole('platform_admin'), removeAgencyOverride);
router.post('/:id/suspend', requirePlatformRole('platform_admin'), suspendAgency);
router.post('/:id/restore', requirePlatformRole('platform_admin'), restoreAgency);
// Support and admins can both open view-only help access.
router.post('/:id/help-access', startHelp);

export default router;

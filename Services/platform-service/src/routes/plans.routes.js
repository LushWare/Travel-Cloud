import { Router } from 'express';
import { archivePlan, createPlan, createPlanVersion, duplicatePlan, listPlans } from '../controllers/plans.controller.js';
import { requirePlatformRole, requirePlatformSession } from '../middleware/requirePlatformSession.js';

const router = Router();
router.use(requirePlatformSession);
router.get('/', listPlans);
router.post('/', requirePlatformRole('platform_admin'), createPlan);
router.post('/:id/versions', requirePlatformRole('platform_admin'), createPlanVersion);
router.post('/:id/duplicate', requirePlatformRole('platform_admin'), duplicatePlan);
router.post('/:id/archive', requirePlatformRole('platform_admin'), archivePlan);

export default router;
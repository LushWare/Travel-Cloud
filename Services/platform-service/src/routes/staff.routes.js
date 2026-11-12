import { Router } from 'express';
import { changeStaffRole, createStaff, deactivateStaff, deleteStaff, listStaff, resendInvite, resetAuthenticator } from '../controllers/staff.controller.js';
import { requirePlatformRole, requirePlatformSession } from '../middleware/requirePlatformSession.js';

const router = Router();
router.use(requirePlatformSession, requirePlatformRole('platform_admin'));
router.get('/', listStaff);
router.post('/', createStaff);
router.post('/:id/resend-invite', resendInvite);
router.put('/:id/role', changeStaffRole);
router.post('/:id/reset-authenticator', resetAuthenticator);
router.post('/:id/deactivate', deactivateStaff);
router.delete('/:id', deleteStaff);

export default router;
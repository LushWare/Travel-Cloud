import { Router } from 'express';
import { getSettings, setSignupApproval } from '../controllers/settings.controller.js';
import { requirePlatformRole, requirePlatformSession } from '../middleware/requirePlatformSession.js';

const router = Router();

// Every platform role can see the switches; only platform admins change them.
router.use(requirePlatformSession);
router.get('/', getSettings);
router.put('/signup-approval', requirePlatformRole('platform_admin'), setSignupApproval);

export default router;

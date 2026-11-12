import { Router } from 'express';
import { changePassword, login, logout, me, verifyMfa } from '../controllers/auth.controller.js';
import { completeSetup, getSetup } from '../controllers/staff.controller.js';
import { platformSession } from '../middleware/requirePlatformSession.js';

const router = Router();
// The only routes open while a temporary password is still in use.
const pendingPasswordAllowed = platformSession({ allowPendingPasswordChange: true });

router.post('/login', login);
router.post('/mfa', verifyMfa);
router.post('/setup/details', getSetup);
router.post('/setup', completeSetup);
router.post('/logout', logout);
router.get('/me', pendingPasswordAllowed, me);
router.post('/change-password', pendingPasswordAllowed, changePassword);

export default router;

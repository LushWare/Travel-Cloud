import express from 'express';
import { extractUser, requireAuth, authorize } from '../middleware/auth.js';
import { listCallsForLead, streamCallRecording } from '../controllers/call.controller.js';

const router = express.Router();

router.use(extractUser, requireAuth);

router.get('/calls/:callId/recording', authorize('admin', 'salesRep', 'superAdmin'), streamCallRecording);
router.get('/leads/:leadId/calls', authorize('admin', 'salesRep', 'superAdmin'), listCallsForLead);

export default router;

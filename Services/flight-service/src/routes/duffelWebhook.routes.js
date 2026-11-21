import { Router } from 'express';
import { handleAgencyDuffelWebhook, handleDuffelWebhook } from '../controllers/duffelWebhook.controller.js';

const router = Router();

router.post('/', handleDuffelWebhook);
router.post('/:tenantId', handleAgencyDuffelWebhook);

export default router;
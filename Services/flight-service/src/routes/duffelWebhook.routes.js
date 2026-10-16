import { Router } from 'express';
import { handleDuffelWebhook } from '../controllers/duffelWebhook.controller.js';

const router = Router();

router.post('/', handleDuffelWebhook);

export default router;
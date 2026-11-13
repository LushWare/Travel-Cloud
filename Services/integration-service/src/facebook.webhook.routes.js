import { Router } from 'express';
import { handleFacebookWebhook, verifyFacebookWebhook } from './facebook.controller.js';

const router = Router();

router.get('/', verifyFacebookWebhook);
router.post('/', handleFacebookWebhook);

export default router;

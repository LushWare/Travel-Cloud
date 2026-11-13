import { Router } from 'express';
import {
  handleGoogleAdsLeadWebhook,
  verifyWhatsappWebhook, handleWhatsappWebhook,
} from '../controllers/webhook.controller.js';

const router = Router();

router.post('/google-ads/:tenantId', handleGoogleAdsLeadWebhook);

router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', handleWhatsappWebhook);

export default router;

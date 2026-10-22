import { Router } from 'express';
import {
  verifyWebhook, handleLeadWebhook, handleGoogleAdsLeadWebhook,
  verifyWhatsappWebhook, handleWhatsappWebhook,
} from '../controllers/webhook.controller.js';

const router = Router();

router.get('/facebook', verifyWebhook);
router.post('/facebook', handleLeadWebhook);
router.post('/google-ads', handleGoogleAdsLeadWebhook);

router.get('/whatsapp', verifyWhatsappWebhook);
router.post('/whatsapp', handleWhatsappWebhook);

export default router;

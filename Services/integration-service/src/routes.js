import { Router } from 'express';
import {
  disconnectEmail,
  getEmailIntegration,
  saveEmailIntegration,
  sendAgencyEmail,
  testEmailIntegration,
  disconnectGoogleAdsIntegration,
  getGoogleAdsIntegration,
  saveGoogleAdsIntegration,
  verifyGoogleAdsWebhookKey,
} from './email.controller.js';
import { requireAgencyAdmin, requireInternalToken } from './middleware/admin.js';
import facebookRoutes from './facebook.routes.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/email', requireAgencyAdmin, asyncHandler(getEmailIntegration));
router.put('/email', requireAgencyAdmin, asyncHandler(saveEmailIntegration));
router.post('/email/test', requireAgencyAdmin, asyncHandler(testEmailIntegration));
router.delete('/email', requireAgencyAdmin, asyncHandler(disconnectEmail));
router.get('/google-ads', requireAgencyAdmin, asyncHandler(getGoogleAdsIntegration));
router.put('/google-ads', requireAgencyAdmin, asyncHandler(saveGoogleAdsIntegration));
router.delete('/google-ads', requireAgencyAdmin, asyncHandler(disconnectGoogleAdsIntegration));
router.post('/internal/email/send', requireInternalToken, asyncHandler(sendAgencyEmail));
router.post('/internal/google-ads/:tenantId/verify', requireInternalToken, asyncHandler(verifyGoogleAdsWebhookKey));
router.use(facebookRoutes);

export default router;

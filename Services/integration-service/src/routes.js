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
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getWhatsappIntegration,
  resolveWhatsappPhone,
  sendAgencyWhatsapp,
} from './whatsapp.controller.js';
import {
  completeStripeOAuth,
  disconnectStripe,
  getStripeIntegration,
  startStripeOAuth,
  testStripeIntegration,
} from './stripe.controller.js';
import {
  createPublicStripeCheckout,
  createStripePaymentLink,
  getPublicStripeCheckoutStatus,
  getPublicStripePaymentLink,
} from './stripePayments.controller.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/email', requireAgencyAdmin, asyncHandler(getEmailIntegration));
router.put('/email', requireAgencyAdmin, asyncHandler(saveEmailIntegration));
router.post('/email/test', requireAgencyAdmin, asyncHandler(testEmailIntegration));
router.delete('/email', requireAgencyAdmin, asyncHandler(disconnectEmail));
router.get('/google-ads', requireAgencyAdmin, asyncHandler(getGoogleAdsIntegration));
router.put('/google-ads', requireAgencyAdmin, asyncHandler(saveGoogleAdsIntegration));
router.delete('/google-ads', requireAgencyAdmin, asyncHandler(disconnectGoogleAdsIntegration));
router.get('/whatsapp', requireAgencyAdmin, asyncHandler(getWhatsappIntegration));
router.post('/whatsapp/connect', requireAgencyAdmin, asyncHandler(connectWhatsapp));
router.delete('/whatsapp', requireAgencyAdmin, asyncHandler(disconnectWhatsapp));
router.post('/internal/email/send', requireInternalToken, asyncHandler(sendAgencyEmail));
router.post('/internal/whatsapp/send', requireInternalToken, asyncHandler(sendAgencyWhatsapp));
router.post('/internal/whatsapp/resolve', requireInternalToken, asyncHandler(resolveWhatsappPhone));
router.post('/internal/google-ads/:tenantId/verify', requireInternalToken, asyncHandler(verifyGoogleAdsWebhookKey));
router.get('/stripe', requireAgencyAdmin, asyncHandler(getStripeIntegration));
router.post('/stripe/connect', requireAgencyAdmin, asyncHandler(startStripeOAuth));
router.get('/stripe/callback', asyncHandler(completeStripeOAuth));
router.post('/stripe/test', requireAgencyAdmin, asyncHandler(testStripeIntegration));
router.delete('/stripe', requireAgencyAdmin, asyncHandler(disconnectStripe));
router.get('/stripe/payment-links/:token', asyncHandler(getPublicStripePaymentLink));
router.post('/stripe/payment-links/:token/checkout', asyncHandler(createPublicStripeCheckout));
router.get('/stripe/checkout-sessions/:sessionId', asyncHandler(getPublicStripeCheckoutStatus));
router.post('/internal/stripe/payment-links', requireInternalToken, asyncHandler(createStripePaymentLink));
router.use(facebookRoutes);

export default router;

import { Router } from 'express';
import {
  completeFacebookOAuth,
  disconnectFacebook,
  getFacebookIntegration,
  selectFacebookPages,
  startFacebookOAuth,
} from './facebook.controller.js';
import { requireAgencyAdmin } from './middleware/admin.js';

const router = Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/facebook', requireAgencyAdmin, asyncHandler(getFacebookIntegration));
router.post('/facebook/connect', requireAgencyAdmin, asyncHandler(startFacebookOAuth));
router.get('/facebook/callback', asyncHandler(completeFacebookOAuth));
router.put('/facebook/pages', requireAgencyAdmin, asyncHandler(selectFacebookPages));
router.delete('/facebook', requireAgencyAdmin, asyncHandler(disconnectFacebook));

export default router;

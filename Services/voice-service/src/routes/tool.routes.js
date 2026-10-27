import express from 'express';
import { requireToolSecret } from '../middleware/toolSecret.js';
import {
  searchPackagesTool, getTripStatusTool, getPaymentStatusTool,
  attachPackageTool, adjustItineraryTool, previewPriceTool, resendDocumentTool, requestBookingTool,
} from '../controllers/toolDispatch.controller.js';

const router = express.Router();
router.post('/search_packages', requireToolSecret, searchPackagesTool);
router.post('/get_trip_status', requireToolSecret, getTripStatusTool);
router.post('/get_payment_status', requireToolSecret, getPaymentStatusTool);
router.post('/attach_package', requireToolSecret, attachPackageTool);
router.post('/request_booking', requireToolSecret, requestBookingTool);
router.post('/adjust_itinerary', requireToolSecret, adjustItineraryTool);
router.post('/preview_price', requireToolSecret, previewPriceTool);
router.post('/resend_document', requireToolSecret, resendDocumentTool);

export default router;

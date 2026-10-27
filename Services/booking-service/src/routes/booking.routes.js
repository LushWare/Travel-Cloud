import { Router } from 'express';
import { createWebsiteBooking, createVoiceBooking, getUserBookings, getRecentBookings } from '../controllers/booking.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireInternalToken } from '../middleware/internalToken.js';

const router = Router();

router.post('/website', createWebsiteBooking);
router.post('/internal/voice', requireInternalToken, createVoiceBooking);
router.get('/user', requireAuth, getUserBookings);
router.get('/recent', getRecentBookings);

export default router;

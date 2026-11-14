import { Router } from 'express';
import { handleStripeWebhook } from './stripePayments.controller.js';

const router = Router();

router.post('/', (req, res, next) => {
  Promise.resolve(handleStripeWebhook(req, res)).catch(next);
});

export default router;

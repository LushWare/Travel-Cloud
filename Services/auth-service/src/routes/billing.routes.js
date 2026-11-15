import { Router } from 'express';
import { changeBillingPlan, getBillingStatus, openBillingPortal, startBillingCheckout } from '../controllers/billing.controller.js';

const router = Router();
router.get('/', getBillingStatus);
router.post('/checkout', startBillingCheckout);
router.post('/portal', openBillingPortal);
router.post('/change-plan', changeBillingPlan);

export default router;

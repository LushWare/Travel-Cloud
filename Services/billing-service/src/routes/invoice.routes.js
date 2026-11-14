import { Router } from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import * as invoiceController from '../controllers/invoice.controller.js';

const router = Router();
const internalTokenAuth = (req, res, next) => {
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.INTERNAL_EVENTS_TOKEN) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

router.get('/stats', requireAuth, authorize('admin', 'salesRep'), invoiceController.getInvoiceStats);
router.get('/overdue', requireAuth, authorize('admin', 'salesRep'), invoiceController.getOverdueInvoices);
router.get('/internal/:id/payment-summary', internalTokenAuth, invoiceController.getInternalInvoicePaymentSummary);
router.post('/internal/:id/stripe-payment', internalTokenAuth, invoiceController.recordInternalStripePayment);
router.get('/', requireAuth, invoiceController.getAllInvoices);
router.get('/lead/:leadId', requireAuth, invoiceController.getInvoiceByLeadId);
router.get('/:id/pdf', requireAuth, invoiceController.downloadInvoicePDF);
router.get('/:id', requireAuth, invoiceController.getInvoiceById);
router.post('/', requireAuth, authorize('admin', 'salesRep'), invoiceController.createInvoice);
router.put('/:id', requireAuth, authorize('admin', 'salesRep'), invoiceController.updateInvoice);
router.put('/:id/cancel', requireAuth, authorize('admin'), invoiceController.cancelInvoice);
router.post('/:id/payment-link', requireAuth, authorize('admin', 'salesRep'), invoiceController.createInvoicePaymentLink);
router.post('/:id/send', requireAuth, authorize('admin', 'salesRep'), invoiceController.sendInvoice);
router.post('/:id/resend-voice', internalTokenAuth, invoiceController.resendInvoiceForVoice);
router.post('/:id/viewed', invoiceController.markInvoiceViewed);
router.post('/:id/remind', requireAuth, authorize('admin', 'salesRep'), invoiceController.sendPaymentReminder);

export default router;

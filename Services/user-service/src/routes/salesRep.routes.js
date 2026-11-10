import express from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import {
  getAllSalesReps, getSalesRepById, createSalesRep, updateSalesRep, deleteSalesRep,
  getSalesRepStats, toggleSalesRepStatus,
  getSalesRepPerformance, updateSalesRepCommission, getOnlineSalesReps,
  getInternalNotifyTargets,
} from '../controllers/salesRep.controller.js';

const router = express.Router();
router.get('/internal/notify-targets', (req, res, next) => {
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}, getInternalNotifyTargets);

router.use(requireAuth, authorize('admin'));

router.get('/', getAllSalesReps);
router.post('/', createSalesRep);
router.get('/stats', getSalesRepStats);
router.get('/online-status', getOnlineSalesReps);
router.get('/:id', getSalesRepById);
router.get('/:id/performance', getSalesRepPerformance);
router.put('/:id', updateSalesRep);
router.patch('/:id/commission', updateSalesRepCommission);
router.patch('/:id/toggle-status', toggleSalesRepStatus);
router.delete('/:id', deleteSalesRep);

export default router;

import express from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import {
  getAllVendors, getVendorById, createVendor, updateVendor, deleteVendor,
  getVendorStats, toggleVendorStatus, getVendorPerformance,
  updateVendorStatus, updateVendorRating, getVendorsByServiceType,
} from '../controllers/vendor.controller.js';

const router = express.Router();
router.use(requireAuth, authorize('admin'));

router.get('/', getAllVendors);
router.post('/', createVendor);
router.get('/stats', getVendorStats);
router.get('/by-service/:serviceType', getVendorsByServiceType);
router.get('/:id', getVendorById);
router.get('/:id/performance', getVendorPerformance);
router.put('/:id', updateVendor);
router.patch('/:id/status', updateVendorStatus);
router.patch('/:id/rating', updateVendorRating);
router.patch('/:id/toggle-status', toggleVendorStatus);
router.delete('/:id', deleteVendor);

export default router;

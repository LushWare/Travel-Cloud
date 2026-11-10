import express from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import {
  getCurrentUserProfile, updateCurrentUserProfile, getAllUsers, getUser,
  createUser, updateUser, deleteUser, toggleUserStatus,
  getUsersByRole, assignUserRole, getUserStats,
} from '../controllers/user.controller.js';

const router = express.Router();
router.use(requireAuth);

router.get('/profile/me', getCurrentUserProfile);
router.put('/profile', updateCurrentUserProfile);

router.use(authorize('admin'));

router.get('/stats', getUserStats);
router.get('/', getAllUsers);
router.post('/', createUser);
router.get('/role/:role', getUsersByRole);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.patch('/:id/toggle-status', toggleUserStatus);
router.patch('/:id/role', assignUserRole);

export default router;

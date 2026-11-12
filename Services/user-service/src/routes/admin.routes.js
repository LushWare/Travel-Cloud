import express from 'express';
import { requireAuth, authorize } from '../middleware/auth.js';
import {
  getDashboardStats, getAllUsers, getUserById, updateUserStatus,
  updateUser, deleteUser, updateAdminPermissions, getAdminPermissions,
  getAvailablePermissions, promoteSuperAdmin, demoteSuperAdmin, getSuperAdminInfo,
  listSuperAdmins, createStaff, getSettings, updateSettings, getInternalOrganizationSettings,
  getOrganizationBranding,
  getAgencyPlan,
} from '../controllers/admin.controller.js';
import {
  getPolicyDocuments, getPolicyDocument, postPolicyDocument, putPolicyDocument,
  deletePolicyDocumentHandler, getInternalPolicyDocuments,
} from '../controllers/policyDocuments.controller.js';
import { listAuditLog } from '../controllers/auditLog.controller.js';

const router = express.Router();

// Service-to-service (token-authenticated, not user auth) — must be registered
// before the requireAuth/authorize gate below. Consumed by billing-service for
// quotation/invoice generation; never reached through the gateway since callers
// hit user-service's own port directly (see Services/billing-service/src/config/orgSettings.js).
router.get('/internal/organization-settings', (req, res, next) => {
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}, getInternalOrganizationSettings);

// Service-to-service (token-authenticated) — consumed by package-service's
// trip-planning wizard; see getInternalOrganizationSettings above for the
// same convention.
router.get('/internal/policy-documents', (req, res, next) => {
  const token = req.headers['x-internal-token'];
  if (!token || token !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}, getInternalPolicyDocuments);

// Any logged-in Management user — see getOrganizationBranding for why this
// isn't behind the admin/superAdmin gate below.
router.get('/organization-branding', requireAuth, getOrganizationBranding);
router.use(requireAuth, authorize('admin', 'superAdmin'));

router.get('/stats', getDashboardStats);
router.get('/plan', getAgencyPlan);
router.get('/audit-log', listAuditLog);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

router.route('/policy-documents').get(getPolicyDocuments).post(postPolicyDocument);
router.route('/policy-documents/:id').get(getPolicyDocument).put(putPolicyDocument).delete(deletePolicyDocumentHandler);
router.get('/permissions/available', getAvailablePermissions);

router.route('/users').get(getAllUsers).post(createStaff);
router.route('/users/:id').get(getUserById).put(updateUser).delete(deleteUser);
router.patch('/users/:id/status', updateUserStatus);
router.route('/users/:id/permissions').get(getAdminPermissions).patch(updateAdminPermissions);

router.use(authorize('superAdmin'));
router.get('/super/info', getSuperAdminInfo);
router.get('/super/list', listSuperAdmins);
router.post('/super/promote', promoteSuperAdmin);
router.post('/super/demote', demoteSuperAdmin);

export default router;

import { Router } from 'express';
import { requireAuth, authorize, requirePackagePermissionForSalesRep } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  createPackageSchema,
  updatePackageSchema,
  packageIdParamSchema,
  packageImageParamSchema,
  packageCoverParamSchema,
  setPackageCoverSchema,
  generateAIPackageSchema,
  generateFromTitleSchema,
  generateItineraryPreviewSchema,
  generateDayPreviewSchema,
  generateDaysRangePreviewSchema,
  itineraryChatSchema,
  wizardTurnSchema,
} from '../validators/package.schema.js';
import * as packageController from '../controllers/package.controller.js';
import * as packageImageController from '../controllers/packageImage.controller.js';
import { requirePlanFeature } from '../services/plan.service.js';
import {
  generateAIPackage,
  generateContentFromTitle,
  generateAndSaveAIContent,
  previewAIContent,
  generateItineraryPreview,
  generateDayPreview,
  generateDaysRangePreview,
  itineraryChat,
} from '../controllers/aiPackage.controller.js';
import { downloadAIPdf } from '../controllers/aiPdf.controller.js';
import { wizardTurn } from '../controllers/wizard.controller.js';

const router = Router();
const requireAIBuilder = requirePlanFeature('ai_itinerary_builder');

// ── Public: static sub-paths must come before /:id ───────────────────────────
router.get('/featured/all',       packageController.getFeaturedPackages);
router.get('/stats/all',          packageController.getPackageStats);
router.get('/search/query',       packageController.searchPackages);
router.get('/category/:category', packageController.getPackagesByCategory);
router.get('/ai-status',          packageController.getAIStatus);

// ── Protected: admin-only multi-segment paths (before /:id catch-all) ────────
router.get('/protected/all', requireAuth, packageController.getPackages);

// ── Public: list and single-package view ─────────────────────────────────────
router.get('/', packageController.getPackages);
router.get('/:id', validateParams(packageIdParamSchema), packageController.getPackageById);

// ── AI: full-package generation ───────────────────────────────────────────────
router.post('/generate-ai',         requireAuth, authorize('admin', 'staff'), requireAIBuilder, validateBody(generateAIPackageSchema),  generateAIPackage);
router.post('/generate-from-title', requireAuth, authorize('admin', 'staff'), requireAIBuilder, validateBody(generateFromTitleSchema), generateContentFromTitle);
// Public: non-persisting customer-facing itinerary preview — no DB write, rate-limited at the gateway.
router.post('/generate-itinerary-preview', validateBody(generateItineraryPreviewSchema), generateItineraryPreview);
// Public: non-persisting conversational turn — no DB write, rate-limited at the gateway.
router.post('/itinerary-chat', validateBody(itineraryChatSchema), itineraryChat);
// Public: non-persisting trip-planning wizard turn — no DB write, rate-limited at the gateway.
router.post('/wizard-turn', validateBody(wizardTurnSchema), wizardTurn);
// Public: non-persisting single-day itinerary preview — no DB write, rate-limited at the gateway.
router.post('/generate-day-preview', validateBody(generateDayPreviewSchema), generateDayPreview);
// Public: non-persisting multi-day (sub-range) itinerary preview — no DB write, rate-limited at the gateway.
router.post('/generate-days-preview', validateBody(generateDaysRangePreviewSchema), generateDaysRangePreview);

// ── Pricing ───────────────────────────────────────────────────────────────────
router.post('/calculate-price', requireAuth, packageController.calculatePrice);

// ── Package CRUD ──────────────────────────────────────────────────────────────
router.post('/',      requireAuth, authorize('admin', 'staff', 'salesRep'), requirePackagePermissionForSalesRep, validateBody(createPackageSchema), packageController.createPackage);
router.put('/:id',    requireAuth, authorize('admin', 'staff', 'salesRep'), requirePackagePermissionForSalesRep, validateParams(packageIdParamSchema), validateBody(updatePackageSchema), packageController.updatePackage);
router.delete('/:id', requireAuth, authorize('admin', 'salesRep'),          requirePackagePermissionForSalesRep, validateParams(packageIdParamSchema), packageController.deletePackage);

// ── Per-package AI operations (two-segment paths — no conflict with /:id) ─────
router.post('/:id/generate-ai-content', requireAuth, authorize('admin', 'staff'), requireAIBuilder, generateAndSaveAIContent);
router.get('/:id/preview-ai-content',   requireAuth, authorize('admin', 'staff'), requireAIBuilder, previewAIContent);
router.get('/:id/ai-pdf',               requireAuth,                               downloadAIPdf);

// ── Misc per-package updates ──────────────────────────────────────────────────
router.post('/:id/increment-bookings', requireAuth, validateParams(packageIdParamSchema), packageController.incrementBookings);
router.post('/:id/update-rating',      requireAuth, validateParams(packageIdParamSchema), packageController.updatePackageRating);

// ── Per-package image management ───────────────────────────────────────────────
router.delete('/:packageId/images/:imageId', requireAuth, authorize('admin', 'staff'), validateParams(packageImageParamSchema), packageImageController.deletePackageImage);
router.put('/:packageId/cover',               requireAuth, authorize('admin', 'staff'), validateParams(packageCoverParamSchema), validateBody(setPackageCoverSchema), packageImageController.setPackageCover);

export default router;

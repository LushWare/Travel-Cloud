import { Router } from 'express';
import { extractActor, requireActor } from '../middleware/auth.js';
import { getRecommendations, updateRecommendationFeedback } from '../controllers/recommendations.controller.js';

const router = Router();
router.use(extractActor, requireActor);
router.get('/', getRecommendations);
router.post('/:id/feedback', updateRecommendationFeedback);

export default router;
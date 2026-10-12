import { z } from 'zod';
import { listRecommendations, saveRecommendationFeedback } from '../recommendationService.js';

const modules = ['dashboard', 'leads', 'packages', 'flights', 'hotels', 'billing', 'analytics', 'users'];
const statusValues = ['active', 'reviewed', 'completed', 'dismissed', 'all'];
const modes = ['ai', 'rules'];
const feedbackSchema = z.object({
  status: z.enum(['reviewed', 'completed', 'dismissed']),
  reason: z.string().trim().max(500).optional(),
});

export async function getRecommendations(req, res, next) {
  try {
    const module = req.query.module;
    const status = req.query.status || 'active';
    const mode = req.query.mode || 'ai';
    if (module && !modules.includes(module)) return res.status(400).json({ success: false, message: 'Invalid module' });
    if (!statusValues.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    if (!modes.includes(mode)) return res.status(400).json({ success: false, message: 'Invalid recommendation mode' });
    const data = await listRecommendations({
      actor: req.actor,
      module,
      status,
      mode,
      requestId: req.headers['x-request-id'],
    });
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

export async function updateRecommendationFeedback(req, res, next) {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      return res.status(400).json({ success: false, message: 'Invalid recommendation id' });
    }
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid feedback' });
    const updated = await saveRecommendationFeedback({
      actor: req.actor,
      recommendationId: req.params.id,
      ...parsed.data,
    });
    if (!updated) return res.status(404).json({ success: false, message: 'Recommendation not found' });
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
}
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { computePricing, toLineDescriptor } from '../services/pricing.service.js';
import { buildAutoCostLines } from '../services/lead-itinerary.service.js';
import { getLinePricing } from '../config/pricingDefaults.js';
import { resolveTaxRate } from '../services/taxRate.service.js';

/**
 * POST /api/v1/leads/pricing/preview — standalone preview for the new-lead
 * dialog (no lead/selection exists yet). Same engine, nothing persisted.
 */
export const previewPricing = asyncHandler(async (req, res) => {
  const { lines, days, travelers = 1, ...settings } = req.body;
  const resolvedLines = Array.isArray(lines)
    ? lines
    : Array.isArray(days)
      ? buildAutoCostLines(days, travelers, await getLinePricing()).map(toLineDescriptor)
      : [];
  if (!Array.isArray(lines) && !Array.isArray(days)) {
    throw new AppError('lines or days array is required', 400);
  }
  const { taxRate, ...rest } = settings;
  const computed = computePricing({ lines: resolvedLines, travelers, ...rest, taxRate: await resolveTaxRate({ taxRate }) });
  res.json({ success: true, data: { financials: computed } });
});

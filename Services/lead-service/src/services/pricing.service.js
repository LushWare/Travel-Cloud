import { computeQuote } from '../../../shared/lead-pricing-engine/src/index.js';
import { PRICING } from '../../../shared/constants/src/index.js';

/**
 * Convert a persisted LeadCostLine row (Prisma Decimal strings) into the
 * engine's line descriptor shape.
 */
export function toLineDescriptor(row) {
  return {
    category: row.category,
    description: row.description,
    basis: row.basis,
    quantity: row.quantity,
    estimatedUnit: Number(row.estimatedUnitPrice) || 0,
    actualUnit: row.actualUnitPrice != null ? Number(row.actualUnitPrice) : null,
    marginType: row.marginType || null,
    marginValue: row.marginValue != null ? Number(row.marginValue) : null,
    source: row.source,
  };
}

/**
 * Compute the full sell-side pricing for a lead and derive the deposit plan
 * amount and balance. Pure function — persistence happens in the controller.
 */
export function computePricing({
  lines = [],
  travelers = 1,
  currency = PRICING.DEFAULT_CURRENCY,
  marginType = null,
  marginValue = 0,
  depositType = null,
  depositValue = 0,
  discountType = 'none',
  discountValue = 0,
  serviceChargeRate = 0,
  verifiedPaymentTotal = 0,
  taxRate = 0,
} = {}) {
  const quote = computeQuote({
    lines,
    travelers,
    currency,
    marginType,
    marginValue,
    taxRate,
    discountType,
    discountValue,
    serviceChargeRate,
  });

  const rawDeposit =
    depositType === 'PERCENTAGE'
      ? quote.totalAmount * ((Number(depositValue) || 0) / 100)
      : depositType === 'FIXED'
        ? Number(depositValue) || 0
        : 0;
  const depositAmount = Math.round(rawDeposit * 100) / 100;
  const paidAmount = Math.round((Number(verifiedPaymentTotal) || 0) * 100) / 100;
  const balanceDue = Math.max(0, Math.round((quote.totalAmount - paidAmount) * 100) / 100);

  return {
    ...quote,
    // The rate the tax line was computed at, so labels show the real figure.
    taxRate: Number(taxRate) || 0,
    depositAmount,
    paidAmount,
    balanceDue,
  };
}

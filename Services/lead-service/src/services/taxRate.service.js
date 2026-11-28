import { getLinePricing } from '../config/pricingDefaults.js';

/**
 * A rep-entered tax %, or null when none was entered. Accepts 0–100 only;
 * anything else (blank, text, out of range) means "not set".
 */
export function parseTaxRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

/** The tax % a package is priced with: its own rate when set, else the Settings default. */
export async function resolveTaxRate(pricing) {
  const own = parseTaxRate(pricing?.taxRate);
  if (own !== null) return own;
  return Number((await getLinePricing()).taxRate) || 0;
}

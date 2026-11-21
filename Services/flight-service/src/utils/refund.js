/**
 * Booking columns for what the provider refunded on a cancellation, from Duffel's cancellation
 * ({ refundAmount, refundCurrency, refundTo } or its raw refund_amount/refund_currency/refund_to).
 * Missing or unreadable values are left out rather than stored as zero.
 */
export function refundFields(refund) {
  if (!refund || typeof refund !== 'object') return {};
  const amount = Number.parseFloat(refund.refundAmount ?? refund.refund_amount);
  const currency = refund.refundCurrency ?? refund.refund_currency;
  const to = refund.refundTo ?? refund.refund_to;
  return {
    ...(Number.isFinite(amount) && amount >= 0 && { refundAmount: amount }),
    ...(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) && { refundCurrency: currency }),
    ...(typeof to === 'string' && to.length <= 64 && { refundTo: to }),
  };
}

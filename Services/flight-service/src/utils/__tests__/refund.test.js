import { describe, expect, it } from 'vitest';
import { refundFields } from '../refund.js';

describe('refundFields', () => {
  it("reads Duffel's confirmed cancellation", () => {
    expect(refundFields({ refundAmount: '120.50', refundCurrency: 'USD', refundTo: 'balance' }))
      .toEqual({ refundAmount: 120.5, refundCurrency: 'USD', refundTo: 'balance' });
  });

  it("reads Duffel's raw webhook fields", () => {
    expect(refundFields({ refund_amount: '0.00', refund_currency: 'GBP', refund_to: 'airline_credits' }))
      .toEqual({ refundAmount: 0, refundCurrency: 'GBP', refundTo: 'airline_credits' });
  });

  it('stores nothing for a cancellation without refund details', () => {
    expect(refundFields(null)).toEqual({});
  });

  it('leaves out an unreadable amount instead of storing zero', () => {
    expect(refundFields({ refundAmount: 'n/a', refundCurrency: 'usd' })).toEqual({});
  });
});

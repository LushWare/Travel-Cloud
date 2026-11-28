import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  StateMachineError,
} from '../state-machine.service.js';

describe('validateTransition', () => {
  // ── Transition table ──────────────────────────────────────────

  it('allows NEW -> DRAFTING', () => {
    const r = validateTransition({ currentStatus: 'NEW', nextStatus: 'DRAFTING' });
    expect(r.nextStatus).toBe('DRAFTING');
  });

  it('allows DRAFTING -> QUOTED when sellSubtotal > 0', () => {
    const r = validateTransition({
      currentStatus: 'DRAFTING',
      nextStatus: 'QUOTED',
      pricing: { sellSubtotal: 1000 },
    });
    expect(r.nextStatus).toBe('QUOTED');
  });

  it('allows QUOTED -> REVISION', () => {
    const r = validateTransition({ currentStatus: 'QUOTED', nextStatus: 'REVISION' });
    expect(r.nextStatus).toBe('REVISION');
  });

  it('allows REVISION -> DRAFTING', () => {
    const r = validateTransition({ currentStatus: 'REVISION', nextStatus: 'DRAFTING' });
    expect(r.nextStatus).toBe('DRAFTING');
  });

  it('allows REVISION -> QUOTED', () => {
    const r = validateTransition({
      currentStatus: 'REVISION',
      nextStatus: 'QUOTED',
      pricing: { sellSubtotal: 1200 },
    });
    expect(r.nextStatus).toBe('QUOTED');
  });

  it('allows QUOTED -> APPROVED when a verified payment covers the deposit', () => {
    const r = validateTransition({
      currentStatus: 'QUOTED',
      nextStatus: 'APPROVED',
      pricing: { verifiedPaymentTotal: 500, depositAmount: 500 },
    });
    expect(r.nextStatus).toBe('APPROVED');
  });

  it('allows REVISION -> APPROVED when a verified payment covers the deposit', () => {
    const r = validateTransition({
      currentStatus: 'REVISION',
      nextStatus: 'APPROVED',
      pricing: { verifiedPaymentTotal: 300, depositAmount: 200 },
    });
    expect(r.nextStatus).toBe('APPROVED');
  });

  it('allows APPROVED -> BOOKING_IN_PROGRESS', () => {
    const r = validateTransition({ currentStatus: 'APPROVED', nextStatus: 'BOOKING_IN_PROGRESS' });
    expect(r.nextStatus).toBe('BOOKING_IN_PROGRESS');
  });

  it('allows BOOKING_IN_PROGRESS -> BOOKING_FAILED', () => {
    const r = validateTransition({ currentStatus: 'BOOKING_IN_PROGRESS', nextStatus: 'BOOKING_FAILED' });
    expect(r.nextStatus).toBe('BOOKING_FAILED');
  });

  it('allows BOOKING_FAILED -> BOOKING_IN_PROGRESS', () => {
    const r = validateTransition({ currentStatus: 'BOOKING_FAILED', nextStatus: 'BOOKING_IN_PROGRESS' });
    expect(r.nextStatus).toBe('BOOKING_IN_PROGRESS');
  });

  it('allows BOOKING_FAILED -> REVISION', () => {
    const r = validateTransition({ currentStatus: 'BOOKING_FAILED', nextStatus: 'REVISION' });
    expect(r.nextStatus).toBe('REVISION');
  });

  it('allows BOOKING_IN_PROGRESS -> CONFIRMED when flight and hotel actuals exist', () => {
    const r = validateTransition({
      currentStatus: 'BOOKING_IN_PROGRESS',
      nextStatus: 'CONFIRMED',
      pricing: { flightActualTotal: 300, hotelActualTotal: 200 },
    });
    expect(r.nextStatus).toBe('CONFIRMED');
    expect(r.recalculate).toBe(true);
  });

  it('allows CONFIRMED -> CANCELLED', () => {
    const r = validateTransition({ currentStatus: 'CONFIRMED', nextStatus: 'CANCELLED' });
    expect(r.nextStatus).toBe('CANCELLED');
  });

  it('treats same status as a no-op', () => {
    const r = validateTransition({ currentStatus: 'DRAFTING', nextStatus: 'DRAFTING' });
    expect(r.nextStatus).toBe('DRAFTING');
    expect(r.recalculate).toBe(false);
  });

  // ── Blocked transitions ───────────────────────────────────────

  it('blocks DRAFTING -> CONFIRMED (invalid jump)', () => {
    expect(() =>
      validateTransition({ currentStatus: 'DRAFTING', nextStatus: 'CONFIRMED' }),
    ).toThrow(StateMachineError);
  });

  it('blocks NEW -> APPROVED (invalid jump)', () => {
    expect(() =>
      validateTransition({ currentStatus: 'NEW', nextStatus: 'APPROVED' }),
    ).toThrow(StateMachineError);
  });

  it('blocks CONFIRMED -> DRAFTING (terminal)', () => {
    expect(() =>
      validateTransition({ currentStatus: 'CONFIRMED', nextStatus: 'DRAFTING' }),
    ).toThrow(StateMachineError);
  });

  it('blocks CLOSED_LOST -> anything (terminal)', () => {
    expect(() =>
      validateTransition({ currentStatus: 'CLOSED_LOST', nextStatus: 'NEW' }),
    ).toThrow(StateMachineError);
  });

  it('blocks CANCELLED -> anything (terminal)', () => {
    expect(() =>
      validateTransition({ currentStatus: 'CANCELLED', nextStatus: 'NEW' }),
    ).toThrow(StateMachineError);
  });

  it('throws when currentStatus is missing', () => {
    expect(() =>
      validateTransition({ currentStatus: null, nextStatus: 'DRAFTING' }),
    ).toThrow(StateMachineError);
  });

  it('throws for unknown statuses', () => {
    expect(() =>
      validateTransition({ currentStatus: 'BOGUS', nextStatus: 'DRAFTING' }),
    ).toThrow(StateMachineError);
  });

  // ── Gatekeeper: QUOTED sell price ────────────────────────────

  it('blocks DRAFTING -> QUOTED when sellSubtotal is missing', () => {
    expect(() =>
      validateTransition({ currentStatus: 'DRAFTING', nextStatus: 'QUOTED' }),
    ).toThrow(/sellSubtotal/);
  });

  it('blocks DRAFTING -> QUOTED when sellSubtotal is 0', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'DRAFTING',
        nextStatus: 'QUOTED',
        pricing: { sellSubtotal: 0 },
      }),
    ).toThrow(/sellSubtotal/);
  });

  // ── Gatekeeper: APPROVED deposit ─────────────────────────────

  it('blocks QUOTED -> APPROVED when no payment is recorded', () => {
    expect(() =>
      validateTransition({ currentStatus: 'QUOTED', nextStatus: 'APPROVED' }),
    ).toThrow(/verified payment/);
  });

  it('blocks QUOTED -> APPROVED when payment is below the deposit plan', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'QUOTED',
        nextStatus: 'APPROVED',
        pricing: { verifiedPaymentTotal: 200, depositAmount: 500 },
      }),
    ).toThrow(/verified payment/);
  });

  it('requires some payment even when the deposit plan is zero', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'QUOTED',
        nextStatus: 'APPROVED',
        pricing: { verifiedPaymentTotal: 0, depositAmount: 0 },
      }),
    ).toThrow(/verified payment/);
  });

  // ── Gatekeeper: CONFIRMED actuals ────────────────────────────

  it('blocks BOOKING_IN_PROGRESS -> CONFIRMED without flight actuals', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'BOOKING_IN_PROGRESS',
        nextStatus: 'CONFIRMED',
        pricing: { flightActualTotal: 0, hotelActualTotal: 200 },
      }),
    ).toThrow(/actualFlightCost|flight/);
  });

  it('blocks BOOKING_IN_PROGRESS -> CONFIRMED without hotel actuals', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'BOOKING_IN_PROGRESS',
        nextStatus: 'CONFIRMED',
        pricing: { flightActualTotal: 300 },
      }),
    ).toThrow(/actualHotelCost|hotel/);
  });

  // ── Gatekeeper: CLOSED_LOST reason ───────────────────────────

  it('blocks any -> CLOSED_LOST without lostReason', () => {
    expect(() =>
      validateTransition({ currentStatus: 'DRAFTING', nextStatus: 'CLOSED_LOST' }),
    ).toThrow(/lostReason/);
  });

  it('blocks CLOSED_LOST with a blank reason', () => {
    expect(() =>
      validateTransition({
        currentStatus: 'DRAFTING',
        nextStatus: 'CLOSED_LOST',
        lostReason: '   ',
      }),
    ).toThrow(/lostReason/);
  });

  it('allows DRAFTING -> CLOSED_LOST with a reason', () => {
    const r = validateTransition({
      currentStatus: 'DRAFTING',
      nextStatus: 'CLOSED_LOST',
      lostReason: 'Client went with a competitor',
    });
    expect(r.nextStatus).toBe('CLOSED_LOST');
  });

  // ── recalculate flag ─────────────────────────────────────────

  it('recalculate is false for non-CONFIRMED transitions', () => {
    const r = validateTransition({ currentStatus: 'NEW', nextStatus: 'DRAFTING' });
    expect(r.recalculate).toBe(false);
  });
});


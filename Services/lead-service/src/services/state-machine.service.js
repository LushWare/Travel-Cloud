import { ALLOWED_TRANSITIONS } from '../constants/lead-states.js';

export class StateMachineError extends Error {
  constructor(message, code = 'INVALID_TRANSITION') {
    super(message);
    this.code = code;
    this.name = 'StateMachineError';
    // A gatekeeper rule written for the caller, so the error handler may show it
    // verbatim. Recording that here keeps the decision with the message it is about.
    this.statusCode = 400;
    this.isOperational = true;
  }
}

/**
 * Validates a lifecycle status transition with gatekeeper rules.
 *
 * @param {Object} params
 * @param {string} params.currentStatus - Current lifecycleStatus (e.g. 'DRAFTING')
 * @param {string} params.nextStatus - Requested new status
 * @param {Object} [params.pricing={}] - LeadPricing-derived values:
 *   sellSubtotal, verifiedPaymentTotal, depositAmount,
 *   flightActualTotal, hotelActualTotal
 * @param {string} [params.lostReason] - Required when transitioning to CLOSED_LOST
 * @returns {{ nextStatus: string, recalculate: boolean }}
 * @throws {StateMachineError}
 */
export function validateTransition({ currentStatus, nextStatus, pricing = {}, lostReason }) {
  if (!currentStatus) {
    throw new StateMachineError('Lead has no current lifecycle status');
  }

  if (currentStatus === nextStatus) {
    return { nextStatus, recalculate: false };
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) {
    throw new StateMachineError(`Unknown status '${currentStatus}'`);
  }

  if (!allowed.includes(nextStatus)) {
    throw new StateMachineError(
      `Transition from '${currentStatus}' to '${nextStatus}' is not allowed`,
    );
  }

  const p = pricing || {};
  const sellSubtotal = Number(p.sellSubtotal) || 0;
  const verifiedPaymentTotal = Number(p.verifiedPaymentTotal) || 0;
  const depositAmount = Number(p.depositAmount) || 0;
  const flightActualTotal = Number(p.flightActualTotal) || 0;
  const hotelActualTotal = Number(p.hotelActualTotal) || 0;

  // Gatekeeper: DRAFTING -> QUOTED requires quotedSellingPrice > 0
  if (currentStatus === 'DRAFTING' && nextStatus === 'QUOTED') {
    if (sellSubtotal <= 0) {
      throw new StateMachineError(
        'Cannot transition to QUOTED: sellSubtotal must be greater than 0',
        'GATEKEEPER_QUOTED_PRICE',
      );
    }
  }

  // Gatekeeper: QUOTED/REVISION -> APPROVED requires depositPaid > 0
  if ((currentStatus === 'QUOTED' || currentStatus === 'REVISION') && nextStatus === 'APPROVED') {
    const required = depositAmount > 0 ? depositAmount : 0;
    if (!(verifiedPaymentTotal > 0 && verifiedPaymentTotal >= required)) {
      throw new StateMachineError(
        'Cannot transition to APPROVED: a verified payment covering the deposit is required',
        'GATEKEEPER_APPROVED_DEPOSIT',
      );
    }
  }

  // Gatekeeper: BOOKING_IN_PROGRESS -> CONFIRMED requires both actual costs > 0
  if (currentStatus === 'BOOKING_IN_PROGRESS' && nextStatus === 'CONFIRMED') {
    if (flightActualTotal <= 0 || hotelActualTotal <= 0) {
      throw new StateMachineError(
        'Cannot transition to CONFIRMED: flight and hotel actuals must both be greater than 0',
        'GATEKEEPER_CONFIRMED_ACTUALS',
      );
    }
  }

  // Gatekeeper: any -> CLOSED_LOST requires lostReason
  if (nextStatus === 'CLOSED_LOST') {
    if (!lostReason || lostReason.trim().length === 0) {
      throw new StateMachineError(
        'Cannot transition to CLOSED_LOST: lostReason is required',
        'GATEKEEPER_LOST_REASON',
      );
    }
  }

  const recalculate = currentStatus === 'BOOKING_IN_PROGRESS' && nextStatus === 'CONFIRMED';

  return { nextStatus, recalculate };
}


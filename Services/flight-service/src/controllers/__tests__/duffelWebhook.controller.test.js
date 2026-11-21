import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantId } from '../../../../shared/tenancy/src/index.js';

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  getOrder: vi.fn(),
  email: vi.fn(),
  tenantSeen: [],
}));
vi.mock('../../db/client.js', () => ({
  default: { flightBooking: { findFirst: mocks.findFirst, update: mocks.update } },
}));
vi.mock('../../clients/agencyDuffel.js', async (original) => ({
  ...(await original()),
  getAgencyDuffelCredentials: mocks.credentials,
}));
vi.mock('../../services/notify.js', () => ({ emailAirlineChange: mocks.email }));
vi.mock('../../clients/duffel.client.js', () => ({
  DuffelClient: class {
    constructor(account) { this.account = account; }
    getOrder(id) { return mocks.getOrder(id, this.account); }
  },
}));

const { handleAgencyDuffelWebhook } = await import('../duffelWebhook.controller.js');

const AGENCY = '22222222-2222-4222-8222-222222222222';
const SECRET = 'whsec_agency';
const event = { id: 'wev_1', type: 'air.order.changed', live_mode: false, data: { object: { id: 'ord_123' } } };

function signedRequest(body, secret = SECRET, tenantId = AGENCY) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return {
    params: { tenantId },
    body,
    rawBody,
    requestId: 'req-1',
    get: (name) => (name === 'x-duffel-signature' ? `t=${t},v1=${v1}` : undefined),
    log: { info: vi.fn(), warn: vi.fn() },
  };
}

const call = async (req) => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  await handleAgencyDuffelWebhook(req, res, next);
  return { res, next };
};

beforeEach(() => {
  for (const mock of [mocks.credentials, mocks.findFirst, mocks.update, mocks.getOrder, mocks.email]) mock.mockReset();
  mocks.credentials.mockImplementation(async () => {
    mocks.tenantSeen.push(getTenantId());
    return { accessToken: 'duffel_test_agency1234567', webhookSecret: SECRET, mode: 'test' };
  });
  mocks.findFirst.mockResolvedValue({ id: 'booking-1', status: 'confirmed', airlineChangeAt: null, airlineChangeKind: null });
  mocks.getOrder.mockResolvedValue({ status: 'confirmed', pnr: 'ABC123' });
  mocks.update.mockImplementation(async ({ data }) => ({ id: 'booking-1', ...data }));
  mocks.tenantSeen.length = 0;
});

describe("an agency's Duffel webhook", () => {
  it('updates the booking when signed with that agency\'s secret', async () => {
    const { res } = await call(signedRequest(event));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'booking-1' }, data: expect.objectContaining({ status: 'confirmed', pnr: 'ABC123' }) }));
  });

  it('runs inside the agency named in the address', async () => {
    await call(signedRequest(event));

    expect(mocks.tenantSeen).toEqual([AGENCY]);
  });

  it("reads the order with the agency's own Duffel token", async () => {
    await call(signedRequest(event));

    expect(mocks.getOrder).toHaveBeenCalledWith('ord_123', { accessToken: 'duffel_test_agency1234567', cardCheckoutEnabled: false });
  });

  it("refuses a message signed with another account's secret", async () => {
    const { next } = await call(signedRequest(event, 'whsec_someone_else'));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: 'INVALID_WEBHOOK_SIGNATURE' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('refuses when the agency has no Duffel connection', async () => {
    mocks.credentials.mockResolvedValue(null);

    const { next } = await call(signedRequest(event));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it('refuses an address that is not an agency id, without looking anything up', async () => {
    const { next } = await call(signedRequest(event, SECRET, 'not-a-uuid'));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    expect(mocks.credentials).not.toHaveBeenCalled();
  });

  it('refuses a live event for a test account', async () => {
    const { next } = await call(signedRequest({ ...event, live_mode: true }));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'WEBHOOK_MODE_MISMATCH' });
  });
});

describe('airline changes and outside cancellations', () => {
  const updateData = () => mocks.update.mock.calls[0][0].data;

  it('flags an airline schedule change on the booking', async () => {
    await call(signedRequest({ ...event, type: 'order.airline_initiated_change_detected' }));

    expect(updateData()).toMatchObject({ airlineChangeKind: 'changed', airlineChangeAt: expect.any(Date) });
  });

  it('emails the rep about an airline schedule change', async () => {
    await call(signedRequest({ ...event, type: 'order.airline_initiated_change_detected' }));

    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1' }), 'changed');
  });

  it('flags a cancellation the CRM did not make', async () => {
    mocks.getOrder.mockResolvedValue({ status: 'cancelled', cancelledAt: '2027-01-02T10:00:00Z' });

    await call(signedRequest(event));

    expect(updateData()).toMatchObject({ status: 'cancelled', airlineChangeKind: 'cancelled', cancelledAt: new Date('2027-01-02T10:00:00Z') });
    expect(mocks.email).toHaveBeenCalledWith(expect.anything(), 'cancelled');
  });

  it('does not flag a cancellation the rep made in the CRM', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'booking-1', status: 'cancelled' });
    mocks.getOrder.mockResolvedValue({ status: 'cancelled' });

    await call(signedRequest(event));

    expect(updateData().airlineChangeKind).toBeUndefined();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('emails once when Duffel sends the same change twice', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'booking-1', status: 'confirmed', airlineChangeKind: 'changed', airlineChangeAt: new Date() });

    await call(signedRequest({ ...event, type: 'order.airline_initiated_change_detected' }));

    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('saves the refund from a cancellation confirmed in Duffel', async () => {
    mocks.getOrder.mockResolvedValue({ status: 'cancelled' });
    const cancellation = {
      ...event,
      type: 'order_cancellation.confirmed',
      data: { object: { id: 'ore_1', order_id: 'ord_123', refund_amount: '80.00', refund_currency: 'USD', refund_to: 'balance' } },
    };

    await call(signedRequest(cancellation));

    expect(updateData()).toMatchObject({ refundAmount: 80, refundCurrency: 'USD', refundTo: 'balance' });
  });

  it('keeps the booking update when the email fails', async () => {
    mocks.email.mockResolvedValue(false);

    const { res } = await call(signedRequest({ ...event, type: 'order.airline_initiated_change_detected' }));

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

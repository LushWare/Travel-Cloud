import crypto from 'node:crypto';
import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';

const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

function isValidSignature(rawBody, header, secret) {
  const fields = String(header || '').split(',').map((field) => field.split('='));
  const timestamp = fields.find(([key]) => key === 't')?.[1];
  const signatures = fields
    .filter(([key]) => key === 'v1' || key === 'v2')
    .map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > WEBHOOK_TOLERANCE_MS) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();

  return signatures.some((signature) => {
    if (!/^[a-f\d]{64}$/i.test(signature)) return false;
    const received = Buffer.from(signature, 'hex');
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  });
}

async function findBookingByOffer(offerId, statuses) {
  if (typeof offerId !== 'string') return null;
  return prisma.flightBooking.findFirst({
    where: {
      status: { in: statuses },
      searchSnapshot: { path: ['offerId'], equals: offerId },
    },
    orderBy: { createdAt: 'desc' },
  });
}

const findPendingBooking = (offerId) => findBookingByOffer(offerId, ['pending']);

async function findBookingByOrderId(orderId) {
  if (typeof orderId !== 'string') return null;
  return prisma.flightBooking.findFirst({ where: { travelportOrderId: orderId } });
}

export const handleDuffelWebhook = asyncHandler(async (req, res) => {
  const secret = process.env.DUFFEL_WEBHOOK_SECRET;
  if (!secret) throw new AppError('Duffel webhook is not configured.', 503, { code: 'WEBHOOK_UNAVAILABLE' });

  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody) || !isValidSignature(rawBody, req.get('x-duffel-signature'), secret)) {
    throw new AppError('Invalid Duffel webhook signature.', 401, { code: 'INVALID_WEBHOOK_SIGNATURE' });
  }

  const event = req.body;
  const usingTestToken = process.env.DUFFEL_ACCESS_TOKEN?.startsWith('duffel_test_') ?? false;
  if (typeof event?.live_mode === 'boolean' && event.live_mode === usingTestToken) {
    throw new AppError('Duffel webhook mode does not match this service.', 403, { code: 'WEBHOOK_MODE_MISMATCH' });
  }

  const supportedEvents = [
    'order.created',
    'order.creation_failed',
    'air.order.changed',
    'order.airline_initiated_change_detected',
    'order_cancellation.confirmed',
  ];
  if (!supportedEvents.includes(event?.type)) {
    return res.status(200).json({ success: true, ignored: true });
  }

  const object = event.data?.object || {};
  const offerId = object.offer_id
    || object.offer?.id
    || (event.idempotency_key?.startsWith('off_') ? event.idempotency_key : undefined);
  const orderId = [object.id, object.order_id, object.order?.id, event.idempotency_key]
    .find((value) => typeof value === 'string' && value.startsWith('ord_'));

  if (event.type === 'order.creation_failed') {
    const booking = await findPendingBooking(offerId);
    if (!booking) {
      const failedBooking = await findBookingByOffer(offerId, ['failed']);
      if (failedBooking) return res.status(200).json({ success: true, duplicate: true });
      req.log.warn({ eventType: event.type, eventId: event.id }, 'No pending flight booking matched Duffel failure event');
      return res.status(503).json({ success: false });
    }
    await prisma.flightBooking.update({
      where: { id: booking.id },
      data: { status: 'failed' },
    });
    req.log.warn({ bookingId: booking.id, eventId: event.id }, 'Duffel order creation failed');
    return res.status(200).json({ success: true });
  }

  if (typeof orderId !== 'string' || !orderId.startsWith('ord_')) {
    req.log.warn({ eventType: event.type, eventId: event.id }, 'Duffel order webhook has no order ID');
    return res.status(200).json({ success: true, ignored: true });
  }

  const booking = await findBookingByOrderId(orderId) || await findPendingBooking(offerId);
  if (!booking) {
    req.log.warn({ eventId: event.id, orderId }, 'No local flight booking matched Duffel order event; requesting retry');
    return res.status(503).json({ success: false });
  }

  const order = await req.flightClient.getOrder(orderId);
  await prisma.flightBooking.update({
    where: { id: booking.id },
    data: {
      ...(order.travelportOrderId && { travelportOrderId: order.travelportOrderId }),
      ...(order.pnr && { pnr: order.pnr }),
      status: order.status || 'pending',
      ...(order.totalAmount != null && { totalAmount: order.totalAmount }),
      ...(order.currency && { currency: order.currency }),
    },
  });

  req.log.info({ bookingId: booking.id, eventId: event.id, orderId, status: order.status }, 'Duffel order synchronized from webhook');
  res.status(200).json({ success: true });
});

export { isValidSignature };
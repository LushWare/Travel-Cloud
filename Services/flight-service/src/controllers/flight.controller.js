import crypto from 'crypto';
import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { SALES_REP } from '../constants/roles.js';
import { CREATED, BAD_REQUEST, NOT_FOUND, SERVICE_UNAVAILABLE } from '../constants/httpStatus.js';
import { BOOKING_NOT_FOUND, BOOKING_ALREADY_CANCELLED } from '../constants/errorMessages.js';

// Every booking read returns its segments in journey order: sequence is the
// provider's own ordering key, and route/departure rendering depends on it.
const BOOKING_INCLUDE = {
  segments: { orderBy: { sequence: 'asc' } },
  travelers: true,
};

// ── cross-schema helpers (mirrors Services/booking-service's pattern) ─────

async function findUserByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT id, name, email, phone
    FROM crm_users."User"
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function createCustomerUser({ name, email, phone }) {
  const id = crypto.randomUUID();
  const bcrypt = await import('bcryptjs');
  const randomPassword = crypto.randomBytes(12).toString('hex');
  const hashedPassword = await bcrypt.default.hash(randomPassword, 12);
  await prisma.$executeRaw`
    INSERT INTO crm_users."User"
      (id, name, email, phone, password, role, "isTempPassword", "mustChangePassword", "isActive", "isEmailVerified", "createdAt", "updatedAt")
    VALUES
      (${id}, ${name}, ${email}, ${phone || null}, ${hashedPassword},
       'customer'::"crm_users"."UserRole",
       true, true, true, false, NOW(), NOW())
  `;
  return { id, name, email, phone };
}

async function findOrCreateCustomer({ name, email, phone }) {
  const sanitizedEmail = String(email).trim().toLowerCase();
  const existing = await findUserByEmail(sanitizedEmail);
  if (existing) return existing;
  return createCustomerUser({ name: name?.trim() || 'Traveler', email: sanitizedEmail, phone });
}

// ── controllers ────────────────────────────────────────────────────────

export const search = asyncHandler(async (req, res) => {
  const { origin, destination, departureDate, returnDate, adults, children, infants, childAges, infantAges, cabinClass, tripType } = req.body;

  const offers = await req.flightClient.searchFlights({
    origin,
    destination,
    departureDate,
    returnDate: returnDate || undefined,
    adults: adults ?? 1,
    children: children ?? 0,
    infants: infants ?? 0,
    childAges,
    infantAges,
    cabinClass: cabinClass || 'Economy',
    tripType: tripType || (returnDate ? 'roundTrip' : 'oneWay'),
  });

  req.log.info({ origin, destination, departureDate, count: offers.length }, 'Flight search completed');
  res.json({ success: true, data: offers });
});

export const price = asyncHandler(async (req, res) => {
  const result = await req.flightClient.priceOffer(req.body.offerId, req.body);
  res.json({ success: true, data: result });
});

export const getCheckoutData = asyncHandler(async (req, res) => {
  if (typeof req.flightClient.getCheckoutData !== 'function') {
    throw new AppError('Duffel checkout options are unavailable for this provider.', SERVICE_UNAVAILABLE, {
      code: 'PROVIDER_UNAVAILABLE',
    });
  }

  const data = await req.flightClient.getCheckoutData(req.params.offerId);
  res.json({ success: true, data });
});

export const book = asyncHandler(async (req, res) => {
  const { offer, tripType, travelers, contact, services = [], payment, expectedTotal, expectedCurrency } = req.body;

  const customer = await findOrCreateCustomer(contact);

  const order = await req.flightClient.createOrder({
    offerId: offer.offerId,
    travelers,
    contact,
    services,
    payment,
    totalAmount: expectedTotal ?? offer.fareTotal,
    currency: expectedCurrency || offer.currency,
  });

  const booking = await prisma.flightBooking.create({
    data: {
      pnr: order.pnr,
      travelportOrderId: order.travelportOrderId,
      createdById: req.user.id,
      customerId: customer.id,
      tripType: tripType || ((offer.legCount ?? 1) > 1 ? 'roundTrip' : 'oneWay'),
      cabinClass: offer.cabinClass || 'Economy',
      currency: offer.currency || 'USD',
      baseFare: order.baseFare ?? offer.baseFare,
      taxes: order.taxes ?? offer.taxes,
      totalAmount: order.totalAmount ?? offer.fareTotal,
      status: order.status || 'pending',
      searchSnapshot: { ...offer, selectedServices: services },
      ticketingDeadline: order.ticketingDeadline ? new Date(order.ticketingDeadline) : undefined,
      bookedAt: new Date(),
      segments: {
        create: (offer.segments || []).map((seg) => ({
          sequence: seg.sequence,
          marketingCarrier: seg.marketingCarrier,
          operatingCarrier: seg.operatingCarrier,
          flightNumber: seg.flightNumber,
          bookingClass: seg.bookingClass,
          origin: seg.origin,
          destination: seg.destination,
          departureAt: new Date(seg.departureAt),
          arrivalAt: new Date(seg.arrivalAt),
          durationMinutes: seg.durationMinutes,
          stops: seg.stops || 0,
        })),
      },
      travelers: {
        create: travelers.map((t) => ({
          type: t.type || 'adult',
          title: t.title,
          firstName: t.firstName,
          lastName: t.lastName,
          dob: t.dob ? new Date(t.dob) : undefined,
          gender: t.gender,
          passportNumber: t.passportNumber,
          passportExpiry: t.passportExpiry ? new Date(t.passportExpiry) : undefined,
          nationality: t.nationality,
          frequentFlyerNumber: t.frequentFlyerNumber,
        })),
      },
    },
    include: BOOKING_INCLUDE,
  });

  req.log.info({ bookingId: booking.id, pnr: booking.pnr }, 'Flight booked');
  res.status(CREATED).json({ success: true, data: booking });
});

export const listBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit, sortBy = 'createdAt', order = 'desc' } = req.query;
  const isScopedToOwn = req.user.role === SALES_REP && !req.user.isSuperAdmin;
  const where = {
    ...(isScopedToOwn && { createdById: req.user.id }),
    ...(status && { status }),
  };

  const [bookings, total] = await Promise.all([
    prisma.flightBooking.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { [sortBy]: order },
      ...(limit && { skip: (page - 1) * limit, take: limit }),
    }),
    prisma.flightBooking.count({ where }),
  ]);

  res.json({
    success: true,
    data: bookings,
    pagination: {
      total,
      page,
      limit: limit ?? total,
      pages: limit ? Math.ceil(total / limit) : total > 0 ? 1 : 0,
    },
  });
});

export const getBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isScopedToOwn = req.user.role === SALES_REP && !req.user.isSuperAdmin;

  const booking = await prisma.flightBooking.findFirst({
    where: { id, ...(isScopedToOwn && { createdById: req.user.id }) },
    include: BOOKING_INCLUDE,
  });

  if (!booking) throw new AppError(BOOKING_NOT_FOUND, NOT_FOUND);

  let providerOrder = null;
  if (booking.travelportOrderId) {
    try {
      providerOrder = await req.flightClient.getOrder(booking.travelportOrderId);
    } catch (error) {
      req.log.warn({ bookingId: booking.id }, 'Could not refresh provider booking details');
    }
  }
  const canCancel = booking.status !== 'cancelled'
    && (providerOrder?.availableActions
      ? providerOrder.availableActions.includes('cancel')
      : Boolean(booking.travelportOrderId));

  res.json({ success: true, data: { ...booking, providerOrder, canCancel } });
});

export const createCancellationQuote = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isScopedToOwn = req.user.role === SALES_REP && !req.user.isSuperAdmin;
  const booking = await prisma.flightBooking.findFirst({
    where: { id, ...(isScopedToOwn && { createdById: req.user.id }) },
  });
  if (!booking) throw new AppError(BOOKING_NOT_FOUND, NOT_FOUND);
  if (booking.status === 'cancelled') throw new AppError(BOOKING_ALREADY_CANCELLED, BAD_REQUEST);
  if (!booking.travelportOrderId) {
    throw new AppError('The airline has not confirmed this booking yet, so it cannot be cancelled.', BAD_REQUEST, {
      code: 'BOOKING_NOT_CONFIRMED',
    });
  }

  if (typeof req.flightClient.createCancellationQuote === 'function') {
    const quote = await req.flightClient.createCancellationQuote(booking.travelportOrderId);
    return res.json({ success: true, data: { ...quote, quoteAvailable: true } });
  }

  res.json({
    success: true,
    data: {
      quoteAvailable: false,
      cancellationId: null,
      refundAmount: null,
      refundCurrency: null,
      refundTo: null,
      expiresAt: null,
      airlineCredits: [],
    },
  });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason, cancellationId } = req.body || {};
  const isScopedToOwn = req.user.role === SALES_REP && !req.user.isSuperAdmin;

  const booking = await prisma.flightBooking.findFirst({
    where: { id, ...(isScopedToOwn && { createdById: req.user.id }) },
  });
  if (!booking) throw new AppError(BOOKING_NOT_FOUND, NOT_FOUND);
  if (booking.status === 'cancelled') throw new AppError(BOOKING_ALREADY_CANCELLED, BAD_REQUEST);

  if (booking.travelportOrderId) {
    if (typeof req.flightClient.confirmCancellation === 'function') {
      if (!cancellationId) {
        throw new AppError('Request and review a cancellation quote before confirming cancellation.', BAD_REQUEST, {
          code: 'CANCELLATION_QUOTE_REQUIRED',
        });
      }
      await req.flightClient.confirmCancellation(booking.travelportOrderId, cancellationId);
    } else {
      await req.flightClient.cancelOrder(booking.travelportOrderId);
    }
  } else if (typeof req.flightClient.createCancellationQuote === 'function') {
    throw new AppError('The airline has not confirmed this booking yet, so it cannot be cancelled.', BAD_REQUEST, {
      code: 'BOOKING_NOT_CONFIRMED',
    });
  }

  const updated = await prisma.flightBooking.update({
    where: { id },
    data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: reason || undefined },
    include: BOOKING_INCLUDE,
  });

  res.json({ success: true, data: updated });
});

export const createLinksSession = asyncHandler(async (req, res) => {
  const client = req.flightClient;
  if (!client.createLinksSession) {
    throw new AppError('Duffel Links is only supported when Duffel is configured', BAD_REQUEST);
  }
  const session = await client.createLinksSession(req.body);
  res.status(200).json({ success: true, data: session });
});

import prisma from '../../db/client.js';
import asyncHandler from '../../utils/asyncHandler.js';
import AppError from '../../utils/appError.js';
import { createHotelClient } from '../clients/index.js';
import { SALES_REP } from '../../constants/roles.js';
import { CREATED, NOT_FOUND, BAD_REQUEST } from '../../constants/httpStatus.js';
import { BOOKING_NOT_FOUND, BOOKING_ALREADY_CANCELLED } from '../../constants/errorMessages.js';
import logger from '../../config/logger.js';

function getClient(req) {
  if (!req._hotelClient) req._hotelClient = createHotelClient();
  return req._hotelClient;
}

function getCancellationPolicies(booking) {
  const roomDetails = booking.roomDetails && typeof booking.roomDetails === 'object' ? booking.roomDetails : {};
  const searchSnapshot = booking.searchSnapshot && typeof booking.searchSnapshot === 'object' ? booking.searchSnapshot : {};
  return roomDetails.cancellationPolicies
    || searchSnapshot.cheapestRate?.cancellationPolicies
    || searchSnapshot.cancellationPolicies
    || null;
}

function getCancellationEligibility(booking, now = new Date()) {
  const status = String(booking.providerStatus || booking.status || '').toLowerCase();
  if (!['confirmed', 'pending'].includes(status)) {
    return { canCancel: false, cancellationUnavailableReason: 'Only active bookings can be cancelled.' };
  }
  if (!booking.liteapiBookingId) {
    return { canCancel: false, cancellationUnavailableReason: 'This booking has no provider reference, so it cannot be cancelled through the hotel provider.' };
  }
  const checkinDate = booking.checkin ? new Date(booking.checkin) : null;
  if (!checkinDate || Number.isNaN(checkinDate.getTime())) {
    return { canCancel: false, cancellationUnavailableReason: 'The booking check-in date is unavailable.' };
  }
  const checkinDay = booking.checkin instanceof Date
    ? checkinDate.toISOString().slice(0, 10)
    : String(booking.checkin).slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (checkinDay <= today) {
    return { canCancel: false, cancellationUnavailableReason: 'Cancellation is unavailable on or after the check-in date.' };
  }
  return { canCancel: true, cancellationUnavailableReason: null };
}

function withCancellationEligibility(booking) {
  return {
    ...booking,
    cancellationPolicies: getCancellationPolicies(booking),
    ...getCancellationEligibility(booking),
  };
}

// ── Controllers ──────────────────────────────────────────────────────

export const search = asyncHandler(async (req, res) => {
  const offers = await getClient(req).searchHotels(req.body);
  req.log.info({ count: offers.length }, 'Hotel search completed');
  res.json({ success: true, data: offers, total: offers.length });
});

export const getDetails = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getClient(req).getHotelDetails(req.body.hotelId || req.query.hotelId) });
});

export const getCities = asyncHandler(async (req, res) => {
  const cities = await getClient(req).getCities(req.query.countryCode);
  res.json({ success: true, data: cities });
});

export const getCountries = asyncHandler(async (_req, res) => {
  const countries = await getClient(_req).getCountries();
  res.json({ success: true, data: countries });
});

export const getHotelFilterOptions = asyncHandler(async (req, res) => {
  const options = await getClient(req).getHotelFilterOptions();
  res.json({ success: true, data: options });
});

export const getReviews = asyncHandler(async (req, res) => {
  const { hotelId, limit, offset, getSentiment } = req.body;
  res.json({
    success: true,
    data: await getClient(req).getHotelReviews(hotelId, { limit, offset, getSentiment }),
  });
});

export const prebook = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getClient(req).prebook(req.body) });
});

export const book = asyncHandler(async (req, res) => {
  const { prebookId, clientReference, guests, contact, holder, offer, payment } = req.body;

  const result = await getClient(req).book({ prebookId, clientReference, guests, contact, holder, payment });

  const booking = await prisma.hotelBooking.create({
    data: {
      liteapiBookingId: result.bookingId,
      hotelId: offer?.hotelId || 'unknown',
      hotelName: result.hotelName || offer?.name || 'Unknown',
      hotelAddress: offer?.address || null,
      hotelImage: offer?.images?.[0] || null,
      checkin: new Date(result.checkin || offer?.checkin),
      checkout: new Date(result.checkout || offer?.checkout),
      currency: result.currency || 'USD',
      totalAmount: result.totalAmount || 0,
      status: 'confirmed',
      createdById: req.user?.id || 'unknown',
      guestInfo: guests,
      roomDetails: offer?.cheapestRate || {},
      searchSnapshot: { ...(offer || {}), clientReference: clientReference || null },
    },
  });

  req.log.info({ bookingId: booking.id }, 'Hotel booked');
  res.status(CREATED).json({ success: true, data: booking });
});

export const listBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit, sortBy = 'createdAt', order = 'desc' } = req.query;
  const isScoped = req.user?.role === SALES_REP && !req.user?.isSuperAdmin;
  const where = {
    ...(isScoped && { createdById: req.user.id }),
    ...(status && { status }),
  };

  const [bookings, total] = await Promise.all([
    prisma.hotelBooking.findMany({
      where,
      orderBy: { [sortBy]: order },
      ...(limit && { skip: (page - 1) * limit, take: limit }),
    }),
    prisma.hotelBooking.count({ where }),
  ]);
  res.json({
    success: true,
    data: bookings.map(withCancellationEligibility),
    pagination: {
      total,
      page,
      limit: limit ?? total,
      pages: limit ? Math.ceil(total / limit) : total > 0 ? 1 : 0,
    },
  });
});

export const getBooking = asyncHandler(async (req, res) => {
  const isScoped = req.user?.role === 'salesRep' && !req.user?.isSuperAdmin;
  const booking = await prisma.hotelBooking.findFirst({
    where: { id: req.params.id, ...(isScoped && { createdById: req.user.id }) },
  });
  if (!booking) throw new AppError(BOOKING_NOT_FOUND, NOT_FOUND);

  let providerBooking = null;
  let providerRefreshFailed = false;
  if (booking.liteapiBookingId) {
    try {
      providerBooking = await getClient(req).getBooking(booking.liteapiBookingId);
    } catch (error) {
      providerRefreshFailed = true;
      req.log.warn({ bookingId: booking.id, err: error }, 'Could not refresh hotel booking details from provider');
    }
  }

  const details = {
    ...booking,
    ...providerBooking,
    id: booking.id,
    liteapiBookingId: booking.liteapiBookingId,
    status: booking.status,
    hotelId: providerBooking?.hotelId || booking.hotelId,
    checkin: providerBooking?.checkin || booking.checkin,
    checkout: providerBooking?.checkout || booking.checkout,
    hotelName: providerBooking?.hotelName || booking.hotelName,
    hotelAddress: booking.hotelAddress || providerBooking?.address,
    totalAmount: providerBooking?.totalAmount ?? booking.totalAmount,
    currency: providerBooking?.currency || booking.currency,
    pnrCode: providerBooking?.pnr || booking.pnrCode,
    cancellationReason: providerBooking?.cancellationReason || booking.cancellationReason,
    providerStatus: providerBooking?.status || null,
    clientReference: providerBooking?.clientReference || null,
    commission: providerBooking?.commission ?? null,
    paymentStatus: providerBooking?.paymentStatus || null,
    paymentTransactionId: providerBooking?.paymentTransactionId || null,
    lastFreeCancellationDate: providerBooking?.lastFreeCancellationDate || null,
    refundableTag: providerBooking?.refundableTag || null,
    mandatoryFees: providerBooking?.mandatoryFees || null,
    optionalFees: providerBooking?.optionalFees || null,
    specialRemarks: providerBooking?.specialRemarks || null,
    knowBeforeYouGo: providerBooking?.knowBeforeYouGo || null,
    addons: providerBooking?.addons || [],
    addonsTotalAmount: providerBooking?.addonsTotalAmount || 0,
    amountRefunded: providerBooking?.amountRefunded || 0,
    refundType: providerBooking?.refundType || null,
    createdAt: providerBooking?.createdAt || booking.createdAt,
    bookedRooms: providerBooking?.bookedRooms || [],
    holder: providerBooking?.holder || null,
    cancellationPolicies: providerBooking?.cancellationPolicies || getCancellationPolicies(booking),
  };
  const enrichedDetails = withCancellationEligibility(details);
  if (providerRefreshFailed) {
    enrichedDetails.canCancel = false;
    enrichedDetails.cancellationUnavailableReason = 'Could not verify current cancellation eligibility with the hotel provider.';
  }
  res.json({ success: true, data: enrichedDetails });
});

export const cancelBooking = asyncHandler(async (req, res) => {
  const isScoped = req.user?.role === 'salesRep' && !req.user?.isSuperAdmin;
  const booking = await prisma.hotelBooking.findFirst({
    where: { id: req.params.id, ...(isScoped && { createdById: req.user.id }) },
  });
  if (!booking) throw new AppError(BOOKING_NOT_FOUND, NOT_FOUND);
  if (booking.status === 'cancelled') throw new AppError(BOOKING_ALREADY_CANCELLED, BAD_REQUEST);
  const localEligibility = getCancellationEligibility(booking);
  if (!localEligibility.canCancel) throw new AppError(localEligibility.cancellationUnavailableReason, BAD_REQUEST);
  const providerBooking = await getClient(req).getBooking(booking.liteapiBookingId);
  const eligibility = getCancellationEligibility({
    ...booking,
    providerStatus: providerBooking.status,
    checkin: providerBooking.checkin || booking.checkin,
  });
  if (!eligibility.canCancel) throw new AppError(eligibility.cancellationUnavailableReason, BAD_REQUEST);

  const cancellation = await getClient(req).cancelBooking(booking.liteapiBookingId, req.body?.reason);
  if (cancellation && !['cancelled', 'cancelled_with_charges'].includes(cancellation.status)) {
    throw new AppError('The hotel provider did not confirm this cancellation.', BAD_REQUEST);
  }

  const updated = await prisma.hotelBooking.update({
    where: { id: req.params.id },
    data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: req.body?.reason || null },
  });
  res.json({ success: true, data: { ...updated, cancellation } });
});

// ── Lead-scoped controllers ─────────────────────────────────────────

export const bookWithContext = asyncHandler(async (req, res) => {
  const { prebookId, clientReference, guests, contact, holder, offer, payment, leadId, packageId, customizedPackageId, dayNumber } = req.body;

  const result = await getClient(req).book({ prebookId, clientReference, guests, contact, holder, payment });

  const booking = await prisma.hotelBooking.create({
    data: {
      liteapiBookingId: result.bookingId,
      hotelId: offer?.hotelId || 'unknown',
      hotelName: result.hotelName || offer?.name || 'Unknown',
      hotelAddress: offer?.address || null,
      hotelImage: offer?.images?.[0] || null,
      checkin: new Date(result.checkin || offer?.checkin),
      checkout: new Date(result.checkout || offer?.checkout),
      currency: result.currency || 'USD',
      totalAmount: result.totalAmount || 0,
      status: 'confirmed',
      createdById: req.user?.id || 'unknown',
      customerId: contact?.customerId || null,
      guestInfo: guests,
      roomDetails: offer?.cheapestRate || {},
      searchSnapshot: { ...(offer || {}), clientReference: clientReference || null },
      leadId: leadId || null,
      packageId: packageId || null,
      customizedPackageId: customizedPackageId || null,
      dayNumber: dayNumber ? parseInt(dayNumber, 10) : null,
    },
  });

  req.log.info({ bookingId: booking.id, leadId, dayNumber }, 'Hotel booked with lead context');
  res.status(CREATED).json({ success: true, data: booking });
});

export const getHotelBookingsByLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const isScoped = req.user?.role === SALES_REP && !req.user?.isSuperAdmin;

  const bookings = await prisma.hotelBooking.findMany({
    where: { leadId, ...(isScoped && { createdById: req.user.id }) },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: bookings });
});

export const getEsimPackages = asyncHandler(async (req, res) => {
  const packages = await getClient(req).getEsimPackages(req.params.countryCode);
  res.json({ success: true, data: packages });
});
import crypto from 'crypto';
import { z } from 'zod';
import prisma from '../db/client.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { computeMargin } from '../../../shared/pricing-engine/src/index.js';

const normalizePhone = (phone) => {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : undefined;
};

// ── cross-schema helpers ──────────────────────────────────────────

async function findPackageById(id, client = prisma) {
  const rows = await client.$queryRaw`
    SELECT id, title, destination, "base_price" AS "basePrice",
           "default_margin_type" AS "defaultMarginType",
           "default_margin_input" AS "defaultMarginInput",
           "is_active" AS "isActive", "duration_days" AS "durationDays"
    FROM crm_packages."Package"
    WHERE id = ${id}
    LIMIT 1
  `;
  const pkg = rows[0];
  if (!pkg) return null;

  const basePrice = Number(pkg.basePrice);
  const defaultMarginInput = Number(pkg.defaultMarginInput);
  const sellPrice = computeMargin(basePrice, pkg.defaultMarginType, defaultMarginInput).sellPrice;
  // name/price aliases keep this helper's existing call sites (pkg.name, pkg.price) unchanged.
  return { ...pkg, name: pkg.title, price: sellPrice };
}

async function findUserByEmail(email, client = prisma) {
  const rows = await client.$queryRaw`
    SELECT id, name, email, phone
    FROM crm_users."User"
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function createCustomerUser({ name, email, phone }, client = prisma) {
  const id = crypto.randomUUID();
  const bcrypt = await import('bcryptjs');
  const randomPassword = crypto.randomBytes(12).toString('hex');
  const hashedPassword = await bcrypt.default.hash(randomPassword, 12);
  await client.$executeRaw`
    INSERT INTO crm_users."User"
      (id, name, email, phone, password, role, "isTempPassword", "mustChangePassword", "isActive", "isEmailVerified", "createdAt", "updatedAt")
    VALUES
      (${id}, ${name}, ${email}, ${phone || null}, ${hashedPassword},
       'customer'::"crm_users"."UserRole",
       true, true, true, false, NOW(), NOW())
  `;
  return { id, name, email, phone };
}

async function updateUserPhoneOrName(id, phone, name, client = prisma) {
  await client.$executeRaw`
    UPDATE crm_users."User"
    SET phone = COALESCE(phone, ${phone || null}),
        name  = COALESCE(NULLIF(name,''), ${name || null}),
        "updatedAt" = NOW()
    WHERE id = ${id}
  `;
}

async function autoAssignSalesRep() {
  const rows = await prisma.$queryRaw`
    SELECT id, "enabledSalesRepIds", "roundRobinIndex", "autoStrategy", "assignmentMode"
    FROM crm_leads."Settings"
    LIMIT 1
  `;
  const settings = rows[0];
  if (!settings || settings.assignmentMode !== 'auto') return null;
  if (settings.autoStrategy !== 'round_robin') return null;
  const reps = settings.enabledSalesRepIds || [];
  if (!reps.length) return null;

  const idx = settings.roundRobinIndex % reps.length;
  const assignedId = reps[idx];
  const nextIdx = (idx + 1) % reps.length;

  await prisma.$executeRaw`
    UPDATE crm_leads."Settings"
    SET "roundRobinIndex" = ${nextIdx}, "updatedAt" = NOW()
    WHERE id = ${settings.id}
  `;
  return assignedId;
}

async function findSalesRepEmail(id) {
  const rows = await prisma.$queryRaw`
    SELECT name, email FROM crm_users."User" WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

async function createLead({ name, email, phone, packageId, packageName, destination, travelDate, endDate, travelers, budget, message, assignedToId }) {
  const leadId = crypto.randomUUID();
  const source = 'booking';
  const platform = 'Website Form';
  const lifecycleStatus = 'NEW';
  const tags = ['website-booking'];
  await prisma.$executeRaw`
    INSERT INTO crm_leads."Lead"
      (id, name, email, phone, source, platform,
       destination, "destinationCountry", "travelDate", "endDate",
       "numberOfTravelers", budget, message, "lifecycleStatus", tags,
       "assignedToId", "assignmentMode", "leadDateTime", "createdAt", "updatedAt")
    VALUES
      (${leadId}, ${name}, ${email}, ${phone || null},
       ${source}::"crm_leads"."LeadSource",
       ${platform}::"crm_leads"."LeadPlatform",
       ${destination || null}, ${destination || null},
       ${travelDate || null}, ${endDate || null},
       ${travelers}, ${budget || null}, ${message || null},
       ${lifecycleStatus}::"crm_leads"."LeadLifecycleStatus",
       ${tags},
       ${assignedToId || null},
       ${assignedToId ? 'auto' : 'manual'}::"crm_leads"."AssignmentMode",
       NOW(), NOW(), NOW())
  `;

  // A lead's package association lives on LeadPackageSelection, not a
  // column on Lead itself — mirrors lead-service's own createLead controller
  // (create the selection, then point primarySelectionId at it).
  if (packageId) {
    const selectionId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO crm_leads."LeadPackageSelection"
        (id, "leadId", "packageId", "isManual", "packageName", "createdAt", "updatedAt")
      VALUES (${selectionId}, ${leadId}, ${packageId}, false, ${packageName || null}, NOW(), NOW())
    `;
    await prisma.$executeRaw`
      UPDATE crm_leads."Lead" SET "primarySelectionId" = ${selectionId} WHERE id = ${leadId}
    `;
  }

  if (message?.trim()) {
    const remarkId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO crm_leads."LeadRemark" (id, "leadId", text, "addedAt", date)
      VALUES (${remarkId}, ${leadId}, ${'Website inquiry: ' + message.trim()}, NOW(), NOW())
    `;
  }

  const histId = crypto.randomUUID();
  await prisma.$executeRaw`
    INSERT INTO crm_leads."LeadStatusHistory" (id, "leadId", status, "changedAt")
    VALUES (${histId}, ${leadId}, ${lifecycleStatus}, NOW())
  `;

  return leadId;
}

/** Replaces each row's raw base-price/margin columns with a computed sell price, matching package-service's own pricing math. */
function withPackageSellPrice(rows) {
  return rows.map(({ packageBasePrice, packageMarginType, packageMarginInput, ...rest }) => ({
    ...rest,
    packagePrice: packageBasePrice != null
      ? computeMargin(Number(packageBasePrice), packageMarginType, Number(packageMarginInput)).sellPrice
      : null,
  }));
}

async function incrementPackageBookings(packageId, client = prisma) {
  await client.$executeRaw`
    UPDATE crm_packages."Package"
    SET bookings = bookings + 1, "updatedAt" = NOW()
    WHERE id = ${packageId}
  `;
}

// ── controllers ───────────────────────────────────────────────────

export const createWebsiteBooking = asyncHandler(async (req, res) => {
  const { name, email, phone, travelers, travelDate, endDate, message, packageId } = req.body || {};

  if (!packageId) throw new AppError('packageId is required', 400);
  if (!email) throw new AppError('Email is required to create a booking', 400);

  const pkg = await findPackageById(packageId);
  if (!pkg) throw new AppError('Package not found', 404);

  const sanitizedEmail = String(email).trim().toLowerCase();
  const sanitizedName = name?.trim() || 'Website Traveler';
  const normalizedPhone = normalizePhone(phone);

  const parsedTravelers = Number(travelers) || 1;
  if (!Number.isFinite(parsedTravelers) || parsedTravelers < 1)
    throw new AppError('travelers must be a positive number', 400);

  const parsedTravelDate = travelDate ? new Date(travelDate) : null;
  if (!parsedTravelDate || Number.isNaN(parsedTravelDate.getTime()))
    throw new AppError('A valid travelDate is required', 400);

  const parsedEndDate = endDate ? new Date(endDate) : null;
  if (parsedEndDate && Number.isNaN(parsedEndDate.getTime()))
    throw new AppError('endDate is invalid', 400);
  if (parsedEndDate && parsedEndDate < parsedTravelDate)
    throw new AppError('endDate cannot be before travelDate', 400);

  let user = await findUserByEmail(sanitizedEmail);
  if (!user) {
    user = await createCustomerUser({ name: sanitizedName, email: sanitizedEmail, phone: normalizedPhone });
  } else if (!user.phone || !user.name) {
    await updateUserPhoneOrName(user.id, normalizedPhone, sanitizedName);
  }

  let assignedToId = null;
  try {
    assignedToId = await autoAssignSalesRep();
  } catch (e) {
    req.log.warn({ err: e }, 'Auto-assignment failed');
  }

  const booking = await prisma.booking.create({
    data: {
      userId: user.id,
      packageId: pkg.id,
      travelDate: parsedTravelDate,
      endDate: parsedEndDate || undefined,
      numberOfTravelers: parsedTravelers,
      totalAmount: pkg.price || 0,
      paidAmount: 0,
      paymentStatus: 'pending',
      bookingStatus: 'pending',
      specialRequests: message?.trim() || undefined,
      assignedToId: assignedToId || undefined,
    },
  });

  let leadId = null;
  try {
    leadId = await createLead({
      name: sanitizedName,
      email: sanitizedEmail,
      phone: normalizedPhone,
      packageId: pkg.id,
      packageName: pkg.name,
      destination: pkg.destination,
      travelDate: parsedTravelDate,
      endDate: parsedEndDate,
      travelers: parsedTravelers,
      budget: pkg.price ? `${pkg.price}` : undefined,
      message: message?.trim(),
      assignedToId,
    });
    await incrementPackageBookings(pkg.id);
  } catch (e) {
    await prisma.booking.delete({ where: { id: booking.id } }).catch(() => {});
    throw e;
  }

  if (assignedToId) {
    findSalesRepEmail(assignedToId).then(async (rep) => {
      if (rep?.email) {
        try {
          const { sendLeadAssignmentEmail } = await import('../utils/email.js');
          await sendLeadAssignmentEmail({
            salesRep: rep,
            lead: { id: leadId, name: sanitizedName, email: sanitizedEmail, phone: normalizedPhone, destination: pkg.destination },
            assignmentMode: 'auto',
          });
        } catch (e) {
          req.log.error({ err: e }, 'Failed to send assignment email');
        }
      }
    }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: 'Booking request submitted successfully',
    data: { bookingId: booking.id, leadId, salesRepId: assignedToId || null },
  });
});

const VoiceBookingRequest = z.object({
  conversationId: z.string().min(1).max(255),
  packageId: z.string().uuid(),
  bookingConfirmed: z.literal(true),
  searchPriceSnapshot: z.number().finite().nonnegative(),
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255),
  travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  travelers: z.number().int().min(1).max(50),
});

function parseDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

async function flagVoiceReview(tx, leadId, reason = 'package_changed_requires_repricing') {
  await tx.$executeRaw`
    UPDATE crm_leads."Lead"
    SET "voiceExactPackageMatch" = false, "voicePriceChanged" = true,
        "voiceNeedsRepReview" = true, "voiceReviewReason" = ${reason},
        "voiceAiBookingAllowed" = false, "needsRepFollowup" = true, "aiHandled" = true,
        "updatedAt" = NOW()
    WHERE id = ${leadId}
  `;
}

export const createVoiceBooking = asyncHandler(async (req, res) => {
  const parsed = VoiceBookingRequest.safeParse(req.body);
  if (!parsed.success) throw new AppError('Booking confirmation and complete traveler details are required', 400);
  const input = parsed.data;
  const travelDate = parseDate(input.travelDate);
  const requestedEndDate = input.endDate ? parseDate(input.endDate) : null;
  if (!travelDate || (input.endDate && !requestedEndDate) || (requestedEndDate && requestedEndDate < travelDate)) {
    throw new AppError('Travel dates are invalid', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.conversationId}))`;
    const calls = await tx.$queryRaw`
      SELECT id, "fromNumber", "leadId", disposition
      FROM crm_voice."VoiceCall"
      WHERE "conversationId" = ${input.conversationId}
      FOR UPDATE
    `;
    const call = calls[0];
    if (!call || call.disposition !== 'IN_PROGRESS') {
      throw new AppError('The voice call is no longer active', 409);
    }

    const pkg = await findPackageById(input.packageId, tx);
    if (!pkg || !pkg.isActive) throw new AppError('This package is no longer available', 409);
    const inferredEndDate = requestedEndDate || (pkg.durationDays
      ? new Date(travelDate.getTime() + (Number(pkg.durationDays) - 1) * 86400000)
      : null);

    const normalizedPhone = normalizePhone(call.fromNumber);
    if (!normalizedPhone) throw new AppError('A callable customer phone number is required', 400);

    let lead = null;
    if (call.leadId) {
      const leads = await tx.$queryRaw`
        SELECT id, name, email, "primarySelectionId", "convertedBookingId", "lifecycleStatus",
               "travelDate", "endDate", "numberOfTravelers",
               "voiceNeedsRepReview", "voicePriceChanged", "voiceReviewReason"
        FROM crm_leads."Lead"
        WHERE id = ${call.leadId}
        FOR UPDATE
      `;
      lead = leads[0] || null;
    }

    if (lead?.convertedBookingId) {
      const identityChanged = (lead.email && lead.email.trim().toLowerCase() !== input.email.toLowerCase())
        || (lead.name && lead.name.trim().toLowerCase() !== input.name.toLowerCase());
      if (identityChanged) {
        await flagVoiceReview(tx, lead.id, 'customer_identity_changed_requires_review');
        return { reviewRequired: true, leadId: lead.id, reason: 'customer_identity_changed_requires_review' };
      }
      const existingBooking = await tx.booking.findUnique({
        where: { id: lead.convertedBookingId },
        select: { packageId: true, travelDate: true, numberOfTravelers: true },
      });
      const sameRequest = existingBooking
        && existingBooking.packageId === input.packageId
        && existingBooking.travelDate?.toISOString().slice(0, 10) === input.travelDate
        && existingBooking.numberOfTravelers === input.travelers;
      if (sameRequest) {
        return { bookingId: lead.convertedBookingId, leadId: lead.id, alreadyCreated: true };
      }
      await flagVoiceReview(tx, lead.id);
      return { reviewRequired: true, leadId: lead.id, reason: 'booking_request_conflicts_with_existing' };
    }
    if (lead && ['CLOSED_LOST', 'CANCELLED', 'CONFIRMED', 'BOOKING_IN_PROGRESS'].includes(lead.lifecycleStatus)) {
      throw new AppError('This lead cannot be booked through the voice agent', 409);
    }
    if (lead?.email && lead.email.trim().toLowerCase() !== input.email.toLowerCase()) {
      await flagVoiceReview(tx, lead.id, 'customer_identity_changed_requires_review');
      return { reviewRequired: true, leadId: lead.id, reason: 'customer_identity_changed_requires_review' };
    }
    if (lead?.voiceNeedsRepReview || lead?.voicePriceChanged) {
      return {
        reviewRequired: true,
        leadId: lead.id,
        reason: lead.voiceReviewReason || 'package_changed_requires_repricing',
      };
    }
    if (Math.abs((pkg.price || 0) - input.searchPriceSnapshot) > 0.01) {
      if (lead) await flagVoiceReview(tx, lead.id);
      return { reviewRequired: true, leadId: lead?.id ?? null, reason: 'package_price_changed_since_search' };
    }
    const lockedLeadStatuses = ['QUOTED', 'REVISION', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'BOOKING_FAILED'];
    const requestDatesChanged = (lead?.travelDate
      && lead.travelDate.toISOString().slice(0, 10) !== input.travelDate)
      || (lead?.endDate && inferredEndDate
        && lead.endDate.toISOString().slice(0, 10) !== inferredEndDate.toISOString().slice(0, 10));
    const travelerCountChanged = lead?.numberOfTravelers != null
      && lead.numberOfTravelers !== input.travelers;
    if (lead && lockedLeadStatuses.includes(lead.lifecycleStatus) && (requestDatesChanged || travelerCountChanged)) {
      await flagVoiceReview(tx, lead.id, 'booking_details_changed_requires_review');
      return { reviewRequired: true, leadId: lead.id, reason: 'booking_details_changed_requires_review' };
    }

    let selection = null;
    if (lead) {
      const selections = await tx.$queryRaw`
        SELECT id, "packageId", "packageName", "currentQuoteId", "pendingAiChange"
        FROM crm_leads."LeadPackageSelection"
        WHERE "leadId" = ${lead.id}
        ORDER BY "createdAt" ASC
        FOR UPDATE
      `;
      const primary = selections.find((item) => item.id === lead.primarySelectionId) || selections[0] || null;
      if (primary && primary.packageId !== input.packageId) {
        await flagVoiceReview(tx, lead.id);
        return { reviewRequired: true, leadId: lead.id, reason: 'package_changed_requires_repricing' };
      }
      selection = selections.find((item) => item.packageId === input.packageId) || null;
      if (selection?.pendingAiChange) {
        await flagVoiceReview(tx, lead.id);
        return { reviewRequired: true, leadId: lead.id, reason: 'package_changed_requires_repricing' };
      }
    }

    if (!lead) {
      const leadId = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO crm_leads."Lead"
          (id, name, email, phone, "phoneNormalized", source, platform, "intakeChannel", "intakeSessionId",
           destination, "travelDate", "endDate", "numberOfTravelers", "lifecycleStatus", "aiHandled",
           "needsRepFollowup", "voiceExactPackageMatch", "voicePriceChanged", "voiceNeedsRepReview",
           "voiceAiBookingAllowed", "voiceCustomerIdentityConfirmed", "leadDateTime", "createdAt", "updatedAt")
        VALUES
          (${leadId}, ${input.name}, ${input.email.toLowerCase()}, ${normalizedPhone}, ${normalizedPhone},
           'voice_agent'::"crm_leads"."LeadSource", 'Voice_Agent'::"crm_leads"."LeadPlatform", 'voice',
           ${input.conversationId}, ${pkg.destination}, ${travelDate}, ${inferredEndDate}, ${input.travelers},
           'PENDING_VERIFICATION'::"crm_leads"."LeadLifecycleStatus", true, false, true, false, false, true, true,
           NOW(), NOW(), NOW())
      `;
      lead = { id: leadId, primarySelectionId: null };
      await tx.$executeRaw`
        INSERT INTO crm_leads."LeadStatusHistory" (id, "leadId", status, actor, "changedById", notes, "changedAt")
        VALUES (${crypto.randomUUID()}, ${leadId}, 'PENDING_VERIFICATION', 'SYSTEM', NULL,
                'Created by exact-package voice booking request', NOW())
      `;
    } else {
      await tx.$executeRaw`
        UPDATE crm_leads."Lead"
        SET name = ${input.name}, email = ${input.email.toLowerCase()},
            phone = COALESCE(phone, ${normalizedPhone}), "phoneNormalized" = COALESCE("phoneNormalized", ${normalizedPhone}),
            destination = ${pkg.destination}, "travelDate" = ${travelDate}, "endDate" = ${inferredEndDate},
            "numberOfTravelers" = ${input.travelers}, "aiHandled" = true, "needsRepFollowup" = false,
            "voiceExactPackageMatch" = true, "voicePriceChanged" = false, "voiceNeedsRepReview" = false,
            "voiceReviewReason" = NULL, "voiceAiBookingAllowed" = true,
            "voiceCustomerIdentityConfirmed" = true, "updatedAt" = NOW()
        WHERE id = ${lead.id}
      `;
    }

    if (!selection) {
      const selectionId = crypto.randomUUID();
      await tx.$executeRaw`
        INSERT INTO crm_leads."LeadPackageSelection"
          (id, "leadId", "packageId", "isManual", "packageName", "createdAt", "updatedAt")
        VALUES (${selectionId}, ${lead.id}, ${input.packageId}, false, ${pkg.name}, NOW(), NOW())
      `;
      await tx.$executeRaw`
        UPDATE crm_leads."Lead" SET "primarySelectionId" = ${selectionId} WHERE id = ${lead.id}
      `;
    }

    let totalAmount = pkg.price || 0;
    if (selection?.currentQuoteId) {
      const quotePricing = await tx.$queryRaw`
        SELECT "totalAmount"
        FROM crm_leads."LeadPricing"
        WHERE "leadPackageSelectionId" = ${selection.id}
        LIMIT 1
      `;
      const quotedAmount = Number(quotePricing[0]?.totalAmount);
      if (!Number.isFinite(quotedAmount) || quotedAmount <= 0
        || Math.abs(quotedAmount - input.searchPriceSnapshot) > 0.01) {
        const reason = Number.isFinite(quotedAmount) && quotedAmount > 0
          ? 'package_changed_requires_repricing'
          : 'quoted_price_unavailable';
        await flagVoiceReview(tx, lead.id, reason);
        return { reviewRequired: true, leadId: lead.id, reason };
      }
      totalAmount = quotedAmount;
    }

    const sanitizedEmail = input.email.toLowerCase();
    let user = await findUserByEmail(sanitizedEmail, tx);
    if (!user) user = await createCustomerUser({ name: input.name, email: sanitizedEmail, phone: normalizedPhone }, tx);
    else if (!user.phone || !user.name) await updateUserPhoneOrName(user.id, normalizedPhone, input.name, tx);

    const booking = await tx.booking.create({
      data: {
        userId: user.id,
        packageId: pkg.id,
        travelDate,
        endDate: inferredEndDate || undefined,
        numberOfTravelers: input.travelers,
        totalAmount,
        paidAmount: 0,
        paymentStatus: 'pending',
        bookingStatus: 'pending',
        specialRequests: 'Exact package booking request confirmed during voice call',
      },
    });

    await tx.$executeRaw`
      UPDATE crm_leads."Lead"
      SET "convertedBookingId" = ${booking.id}, "voiceExactPackageMatch" = true,
          "voicePriceChanged" = false, "voiceNeedsRepReview" = false, "voiceReviewReason" = NULL,
          "voiceAiBookingAllowed" = true, "voiceCustomerIdentityConfirmed" = true,
          "needsRepFollowup" = false, "updatedAt" = NOW()
      WHERE id = ${lead.id}
    `;
    await tx.$executeRaw`
      UPDATE crm_voice."VoiceCall" SET "leadId" = ${lead.id}, "needsRepFollowup" = false, "updatedAt" = NOW()
      WHERE id = ${call.id}
    `;
    await incrementPackageBookings(pkg.id, tx);
    return { bookingId: booking.id, leadId: lead.id, alreadyCreated: false };
  });

  if (result.reviewRequired) {
    return res.status(409).json({ success: false, data: { ...result, bookingId: null } });
  }
  res.status(result.alreadyCreated ? 200 : 201).json({
    success: true,
    data: { ...result, bookingStatus: 'pending' },
  });
});

export const getUserBookings = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('User ID is required', 401);

  const bookings = await prisma.$queryRaw`
    SELECT
      b.id, b."userId", b."packageId", b."travelDate", b."endDate",
      b."numberOfTravelers", b."totalAmount", b."paidAmount",
      b."paymentStatus", b."bookingStatus", b."specialRequests",
      b."createdAt", b."updatedAt",
      p.title AS "packageName", p.destination AS "packageDestination",
      p."duration_days" AS "packageDuration",
      p."base_price" AS "packageBasePrice",
      p."default_margin_type" AS "packageMarginType",
      p."default_margin_input" AS "packageMarginInput",
      p."cover_image" AS "packageCoverImage", p.slug AS "packageSlug"
    FROM crm_bookings."Booking" b
    LEFT JOIN crm_packages."Package" p ON p.id = b."packageId"
    WHERE b."userId" = ${userId}
    ORDER BY b."createdAt" DESC
  `;

  res.status(200).json({ success: true, data: withPackageSellPrice(bookings || []) });
});

export const getRecentBookings = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  const bookings = await prisma.$queryRaw`
    SELECT
      b.id, b."userId", b."packageId", b."travelDate", b."endDate",
      b."numberOfTravelers", b."totalAmount", b."paidAmount",
      b."paymentStatus", b."bookingStatus", b."specialRequests",
      b."confirmedAt", b."createdAt",
      p.title AS "packageName", p.destination AS "packageDestination",
      p."duration_days" AS "packageDuration",
      p."base_price" AS "packageBasePrice",
      p."default_margin_type" AS "packageMarginType",
      p."default_margin_input" AS "packageMarginInput",
      p."cover_image" AS "packageCoverImage", p.slug AS "packageSlug",
      u.name AS "userName", u.email AS "userEmail"
    FROM crm_bookings."Booking" b
    LEFT JOIN crm_packages."Package" p ON p.id = b."packageId"
    LEFT JOIN crm_users."User" u ON u.id = b."userId"
    WHERE b."bookingStatus" IN ('pending','confirmed','completed')
    ORDER BY b."confirmedAt" DESC NULLS LAST, b."createdAt" DESC
    LIMIT ${limit}
  `;

  res.status(200).json({ success: true, data: withPackageSellPrice(bookings || []) });
});

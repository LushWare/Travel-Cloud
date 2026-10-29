import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { createLeadSchema, updateLeadSchema, logCommunicationSchema, whatsappReplySchema, googleAdsLeadSchema } from '../validators/lead.validator.js';
import { sendWhatsappText } from '../services/notification.client.js';
import {
  validateTransition,
  validateTravelerUpdate,
  validateTravelDatesUpdate,
} from '../services/state-machine.service.js';
import { gatekeeperInputs, loadPrimarySelection } from '../services/gatekeeper.service.js';
import { normalizePhone, phoneMatchWhere } from '../utils/phone.js';
import { handleLeadEvent } from '../services/lead-events.service.js';
import { serializeLeadDays } from '../services/lead-itinerary.service.js';

// ─── Auto-assignment helper ────────────────────────────────────
// Must run inside the same transaction as the lead create it feeds, so the
// settings read + roundRobinIndex increment are atomic with each other under
// concurrent lead creation (otherwise two concurrent calls can read the same
// index and skip/duplicate a rep's turn).
async function autoAssignSalesRep(tx, leadData) {
  const settings = await tx.settings.upsert({
    where: { singletonKey: 1 },
    update: {},
    create: { singletonKey: 1 },
  });
  if (settings.assignmentMode === 'manual') return null;

  const enabledIds = settings.enabledSalesRepIds || [];
  if (!enabledIds.length) return null;

  if (settings.autoStrategy === 'round_robin') {
    const idx = settings.roundRobinIndex % enabledIds.length;
    const salesRepId = enabledIds[idx];
    await tx.settings.update({ where: { id: settings.id }, data: { roundRobinIndex: { increment: 1 } } });
    return salesRepId;
  }
  return null;
}

// ─── Controllers ───────────────────────────────────────────────

export const createLead = asyncHandler(async (req, res) => {
  const { user } = req;

  const {
    package: _pkg, assignedTo: _assignedTo, salesRep: _salesRep,
    customizedPackage: _custPkg, convertedBooking: _booking, createdBy: _createdBy,
    ...cleanCreateBody
  } = req.body;

  const parsed = createLeadSchema.safeParse(cleanCreateBody);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const body = { ...parsed.data };

  if (user.role === 'salesRep') {
    body.assignedToId = body.assignedToId || user.id;
    body.assignmentMode = 'manual';
    body.assignedById = user.id;
  }

  const remarksList = body.remarks || [];
  const lifecycleStatus = body.lifecycleStatus || 'NEW';
  const isManualItinerary = body.isManualItinerary || false;

  // A lead is created with at most one initial package selection — either
  // is optional (a bare contact-form-style lead may have neither yet).
  const initialSelection = isManualItinerary
    ? { isManual: true, packageId: null, packageName: null }
    : body.packageId
      ? { isManual: false, packageId: body.packageId, packageName: body.packageName || null }
      : null;

  const lead = await prisma.$transaction(async (tx) => {
    let assignedId = body.assignedToId;
    let assignmentMode = body.assignmentMode;
    if (!assignedId && user.role !== 'salesRep') {
      assignedId = await autoAssignSalesRep(tx, body);
      if (assignedId) assignmentMode = 'auto';
    }

    const created = await tx.lead.create({
      data: {
        name: body.name,
        email: body.email,
        phone: body.phone,
        whatsapp: body.whatsapp,
        phoneNormalized: normalizePhone(body.phone),
        whatsappNormalized: normalizePhone(body.whatsapp),
        city: body.city,
        source: body.source,
        platform: body.platform,
        fromCountry: body.fromCountry,
        destinationCountry: body.destinationCountry,
        destination: body.destination,
        travelDate: body.travelDate ? new Date(body.travelDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        numberOfTravelers: body.numberOfTravelers,
        budget: body.budget,
        message: body.message,
        lifecycleStatus,
        priority: body.priority,
        assignedToId: assignedId,
        ...(assignmentMode ? { assignmentMode } : {}),
        tags: body.tags || [],
        lostReason: body.lostReason,
        remarks: {
          create: remarksList.map((r) => ({
            text: r.text,
            date: r.date ? new Date(r.date) : new Date(),
            addedById: r.addedBy || user.id || null,
          })),
        },
        statusHistory: {
          create: [{ status: lifecycleStatus, actor: 'USER', changedById: user.id, notes: 'Initial status' }],
        },
        ...(initialSelection ? { packageSelections: { create: [initialSelection] } } : {}),
      },
      include: { remarks: true, statusHistory: true, packageSelections: true },
    });

    if (created.packageSelections.length) {
      await tx.lead.update({
        where: { id: created.id },
        data: { primarySelectionId: created.packageSelections[0].id },
      });
    }

    return tx.lead.findUnique({
      where: { id: created.id },
      include: { remarks: true, statusHistory: true, packageSelections: true },
    });
  });

  res.status(201).json({ success: true, data: lead });
});

export const getLeads = asyncHandler(async (req, res) => {
  const { user } = req;
  const {
    page = 1, limit = 10, ids, search, status, lifecycleStatus, source, platform,
    aiHandled, needsRepFollowup, needsRepAttention, voiceNeedsRepReview, aiVerified,
    sortBy = 'createdAt', order = 'desc',
  } = req.query;

  const where = { AND: [] };
  // The PENDING_VERIFICATION queue is visible to any salesRep regardless of
  // ownership — an unassigned, unclaimed lead must be listable before it can be
  // claimed (see the claim endpoint). Every other status keeps the normal
  // own-leads filter. Computed from the MERGED filter (not just lifecycleStatus)
  // so ?status=PENDING_VERIFICATION and ?lifecycleStatus=PENDING_VERIFICATION
  // behave identically — these are two aliases for the same DB column.
  const statusFilter = lifecycleStatus || status;
  const isPendingVerificationQueue = statusFilter === 'PENDING_VERIFICATION';
  const isRepAttentionQueue = needsRepAttention === 'true';
  if (user.role === 'salesRep') {
    if (isPendingVerificationQueue || isRepAttentionQueue) {
      where.AND.push({
        OR: [
          { assignedToId: user.id },
          { lifecycleStatus: 'PENDING_VERIFICATION', convertedBookingId: null },
        ],
      });
    } else {
      where.AND.push({ assignedToId: user.id });
    }
  }
  if (statusFilter) where.AND.push({ lifecycleStatus: statusFilter });
  // Comma-separated multi-select, matching how filterSources/filterPlatforms
  // are sent from Management's LeadFilters chips.
  if (source) where.AND.push({ source: { in: source.split(',') } });
  if (platform) where.AND.push({ platform: { in: platform.split(',') } });
  if (ids) where.AND.push({ id: { in: ids.split(',').filter(Boolean).slice(0, 200) } });

  // Voice-agent filters. Applied server-side rather than client-side over
  // already-loaded rows (as the platform chips do) because AI-touched leads
  // become the majority once the agent is live.
  if (aiHandled === 'true') where.AND.push({ aiHandled: true });
  if (needsRepAttention === 'true') {
    where.AND.push({
      OR: [
        { needsRepFollowup: true },
        { voiceNeedsRepReview: true },
        { lifecycleStatus: 'PENDING_VERIFICATION', convertedBookingId: null },
      ],
    });
  }
  if (needsRepFollowup === 'true') where.AND.push({ needsRepFollowup: true });
  if (voiceNeedsRepReview === 'true') where.AND.push({ voiceNeedsRepReview: true });
  if (aiVerified === 'true') where.AND.push({ aiVerifiedAt: { not: null } });
  if (aiVerified === 'false') where.AND.push({ aiHandled: true, aiVerifiedAt: null });

  if (search) {
    where.AND.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { destination: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (where.AND.length === 0) delete where.AND;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { [sortBy]: order },
      include: {
        packageSelections: { orderBy: { createdAt: 'asc' }, take: 1, include: { pricing: true } },
        remarks: { orderBy: { date: 'desc' } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({ success: true, data: leads, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
});

export const getLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      packageSelections: {
        orderBy: { createdAt: 'asc' },
        include: {
          pricing: true,
          costLines: { orderBy: { orderIndex: 'asc' } },
          itineraryDays: {
            orderBy: { dayNumber: 'asc' },
            include: {
              places: true,
              activities: true,
              transports: true,
              images: { orderBy: { orderIndex: 'asc' } },
            },
          },
          optionalFlights: true,
        },
      },
      remarks: { orderBy: { date: 'desc' } },
      statusHistory: { orderBy: { changedAt: 'desc' } },
      communicationLogs: true,
    },
  });
  if (!lead) throw new AppError(`Lead not found`, 404);

  const { user } = req;
  const canManage = user.isSuperAdmin || user.role === 'admin' || user.permissions.includes('manage_leads');
  if (!canManage && user.role === 'salesRep' && lead.assignedToId !== user.id) {
    // A salesRep may view an unclaimed PENDING_VERIFICATION lead — it must be
    // openable before it can be claimed. Any other status stays ownership-gated.
    if (lead.lifecycleStatus !== 'PENDING_VERIFICATION') {
      throw new AppError('Not authorized to access this lead', 403);
    }
  }

  const packageSelections = lead.packageSelections.map((selection) => ({
    ...selection,
    itineraryDays: serializeLeadDays(selection),
    isMaterialized: selection.itineraryDays.length > 0 || Boolean(selection.pricing),
  }));

  res.json({ success: true, data: { ...lead, packageSelections } });
});

export const updateLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const { user } = req;
  const canManage = user.isSuperAdmin || user.role === 'admin' || user.permissions.includes('manage_leads');
  if (!canManage && lead.assignedToId !== user.id) throw new AppError('Not authorized to update this lead', 403);

  const {
    package: _pkg, assignedTo: _assignedTo, salesRep: _salesRep,
    customizedPackage: _custPkg, convertedBooking: _booking, createdBy: _createdBy,
    ...cleanBody
  } = req.body;

  const parsed = updateLeadSchema.safeParse(cleanBody);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const validatedBody = parsed.data;

  // Traveler count and travel dates are locked once quoted — both shape the
  // itinerary/pricing the same way, so they share one window. Package
  // identity itself no longer changes via this endpoint (see /:id/packages).
  if (validatedBody.numberOfTravelers !== undefined) {
    validateTravelerUpdate({
      currentStatus: lead.lifecycleStatus,
      previousTravelers: lead.numberOfTravelers,
      nextTravelers: validatedBody.numberOfTravelers,
    });
  }
  if (validatedBody.travelDate !== undefined || validatedBody.endDate !== undefined) {
    validateTravelDatesUpdate({
      currentStatus: lead.lifecycleStatus,
      previousTravelDate: lead.travelDate,
      nextTravelDate: validatedBody.travelDate,
      previousEndDate: lead.endDate,
      nextEndDate: validatedBody.endDate,
    });
  }

  // Lifecycle transitions (except QUOTED — that's only reachable through a
  // specific selection's quote endpoint, since quoting now targets one
  // package at a time).
  const statusHistoryCreate = [];
  if (validatedBody.lifecycleStatus && validatedBody.lifecycleStatus !== lead.lifecycleStatus) {
    if (validatedBody.lifecycleStatus === 'QUOTED') {
      throw new AppError('Use POST /:id/packages/:selectionId/quote to quote a specific package', 400);
    }
    const primarySelection = await loadPrimarySelection(lead);
    try {
      validateTransition({
        currentStatus: lead.lifecycleStatus,
        nextStatus: validatedBody.lifecycleStatus,
        pricing: gatekeeperInputs(primarySelection?.pricing, primarySelection?.costLines),
        lostReason: validatedBody.lostReason || lead.lostReason,
      });
    } catch (err) {
      // State-machine gatekeeper failures are client errors (e.g. CLOSED_LOST
      // without a lostReason) — the error carries its own 400 and marks itself as
      // safe to show. Anything else is reported generically, never echoed.
      if (err.isOperational) throw err;
      throw new AppError("We couldn't update this lead's status. Please try again.", 400);
    }
    statusHistoryCreate.push({
      status: validatedBody.lifecycleStatus,
      actor: 'USER',
      changedById: user.id,
      notes: validatedBody.statusChangeNotes || 'Status updated',
    });
  }

  const updateData = {};
  const scalarFields = [
    'name', 'email', 'phone', 'whatsapp', 'city', 'source', 'platform',
    'fromCountry', 'destinationCountry', 'destination',
    'numberOfTravelers', 'budget', 'message', 'lifecycleStatus',
    'priority', 'assignedToId', 'tags', 'lostReason',
  ];
  for (const field of scalarFields) {
    if (validatedBody[field] !== undefined) {
      updateData[field] = validatedBody[field];
    }
  }
  if (validatedBody.phone !== undefined) updateData.phoneNormalized = normalizePhone(validatedBody.phone);
  if (validatedBody.whatsapp !== undefined) updateData.whatsappNormalized = normalizePhone(validatedBody.whatsapp);
  if (validatedBody.travelDate !== undefined) {
    updateData.travelDate = validatedBody.travelDate ? new Date(validatedBody.travelDate) : null;
  }
  if (validatedBody.endDate !== undefined) {
    updateData.endDate = validatedBody.endDate ? new Date(validatedBody.endDate) : null;
  }
  // Remarks arrive as the entire array the client is holding (both the dedicated
  // remarks dialog and the lead editor PUT the full list), so the update is a
  // replace: absent means "leave alone", [] means "clear them all".
  const remarksReplace = validatedBody.remarks === undefined
    ? undefined
    : {
        deleteMany: {},
        create: validatedBody.remarks.map((r) => ({
          text: r.text,
          date: r.date ? new Date(r.date) : new Date(),
          addedById: r.addedBy || user.id,
        })),
      };

  const updated = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      ...updateData,
      ...(remarksReplace && { remarks: remarksReplace }),
      ...(statusHistoryCreate.length && { statusHistory: { create: statusHistoryCreate } }),
    },
    include: { remarks: true, statusHistory: { orderBy: { changedAt: 'desc' } } },
  });

  res.json({ success: true, data: updated });
});

export const deleteLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);
  await prisma.lead.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: {} });
});

export const draftLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const selectionCount = await prisma.leadPackageSelection.count({ where: { leadId: lead.id } });
  if (selectionCount === 0) {
    throw new AppError('Lead has no package selected', 400);
  }

  const primarySelection = await loadPrimarySelection(lead);
  const transition = validateTransition({
    currentStatus: lead.lifecycleStatus,
    nextStatus: 'DRAFTING',
    pricing: gatekeeperInputs(primarySelection?.pricing, primarySelection?.costLines),
  });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      lifecycleStatus: transition.nextStatus,
      statusHistory: {
        create: [{
          status: 'DRAFTING',
          actor: 'USER',
          changedById: req.user.id,
          notes: 'Moved to drafting',
        }],
      },
    },
    include: { packageSelections: true },
  });
  res.json({ success: true, data: updated });
});

export const addRemark = asyncHandler(async (req, res) => {
  const { text, date } = req.body;
  if (!text) throw new AppError('Remark text is required', 400);

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const remark = await prisma.leadRemark.create({
    data: { leadId: req.params.id, text, date: date ? new Date(date) : new Date(), addedById: req.user.id },
  });

  const remarks = await prisma.leadRemark.findMany({ where: { leadId: req.params.id }, orderBy: { date: 'desc' } });
  res.json({ success: true, data: remarks });
});

export const getLeadRemarks = asyncHandler(async (req, res) => {
  const { all } = req.query;
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const remarks = await prisma.leadRemark.findMany({
    where: { leadId: req.params.id },
    orderBy: { date: 'desc' },
    take: all ? undefined : 3,
  });
  res.json({ success: true, data: remarks });
});

export const assignLead = asyncHandler(async (req, res) => {
  const { user } = req;
  const isAdmin = user.isSuperAdmin || user.role === 'admin';
  const canManage = isAdmin || user.permissions.includes('manage_leads');
  if (!canManage) throw new AppError('Not authorized to assign this lead', 403);

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  // An unassigned lead is anyone's to pick up; moving one that already has an
  // owner is an admin action, so it is enforced here rather than only hidden in
  // the UI.
  if (!isAdmin && lead.assignedToId) {
    throw new AppError('Only an admin can change an assigned lead', 403);
  }

  const { assignedTo } = req.body;
  const updated = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      assignedToId: assignedTo || null,
      assignedById: req.user.id,
      assignmentMode: 'manual',
    },
  });
  res.json({ success: true, data: updated });
});

export const unassignLead = asyncHandler(async (req, res) => {
  const { user } = req;
  const canManage = user.isSuperAdmin || user.role === 'admin' || user.permissions.includes('manage_leads');
  if (!canManage) throw new AppError('Not authorized to unassign this lead', 403);

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const updated = await prisma.lead.update({
    where: { id: req.params.id },
    data: { assignedToId: null, assignedById: req.user.id, assignmentMode: 'manual' },
  });
  res.json({ success: true, data: updated });
});

export const getLeadsByStatus = asyncHandler(async (req, res) => {
  const { user } = req;
  const status = req.params.status;
  const where = { AND: [{ lifecycleStatus: status }] };
  // Mirrors getLeads' carve-out (line ~151): PENDING_VERIFICATION is an
  // unassigned, unclaimed queue visible to any salesRep.
  if (user.role === 'salesRep' && status !== 'PENDING_VERIFICATION') where.AND.push({ assignedToId: user.id });

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, count: leads.length, data: leads });
});

export const getMyLeads = asyncHandler(async (req, res) => {
  const leads = await prisma.lead.findMany({ where: { assignedToId: req.user.id }, orderBy: { createdAt: 'desc' } });
  res.json({ success: true, count: leads.length, data: leads });
});

export const getLeadStats = asyncHandler(async (req, res) => {
  const { user } = req;
  // PENDING_VERIFICATION is an unassigned, unclaimed queue visible to any
  // salesRep regardless of ownership — stats must include it the same way
  // getLeads/getLead do, or the tab's badge count silently disagrees with
  // the rows the tab actually lists.
  const where = user.role === 'salesRep'
    ? { OR: [{ assignedToId: user.id }, { lifecycleStatus: 'PENDING_VERIFICATION' }] }
    : {};
  const [byStatus, totals, assigned, confirmed, needsRepAttention] = await Promise.all([
    prisma.lead.groupBy({ by: ['lifecycleStatus'], _count: true, where }),
    prisma.lead.aggregate({ _count: true, where }),
    prisma.lead.count({ where: { AND: [where, { assignedToId: { not: null } }] } }),
    prisma.lead.count({ where: { ...where, lifecycleStatus: 'CONFIRMED' } }),
    prisma.lead.count({
      where: {
        AND: [where, {
          OR: [
            { needsRepFollowup: true },
            { voiceNeedsRepReview: true },
            { lifecycleStatus: 'PENDING_VERIFICATION', convertedBookingId: null },
          ],
        }],
      },
    }),
  ]);
  const total = totals._count;
  const mapped = (byStatus || []).map(item => ({
    _id: item.lifecycleStatus,
    count: item._count,
  }));
  const unassigned = total - assigned;
  const conversionRate = total > 0 ? ((confirmed / total) * 100).toFixed(1) : '0.0';
  res.json({
    success: true,
    data: mapped,
    summary: { total, byStatus: mapped, assigned, unassigned, converted: confirmed, conversionRate, needsRepAttention },
  });
});

export const searchLeads = asyncHandler(async (req, res) => {
  const { user } = req;
  const { query } = req.query;
  if (!query) throw new AppError('Search query is required', 400);

  const where = {
    AND: [
      {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query, mode: 'insensitive' } },
          { destination: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } },
        ],
      },
    ],
  };
  // Mirrors getLeads' carve-out: a salesRep searching still sees the visible
  // PENDING_VERIFICATION queue, not just their own leads.
  if (user.role === 'salesRep') {
    where.AND.push({ OR: [{ assignedToId: user.id }, { lifecycleStatus: 'PENDING_VERIFICATION' }] });
  }

  const leads = await prisma.lead.findMany({ where, take: 20, include: { remarks: { orderBy: { date: 'desc' } } } });
  res.json({ success: true, count: leads.length, data: leads });
});

export const downloadLeadItineraryPDF = asyncHandler(async (req, res) => {
  res.status(501).json({ success: false, message: 'PDF export available via package-service for itinerary data' });
});

export const createWebsiteContactLead = asyncHandler(async (req, res) => {
  const { name, email, phone, subject, message, travelDate, destination, destinationCountry, locations } = req.body;

  if (!email || !name?.trim() || !subject?.trim() || !message?.trim()) {
    throw new AppError('Name, email, subject, and message are required', 400);
  }

  const sanitizedEmail = String(email).trim().toLowerCase();
  const remarkText = [`Contact Form: ${subject.trim()}`, message?.trim() ? `Message: ${message.trim()}` : '', locations?.trim() ? `Locations: ${locations.trim()}` : ''].filter(Boolean).join(' | ');

  const lead = await prisma.$transaction(async (tx) => {
    const assignedId = await autoAssignSalesRep(tx, {});
    return tx.lead.create({
      data: {
        name: name.trim(),
        email: sanitizedEmail,
        phone: phone ? String(phone).replace(/\D/g, '') : null,
        phoneNormalized: normalizePhone(phone),
        source: 'website',
        platform: 'Website_Form',
        destination: destination?.trim() || null,
        destinationCountry: destinationCountry?.trim() || null,
        travelDate: travelDate ? new Date(travelDate) : null,
        message: message?.trim() || null,
        lifecycleStatus: 'NEW',
        tags: ['website-contact-form'],
        assignedToId: assignedId || null,
        assignmentMode: assignedId ? 'auto' : 'manual',
        remarks: { create: [{ text: remarkText, date: new Date(), addedById: null }] },
        statusHistory: { create: [{ status: 'NEW', actor: 'USER', changedById: null, notes: 'Created from website contact form' }] },
      },
    });
  });
  const assignedId = lead.assignedToId;

  res.status(201).json({ success: true, message: 'Contact form submitted successfully', data: { leadId: lead.id, salesRepId: assignedId || null } });
});

export const handleInternalEvent = asyncHandler(async (req, res) => {
  const result = await handleLeadEvent({ event: req.body?.event });
  res.json({ success: true, data: result });
});

// Service-to-service ingestion for Facebook Lead Ads, called by
// notification-service's webhook handler over HTTP (internal-token auth) —
// replaces a previous raw-SQL implementation that wrote directly into this
// service's tables from another service.
export const handleFacebookLeadEvent = asyncHandler(async (req, res) => {
  const { leadgenId, name, email, phone, message } = req.body || {};
  const source = req.body?.source === 'instagram' ? 'instagram' : 'facebook';
  const sanitizedEmail = email ? String(email).trim().toLowerCase() : null;
  const sanitizedPhone = phone ? String(phone).replace(/\D/g, '') : null;

  if (!sanitizedEmail && !sanitizedPhone) {
    throw new AppError('Lead must have email or phone', 400);
  }

  const existing = await prisma.lead.findFirst({
    where: {
      OR: [
        ...(sanitizedEmail ? [{ email: sanitizedEmail }] : []),
        ...(sanitizedPhone ? [{ phone: sanitizedPhone }] : []),
      ],
    },
  });

  if (existing) {
    await prisma.leadRemark.create({
      data: {
        leadId: existing.id,
        text: `Duplicate Facebook lead submission (Lead ID: ${leadgenId || 'unknown'})`,
        date: new Date(),
        addedById: null,
      },
    });
    return res.json({ success: true, data: { leadId: existing.id, duplicate: true } });
  }

  const lead = await prisma.$transaction(async (tx) => {
    const assignedId = await autoAssignSalesRep(tx, {});
    return tx.lead.create({
      data: {
        name: name?.trim() || 'Facebook Lead',
        email: sanitizedEmail,
        phone: sanitizedPhone,
        phoneNormalized: normalizePhone(sanitizedPhone),
        source,
        platform: source === 'instagram' ? 'Instagram' : 'Facebook',
        message: message?.trim() || null,
        lifecycleStatus: 'NEW',
        tags: ['facebook-lead'],
        assignedToId: assignedId || null,
        assignmentMode: assignedId ? 'auto' : 'manual',
        statusHistory: { create: [{ status: 'NEW', actor: 'USER', changedById: null, notes: 'Created from Facebook Lead Ads' }] },
      },
    });
  });

  res.status(201).json({ success: true, data: { leadId: lead.id, salesRepId: lead.assignedToId, duplicate: false } });
});

export const handleGoogleAdsLeadEvent = asyncHandler(async (req, res) => {
  const parsed = googleAdsLeadSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new AppError(messages, 400);
  }
  const leadData = parsed.data;
  const isTest = leadData.isTest === true;
  const email = leadData.email?.trim().toLowerCase() || null;
  const phone = leadData.phone?.replace(/\D/g, '') || null;
  const existingByProviderId = await prisma.lead.findFirst({
    where: { intakeChannel: 'google-ads', intakeSessionId: leadData.leadId },
    select: { id: true },
  });
  if (existingByProviderId) {
    return res.json({ success: true, data: { leadId: existingByProviderId.id, duplicate: true } });
  }

  const existing = isTest ? null : await prisma.lead.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }, { phoneNormalized: phone }, { whatsappNormalized: phone }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) {
    const duplicateNote = `Duplicate Google Ads lead submission (Lead ID: ${leadData.leadId})`;
    const priorNote = await prisma.leadRemark.findFirst({
      where: { leadId: existing.id, text: duplicateNote },
      select: { id: true },
    });
    if (!priorNote) {
      await prisma.leadRemark.create({
        data: { leadId: existing.id, text: duplicateNote, date: new Date(), addedById: null },
      });
    }
    return res.json({ success: true, data: { leadId: existing.id, duplicate: true } });
  }

  const lead = await prisma.$transaction(async (tx) => {
    const assignedId = await autoAssignSalesRep(tx, {});
    return tx.lead.create({
      data: {
        name: `${isTest ? '[TEST] ' : ''}${leadData.name || 'Google Ads Lead'}`,
        email,
        phone,
        phoneNormalized: normalizePhone(phone),
        source: 'google_ads',
        platform: 'Google_Ads',
        intakeChannel: 'google-ads',
        intakeSessionId: leadData.leadId,
        destination: leadData.destination || null,
        travelDate: leadData.travelDate ? new Date(leadData.travelDate) : null,
        numberOfTravelers: leadData.numberOfTravelers ?? null,
        budget: leadData.budget || null,
        message: leadData.message || null,
        lifecycleStatus: 'NEW',
        tags: ['google-ads-lead', ...(isTest ? ['google-ads-test'] : [])],
        assignedToId: assignedId || null,
        assignmentMode: assignedId ? 'auto' : 'manual',
        statusHistory: { create: [{
          status: 'NEW',
          actor: 'USER',
          changedById: null,
          notes: isTest ? 'Google Ads webhook test submission' : 'Created from Google Ads Lead Form',
        }] },
      },
    });
  });

  res.status(201).json({ success: true, data: { leadId: lead.id, salesRepId: lead.assignedToId, duplicate: false } });
});

// Service-to-service ingestion for the lead's communications timeline —
// called by notification-service's WhatsApp webhook (only has a phone
// number, no leadId) and by billing-service after a successful WhatsApp
// document send (already knows leadId). Never fails the caller for an
// unrecognized phone number — that's expected for numbers that aren't a
// lead yet, not an error condition.
export const logCommunication = asyncHandler(async (req, res) => {
  const { leadId, phone, type, notes, occurredAt } = logCommunicationSchema.parse(req.body || {});

  let resolvedLeadId = leadId || null;
  if (!resolvedLeadId && phone) {
    // Matches on the digits-only mirrors, not the raw columns: a rep-created
    // lead stores "+94771234567" while this webhook supplies "94771234567",
    // so the old raw-column comparison never matched those rows.
    const where = phoneMatchWhere(phone);
    const lead = where ? await prisma.lead.findFirst({ where }) : null;
    resolvedLeadId = lead?.id || null;
  }

  if (!resolvedLeadId) {
    return res.json({ success: true, data: { matched: false } });
  }

  await prisma.leadCommunicationLog.create({
    data: { leadId: resolvedLeadId, type, notes, date: occurredAt ? new Date(occurredAt) : new Date(), byId: null },
  });

  res.json({ success: true, data: { matched: true, leadId: resolvedLeadId } });
});

// User-facing (JWT) entry point for an agent's free-form WhatsApp reply —
// only valid within Meta's 24h session window (enforced by Meta itself on
// the send; the Management UI also gates this against the lead's last
// inbound message before showing the reply box).
export const sendWhatsappReply = asyncHandler(async (req, res) => {
  const { text } = whatsappReplySchema.parse(req.body || {});

  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) throw new AppError('Lead not found', 404);

  const { user } = req;
  const canManage = user.isSuperAdmin || user.role === 'admin' || user.permissions.includes('manage_leads');
  if (!canManage && user.role === 'salesRep' && lead.assignedToId !== user.id) {
    throw new AppError('Not authorized to message this lead', 403);
  }

  const phone = lead.whatsapp || lead.phone;
  if (!phone) throw new AppError('This lead has no phone number on file', 400);

  await sendWhatsappText({ to: phone, body: text });

  const log = await prisma.leadCommunicationLog.create({
    data: { leadId: lead.id, type: 'whatsapp', notes: `WhatsApp (agent): ${text}`, date: new Date(), byId: user.id },
  });

  res.json({ success: true, data: log });
});

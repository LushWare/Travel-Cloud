import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { manualItineraryWebsiteSchema, upsertManualItineraryDaysSchema } from '../validators/manualItinerary.validator.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// ─── Auto-assignment helper ────────────────────────────────────
// Copied from lead.controller.js (not exported there) — see
// customizedPackage.controller.js's identical copy for the rationale.
async function autoAssignSalesRep(tx) {
  const settings = await tx.settings.upsert({
    where: { tenantId_singletonKey: { tenantId: requireTenantId(), singletonKey: 1 } },
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

// Public — POST /manual-itineraries/website. `endDate`/`region` are
// accepted by the schema but intentionally not persisted anywhere — neither
// Lead nor ManualItinerary has a matching column; this is a deliberate
// scope decision, not an oversight.
export const createWebsiteManualItinerary = asyncHandler(async (req, res) => {
  const parsed = manualItineraryWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const { name, email, phone, destination, destinationCountry, travelDate, numberOfTravelers, budget, message, days } = parsed.data;

  const sanitizedEmail = String(email).trim().toLowerCase();
  const sanitizedName = name?.trim() || 'Website Traveler';

  const result = await prisma.$transaction(async (tx) => {
    const assignedId = await autoAssignSalesRep(tx);
    const lead = await tx.lead.create({
      data: {
        name: sanitizedName,
        email: sanitizedEmail,
        phone: phone ? String(phone).replace(/\D/g, '') : null,
        source: 'website',
        platform: 'Website_Form',
        destination: destination || null,
        destinationCountry: destinationCountry || null,
        travelDate: travelDate ? new Date(travelDate) : null,
        numberOfTravelers: numberOfTravelers || null,
        budget: budget || null,
        message: message || null,
        lifecycleStatus: 'NEW',
        tags: ['website-manual-itinerary'],
        assignedToId: assignedId || null,
        assignmentMode: assignedId ? 'auto' : 'manual',
        statusHistory: {
          create: [{ status: 'NEW', actor: 'USER', changedById: null, notes: 'Created from website trip planner' }],
        },
      },
    });
    const manualItinerary = await tx.manualItinerary.create({ data: { leadId: lead.id, days } });
    return { lead, manualItinerary, assignedId };
  });

  res.status(201).json({
    success: true,
    message: 'Trip plan submitted successfully',
    data: {
      leadId: result.lead.id,
      manualItineraryId: result.manualItinerary.id,
      salesRepId: result.assignedId || null,
    },
  });
});

// Protected — GET /manual-itineraries/my-requests.
export const fetchMyManualItineraries = asyncHandler(async (req, res) => {
  const email = (req.user.email || '').toLowerCase();
  const leads = await prisma.lead.findMany({ where: { email }, include: { manualItineraries: true } });
  const items = leads
    .flatMap((l) =>
      l.manualItineraries.map((mi) => ({
        ...mi,
        lead: { name: l.name, destination: l.destination, numberOfTravelers: l.numberOfTravelers },
      })),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, data: items });
});

export const getManualItineraryByLead = asyncHandler(async (req, res) => {
  const item = await prisma.manualItinerary.findFirst({ where: { leadId: req.params.leadId } });
  res.json({ success: true, data: item || null });
});

export const upsertManualItineraryForLead = asyncHandler(async (req, res) => {
  const parsed = upsertManualItineraryDaysSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const existing = await prisma.manualItinerary.findFirst({ where: { leadId: req.params.leadId } });
  if (existing) {
    const updated = await prisma.manualItinerary.update({
      where: { id: existing.id },
      data: { days: parsed.data.days, version: { increment: 1 } },
    });
    return res.json({ success: true, message: 'Manual itinerary updated', data: updated });
  }
  const created = await prisma.manualItinerary.create({ data: { leadId: req.params.leadId, days: parsed.data.days } });
  res.status(201).json({ success: true, message: 'Manual itinerary created', data: created });
});

export const deleteManualItinerary = asyncHandler(async (req, res) => {
  const existing = await prisma.manualItinerary.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Manual itinerary not found', 404);
  await prisma.manualItinerary.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Manual itinerary deleted' });
});

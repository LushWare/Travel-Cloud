import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { customizedPackageWebsiteSchema, updateCustomizedPackageSchema } from '../validators/customizedPackage.validator.js';
import { fetchPackage } from '../services/lead-draft.service.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// ─── Auto-assignment helper ────────────────────────────────────
// Copied from lead.controller.js (not exported there) — must run inside
// the same transaction as the lead create it feeds, so the settings read +
// roundRobinIndex increment are atomic with each other under concurrent
// lead creation.
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

// Public — POST /customized-packages/website. Creates only a Lead (tagged,
// sourced, auto-assigned) + CustomizedPackage, following the lean
// transaction-based pattern from createWebsiteContactLead/
// createWebsiteBooking — not legacy's heavier multi-document orchestration
// (no separate User/Booking/Itinerary documents).
export const createWebsiteCustomizedPackage = asyncHandler(async (req, res) => {
  const parsed = customizedPackageWebsiteSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const { packageId, name, email, phone, travelers, travelDate, budget, message, overrides = {} } = parsed.data;

  const pkg = await fetchPackage(packageId);

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
        destination: pkg.destination || null,
        travelDate: travelDate ? new Date(travelDate) : null,
        numberOfTravelers: travelers || null,
        budget: budget || null,
        message: message || null,
        lifecycleStatus: 'NEW',
        tags: ['website-customization'],
        assignedToId: assignedId || null,
        assignmentMode: assignedId ? 'auto' : 'manual',
        statusHistory: {
          create: [{ status: 'NEW', actor: 'USER', changedById: null, notes: 'Created from website package customization' }],
        },
      },
    });
    const customizedPackage = await tx.customizedPackage.create({
      data: {
        leadId: lead.id,
        originalPackageId: packageId,
        name: overrides.name || pkg.title || pkg.name || 'Customized Package',
        description: overrides.description || message || null,
        destination: pkg.destination || 'N/A',
        duration: overrides.duration || pkg.durationDays || pkg.duration || 1,
        price: overrides.price ?? pkg.sellPrice ?? pkg.basePrice ?? pkg.price ?? 0,
        maxGroupSize: overrides.maxGroupSize || 10,
        category: pkg.category || null,
        images: pkg.images || null,
        inclusions: overrides.inclusions || pkg.inclusions || null,
        exclusions: overrides.exclusions || pkg.exclusions || null,
        highlights: overrides.highlights || null,
        terms: overrides.terms || null,
        days: overrides.days || null,
        customizationNotes: message || null,
      },
    });
    return { lead, customizedPackage, assignedId };
  });

  res.status(201).json({
    success: true,
    message: 'Customization request submitted successfully',
    data: {
      customizedPackageId: result.customizedPackage.id,
      leadId: result.lead.id,
      salesRepId: result.assignedId || null,
    },
  });
});

// Protected — GET /customized-packages/my-requests. Matches by the
// authenticated user's email (same lookup pattern the legacy monolith used
// for "my requests", now backed by lead-service's own Lead rows).
export const fetchMyCustomizedPackages = asyncHandler(async (req, res) => {
  const email = (req.user.email || '').toLowerCase();
  const leads = await prisma.lead.findMany({ where: { email }, include: { customizedPackages: true } });
  const items = leads
    .flatMap((l) => l.customizedPackages)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, data: items });
});

export const getCustomizedPackageById = asyncHandler(async (req, res) => {
  const item = await prisma.customizedPackage.findUnique({ where: { id: req.params.id }, include: { lead: true } });
  if (!item) throw new AppError('Customized package not found', 404);
  res.json({ success: true, data: item });
});

export const updateCustomizedPackage = asyncHandler(async (req, res) => {
  const parsed = updateCustomizedPackageSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }
  const existing = await prisma.customizedPackage.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Customized package not found', 404);
  const updated = await prisma.customizedPackage.update({ where: { id: req.params.id }, data: parsed.data });
  res.json({ success: true, message: 'Customized package updated', data: updated });
});

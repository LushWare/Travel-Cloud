import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { updateSettingsSchema } from '../validators/settings.validator.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';

// Only one Settings row is ever allowed — this is the singleton accessor the
// schema comment already promised ("enforced by getSingleton() in service
// layer") but that autoAssignSalesRep() never actually got.
async function getOrCreateSingleton() {
  return prisma.settings.upsert({
    where: { tenantId_singletonKey: { tenantId: requireTenantId(), singletonKey: 1 } },
    update: {},
    create: { singletonKey: 1 },
  });
}

export const getAssignmentSettings = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSingleton();
  res.json({ success: true, data: settings });
});

export const updateAssignmentSettings = asyncHandler(async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    const messages = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new AppError(messages, 400);
  }

  const existing = await getOrCreateSingleton();
  const updated = await prisma.settings.update({
    where: { id: existing.id },
    data: { ...parsed.data, updatedById: req.user.id },
  });
  res.json({ success: true, data: updated });
});

import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { updateSettingsSchema } from '../validators/settings.validator.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';
import { audit } from '../utils/audit.js';

const changedFields = (before, after) =>
  Object.keys(after).filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null));

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

// Leads are auto-assigned to these ids, so each must be an active member of this agency.
async function assertAgencyMembers(ids) {
  const unique = [...new Set(ids)];
  const rows = await prisma.$queryRaw`
    SELECT "userId" FROM crm_users."Membership"
    WHERE "tenantId" = ${requireTenantId()}::uuid AND status = 'active' AND "userId" = ANY(${unique}::text[])`;
  const found = new Set(rows.map((r) => r.userId));
  if (unique.some((id) => !found.has(id))) {
    throw new AppError('enabledSalesRepIds: every rep must be an active member of this agency', 400);
  }
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

  if (parsed.data.enabledSalesRepIds?.length) {
    await assertAgencyMembers(parsed.data.enabledSalesRepIds);
  }

  const existing = await getOrCreateSingleton();
  const updated = await prisma.settings.update({
    where: { id: existing.id },
    data: { ...parsed.data, updatedById: req.user.id },
  });
  const fields = changedFields(existing, parsed.data);
  if (fields.length) {
    await audit(req, {
      action: 'leads.assignment_settings_changed', targetType: 'settings',
      summary: `Changed lead assignment settings: ${fields.join(', ')}`.slice(0, 300),
      details: { fields, ...(fields.includes('enabledSalesRepIds') && { enabledSalesRepIds: parsed.data.enabledSalesRepIds }) },
    });
  }
  res.json({ success: true, data: updated });
});

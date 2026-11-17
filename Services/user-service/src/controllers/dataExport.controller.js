import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { audit } from '../utils/audit.js';
import { buildAgencyExport } from '../services/dataExport.service.js';

// One export at a time per agency: building one reads every table, so a second click waits.
const running = new Set();

/**
 * GET /admin/data-export: the whole agency's data as a ZIP of CSV files, for its owner only.
 * Lushware's view-only help access can read screens but never take a copy of the data.
 */
export const exportAgencyData = asyncHandler(async (req, res) => {
  if (req.headers['x-platform-help-grant']) {
    throw new AppError('Data export is not available during Lushware support access.', 403);
  }
  if (!req.user?.isSuperAdmin) {
    throw new AppError('Only the agency owner can export all of its data.', 403);
  }
  const tenantId = req.user.tenantId;
  if (running.has(tenantId)) throw new AppError('An export is already being prepared. Try again in a minute.', 429);

  running.add(tenantId);
  try {
    const settings = await prisma.organizationSettings.findFirst({ select: { companyName: true } });
    const now = new Date();
    const { zip, files, skipped } = await buildAgencyExport({ agencyName: settings?.companyName, now });

    await audit(req, {
      action: 'agency.data_exported',
      targetType: 'agency',
      targetId: tenantId,
      summary: `Exported all agency data (${files} files)`,
      details: { files, skipped, bytes: zip.length },
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="agency-data-${now.toISOString().slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(zip);
  } finally {
    running.delete(tenantId);
  }
});

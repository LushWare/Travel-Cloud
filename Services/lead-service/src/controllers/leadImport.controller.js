import prisma from '../db/client.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { normalizePhone } from '../utils/phone.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';
import { parseLeadCsvWithColumns, leadCsvBodySchema, leadCsvImportSchema } from '../services/leadCsvImport.js';
import { audit } from '../utils/audit.js';
import { autoAssignForImport } from './lead.controller.js';

function parseOrThrow(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('Check the CSV data and try again.', 400, {
    code: 'VALIDATION_FAILED',
    errors: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  });
  return parsed.data;
}

function contactKeys(row) {
  return {
    email: row.data.email?.toLowerCase(),
    phones: [row.data.phone, row.data.whatsapp].map(normalizePhone).filter(Boolean),
  };
}

async function findExistingContacts(db, rows) {
  const emails = new Set();
  const phones = new Set();
  for (const row of rows) {
    const keys = contactKeys(row);
    if (keys.email) emails.add(keys.email);
    keys.phones.forEach((phone) => phones.add(phone));
  }
  if (!emails.size && !phones.size) return new Set();

  const OR = [];
  if (emails.size) OR.push({ email: { in: [...emails], mode: 'insensitive' } });
  if (phones.size) {
    OR.push({ phoneNormalized: { in: [...phones] } }, { whatsappNormalized: { in: [...phones] } });
  }
  const matches = await db.lead.findMany({ where: { OR }, select: { email: true, phoneNormalized: true, whatsappNormalized: true } });
  const existing = new Set();
  for (const row of matches) {
    if (row.email) existing.add(`email:${row.email.toLowerCase()}`);
    for (const phone of [row.phoneNormalized, row.whatsappNormalized]) {
      if (phone) existing.add(`phone:${phone}`);
    }
  }
  return existing;
}

function markDuplicates(rows, existing) {
  const seenEmails = new Set();
  const seenPhones = new Set();
  return rows.map((row) => {
    const errors = [...row.errors];
    if (row.data) {
      const { email, phones } = contactKeys(row);
      if (email && (existing.has(`email:${email}`) || seenEmails.has(email))) {
        errors.push('Email already exists in this agency or appears more than once in the CSV.');
      }
      if (email) seenEmails.add(email);
      for (const phone of phones) {
        if (existing.has(`phone:${phone}`) || seenPhones.has(phone)) {
          errors.push('Phone number already exists in this agency or appears more than once in the CSV.');
        }
        seenPhones.add(phone);
      }
    }
    return { ...row, errors };
  });
}

export const previewLeadCsv = asyncHandler(async (req, res) => {
  const { csv } = parseOrThrow(leadCsvBodySchema, req.body);
  let rows;
  let ignoredColumns;
  try {
    ({ rows, ignoredColumns } = parseLeadCsvWithColumns(csv));
  } catch (error) {
    throw new AppError(error.message, 400, { code: 'INVALID_CSV' });
  }
  const validRows = rows.filter((row) => row.data);
  const checkedRows = markDuplicates(rows, await findExistingContacts(prisma, validRows));
  const validCount = checkedRows.filter((row) => row.errors.length === 0).length;
  res.json({
    success: true,
    data: {
      totalRows: checkedRows.length,
      validCount,
      invalidCount: checkedRows.length - validCount,
      ignoredColumns,
      rows: checkedRows,
    },
  });
});

export const importLeadCsv = asyncHandler(async (req, res) => {
  const { rows } = parseOrThrow(leadCsvImportSchema, req.body);
  const imported = await prisma.$transaction(async (tx) => {
    const tenantId = requireTenantId();
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), 711)`;
    const checkedRows = markDuplicates(rows.map((row) => ({ ...row, errors: [] })), await findExistingContacts(tx, rows));
    const errors = [];
    let importedCount = 0;

    for (const row of checkedRows) {
      if (row.errors.length) {
        errors.push({ rowNumber: row.rowNumber, errors: row.errors });
        continue;
      }
      const assignedToId = await autoAssignForImport(tx, row.data);
      await tx.lead.create({
        data: {
          ...row.data,
          phoneNormalized: normalizePhone(row.data.phone),
          whatsappNormalized: normalizePhone(row.data.whatsapp),
          source: 'manual',
          platform: 'Manual_Entry',
          lifecycleStatus: 'NEW',
          priority: 'medium',
          tags: [],
          ...(assignedToId && { assignedToId, assignmentMode: 'auto' }),
          statusHistory: {
            create: [{ status: 'NEW', actor: 'USER', changedById: req.user.id, notes: 'Imported from CSV' }],
          },
        },
      });
      importedCount += 1;
    }

    return { importedCount, errors };
  });

  if (imported.importedCount) {
    await audit(req, {
      action: 'lead.csv_imported',
      targetType: 'lead_import',
      summary: `Imported ${imported.importedCount} lead${imported.importedCount === 1 ? '' : 's'} from CSV`,
      details: { importedCount: imported.importedCount, skippedCount: imported.errors.length },
    });
  }
  res.status(201).json({ success: true, data: imported });
});

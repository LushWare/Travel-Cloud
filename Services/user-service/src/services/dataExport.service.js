import prisma from '../db/client.js';
import { requireTenantId } from '../../../shared/tenancy/src/index.js';
import { createZip } from '../utils/zip.js';

// Schemas whose tables belong to Lushware, not to the agency (plans, audit, sessions, staff).
const EXCLUDED_SCHEMAS = new Set(['crm_platform', 'crm_auth']);
// Never part of an export, whatever table they are in: credentials and encrypted secrets.
const SECRET_COLUMN = /pass(word)?|token|secret|hash|cipher|wrappeddek|kek|otp|apikey|api_key|signature|pin\b|privatekey/i;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** The agency-owned tables: every table outside Lushware's own schemas that has a tenantId. */
export async function listAgencyTables(db = prisma) {
  const rows = await db.$queryRawUnsafe(
    `SELECT table_schema AS "schema", table_name AS "table"
       FROM information_schema.columns
      WHERE column_name = 'tenantId' AND table_schema LIKE 'crm\\_%'
      ORDER BY table_schema, table_name`,
  );
  return rows.filter((row) => !EXCLUDED_SCHEMAS.has(row.schema)
    && IDENTIFIER.test(row.schema) && IDENTIFIER.test(row.table));
}

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && typeof value.toFixed === 'function' && value.constructor?.name === 'Decimal') return value.toString();
  if (Array.isArray(value) || (typeof value === 'object')) return JSON.stringify(value);
  return String(value);
};

// Spreadsheet apps run a cell that starts with = + - @ as a formula; prefix those so a
// customer-typed value can never execute when the owner opens the file.
const csvCell = (value) => {
  let text = cellText(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV of rows, without secret columns, binary columns or the agency id itself. */
export function toCsv(rows) {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]).filter((column) => column !== 'tenantId'
    && !SECRET_COLUMN.test(column)
    && !rows.some((row) => row[column] instanceof Uint8Array));
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Everything the agency owns, as one CSV per table in a ZIP. Every query names the agency and runs
 * with row-level security on, so nothing from another agency can be included. A table the
 * service may not read is listed in the README instead of failing the whole export.
 */
export async function buildAgencyExport({ agencyName, now = new Date() } = {}) {
  const tenantId = requireTenantId();
  const files = [];
  const summary = [];
  const skipped = [];

  for (const { schema, table } of await listAgencyTables()) {
    const name = `${schema.replace(/^crm_/, '')}_${table}.csv`;
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM "${schema}"."${table}" WHERE "tenantId" = $1::uuid`,
        tenantId,
      );
      if (rows.length === 0) continue;
      files.push({ name, content: toCsv(rows) });
      summary.push(`${name}: ${rows.length} rows`);
    } catch {
      skipped.push(name);
    }
  }

  const staff = await prisma.$queryRawUnsafe(
    `SELECT u.name, u.email, m.role::text AS role, m.status::text AS status, m."isOwner", m."joinedAt"
       FROM crm_users."Membership" m JOIN crm_users."User" u ON u.id = m."userId"
      WHERE m."tenantId" = $1::uuid ORDER BY u.name`,
    tenantId,
  );
  files.push({ name: 'staff.csv', content: toCsv(staff) });
  summary.push(`staff.csv: ${staff.length} people`);

  const readme = [
    `Data export for ${agencyName || 'your agency'}`,
    `Created ${now.toISOString()} (UTC)`,
    '',
    'One CSV file per kind of record, readable in Excel or Google Sheets.',
    'Passwords, sign-in tokens and connection secrets are never included.',
    'Uploaded files (PDFs, images) are listed by their link; download them from those links.',
    '',
    ...summary,
    ...(skipped.length ? ['', 'Not included (contact support if you need these):', ...skipped] : []),
  ].join('\r\n');
  files.unshift({ name: 'README.txt', content: `${readme}\r\n` });

  return { zip: createZip(files, { now }), files: summary.length, skipped };
}

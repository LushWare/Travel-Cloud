import { z } from 'zod';
import { createLeadSchema } from '../validators/lead.validator.js';

const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 500;

const ALLOWED_HEADERS = new Set([
  'name', 'email', 'phone', 'whatsapp', 'city', 'fromCountry',
  'destinationCountry', 'destination', 'travelDate', 'endDate',
  'numberOfTravelers', 'budget', 'message',
]);
// Column names compared without case, spaces, underscores or dashes, so "Travel Date",
// "travel_date" and "travelDate" all match. Common spreadsheet spellings map to our fields.
const squash = (value) => value.toLowerCase().replace(/[\s_-]+/g, '');
const HEADER_ALIASES = {
  fullname: 'name', customername: 'name', leadname: 'name', contactname: 'name',
  emailaddress: 'email', mail: 'email',
  phonenumber: 'phone', mobile: 'phone', mobilenumber: 'phone', telephone: 'phone', tel: 'phone', contactnumber: 'phone',
  whatsappnumber: 'whatsapp',
  travellers: 'numberOfTravelers', travelers: 'numberOfTravelers', pax: 'numberOfTravelers', numberoftravellers: 'numberOfTravelers',
  startdate: 'travelDate', departuredate: 'travelDate', returndate: 'endDate',
  notes: 'message', note: 'message', comments: 'message', comment: 'message', enquiry: 'message', inquiry: 'message',
};
const HEADER_NAMES = new Map([
  ...[...ALLOWED_HEADERS].map((header) => [squash(header), header]),
  ...Object.entries(HEADER_ALIASES),
]);

const importRowSchema = createLeadSchema.pick({
  name: true,
  email: true,
  phone: true,
  whatsapp: true,
  city: true,
  fromCountry: true,
  destinationCountry: true,
  destination: true,
  travelDate: true,
  endDate: true,
  numberOfTravelers: true,
  budget: true,
  message: true,
}).strict().superRefine((row, context) => {
  if (!row.name && !row.email && !row.phone && !row.whatsapp) {
    context.addIssue({ code: 'custom', message: 'Provide at least a name, email, phone, or WhatsApp number.' });
  }
  for (const field of ['travelDate', 'endDate']) {
    if (row[field] && Number.isNaN(new Date(row[field]).getTime())) {
      context.addIssue({ code: 'custom', path: [field], message: 'Enter a valid date.' });
    }
  }
});

function parseRecords(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoteClosed = false;
  const source = csv.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
        quoteClosed = true;
      } else {
        field += char;
      }
      continue;
    }

    if (quoteClosed) {
      if (char === ',') {
        row.push(field.trim());
        field = '';
        quoteClosed = false;
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        row.push(field.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        field = '';
        quoteClosed = false;
      } else {
        throw new Error('Unexpected text after a quoted CSV field.');
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === '"') {
      throw new Error('A quoted CSV field must start at the beginning of a field.');
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
      quoteClosed = false;
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error('A quoted CSV field was not closed.');
  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function normalizeValue(header, value) {
  if (!value) return undefined;
  if (header === 'email') return value.toLowerCase();
  if (header === 'numberOfTravelers') {
    const count = Number(value);
    if (!Number.isInteger(count)) return value;
    return count;
  }
  if (header === 'travelDate' || header === 'endDate') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return value;
}

function validateRecord(row, headers, rowNumber) {
  if (row.length !== headers.length) {
    return { rowNumber, errors: ['The number of fields does not match the header row.'] };
  }
  // Only the columns we recognise are read; anything else in the sheet is left out (null header).
  const input = Object.fromEntries(headers.map((header, index) => [
    header,
    header ? normalizeValue(header, row[index]) : undefined,
  ]).filter(([header, value]) => header && value !== undefined));
  const parsed = importRowSchema.safeParse(input);
  if (!parsed.success) {
    return {
      rowNumber,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`),
    };
  }
  return { rowNumber, data: parsed.data, errors: [] };
}

/**
 * Reads a spreadsheet export. Columns we recognise become lead fields; every other column is
 * skipped and listed in `ignoredColumns`, so a sheet exported from another tool (with ids,
 * timestamps, call notes …) imports without editing. Returns { rows, ignoredColumns }.
 */
export function parseLeadCsvWithColumns(csv) {
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > CSV_MAX_BYTES) {
    throw new Error('The CSV file must be smaller than 1 MB.');
  }
  const records = parseRecords(csv);
  if (records.length < 2) throw new Error('The CSV must include a header and at least one data row.');

  const rawHeaders = records[0].map((header) => header.trim());
  if (!rawHeaders.some(Boolean)) throw new Error('The CSV header row is empty.');
  const headers = rawHeaders.map((header) => (header ? HEADER_NAMES.get(squash(header)) ?? null : null));
  const ignoredColumns = rawHeaders.filter((header, index) => header && !headers[index]);

  const used = headers.filter(Boolean);
  const duplicates = [...new Set(used.filter((header, index) => used.indexOf(header) !== index))];
  if (duplicates.length) throw new Error(`More than one column means the same thing: ${duplicates.join(', ')}. Keep one of each.`);
  if (!used.some((header) => ['name', 'email', 'phone', 'whatsapp'].includes(header))) {
    throw new Error('The CSV needs at least one of these columns: name, email, phone or whatsapp.');
  }
  if (records.length - 1 > CSV_MAX_ROWS) throw new Error(`The CSV cannot contain more than ${CSV_MAX_ROWS} data rows.`);

  return {
    rows: records.slice(1).map((record, index) => validateRecord(record, headers, index + 2)),
    ignoredColumns,
  };
}

export function parseLeadCsv(csv) {
  return parseLeadCsvWithColumns(csv).rows;
}

export const leadCsvBodySchema = z.object({
  csv: z.string().min(1).max(CSV_MAX_BYTES),
}).strict();

export const leadCsvImportSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().min(2),
    data: importRowSchema,
  }).strict()).min(1).max(CSV_MAX_ROWS),
}).strict();

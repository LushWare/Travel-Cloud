// One-off generator for Phase 1 step 7: values that were unique across the whole system
// (invoice numbers, package slugs, place names, …) become unique per agency.
//
//   node Services/tenant-uniques.mjs           # edit schema.prisma files
//   node Services/tenant-uniques.mjs --check   # report what is still global, change nothing
//
// The SQL is generated afterwards with `prisma migrate diff`, so index names match Prisma's own.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// service → model → fields whose uniqueness becomes per agency.
export const PER_AGENCY = {
  'billing-service': {
    Invoice: [['invoiceNumber']],
    Quotation: [['quotationNumber']],
    PaymentReceipt: [['receiptNumber']],
    PaymentHistory: [['paymentHistoryNumber']],
    CreditNote: [['creditNoteNumber']],
    Voucher: [['voucherNumber']],
  },
  'package-service': {
    Package: [['slug']],
    Place: [['name']],
    ActivityCatalog: [['name']],
  },
  'lead-service': {
    Lead: [['intakeChannel', 'intakeSessionId']],
    Settings: [['singletonKey']],
  },
  'assistant-service': {
    ManagementLastSeen: [['actorId', 'pageKey', 'scopeFingerprint']],
    InsightState: [['actorId', 'pageKey', 'scopeFingerprint', 'insightKey']],
    BusinessNotificationState: [['actorId', 'notificationKey']],
  },
  'user-service': {
    VendorProfile: [['businessRegistrationNumber']],
    OrganizationSettings: [[]],
  },
};

/** Rewrites one model block: drops the global unique and adds the per-agency one. */
export function perAgencyBlock(block, uniques) {
  let out = block;
  for (const fields of uniques) {
    if (fields.length === 1) {
      const field = new RegExp(`^(\\s+${fields[0]}\\s[^\\n]*?)\\s@unique\\b`, 'm');
      out = out.replace(field, '$1');
    } else if (fields.length > 1) {
      const compound = new RegExp(`^\\s+@@unique\\(\\[${fields.join(',\\s*')}\\]\\)\\n`, 'm');
      out = out.replace(compound, '');
    }
    const target = `@@unique([${['tenantId', ...fields].join(', ')}])`;
    if (!out.includes(target)) out = out.replace(/^([ \t]+)@@schema\(/m, `$1${target}\n$1@@schema(`);
  }
  return out;
}

export function applyToSchema(prisma, models) {
  let out = prisma;
  for (const [model, uniques] of Object.entries(models)) {
    const re = new RegExp(`^model ${model} \\{\\n[\\s\\S]*?^\\}`, 'm');
    const block = out.match(re)?.[0];
    if (!block) throw new Error(`model ${model} not found`);
    out = out.replace(block, perAgencyBlock(block, uniques));
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  for (const [service, models] of Object.entries(PER_AGENCY)) {
    const file = path.join(HERE, service, 'prisma', 'schema.prisma');
    const raw = readFileSync(file, 'utf8');
    const crlf = raw.includes('\r\n');
    const before = raw.replace(/\r\n/g, '\n');
    const after = applyToSchema(before, models);
    console.log(`${service.padEnd(20)} ${after === before ? 'already per agency' : check ? 'still global' : 'updated'}`);
    if (!check && after !== before) writeFileSync(file, crlf ? after.replace(/\n/g, '\r\n') : after);
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inflateRawSync } from 'node:zlib';

const { db } = vi.hoisted(() => ({ db: { $queryRawUnsafe: vi.fn() } }));
vi.mock('../../db/client.js', () => ({ default: db }));

import { buildAgencyExport, listAgencyTables, toCsv } from '../dataExport.service.js';
import { createZip, crc32 } from '../../utils/zip.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const AGENCY = '00000000-0000-4000-8000-000000000003';

// Reads a ZIP back (enough of the format to check what createZip wrote).
function unzip(buffer) {
  const files = {};
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    const size = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const local = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString('utf8');
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26);
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + size));
    expect(crc32(data)).toBe(buffer.readUInt32LE(pos + 16));
    files[name] = data.toString('utf8');
    pos += 46 + nameLength;
  }
  return files;
}

function database({ tables, rowsByTable = {}, failing = [] }) {
  db.$queryRawUnsafe.mockImplementation(async (sql, ...params) => {
    if (sql.includes('information_schema.columns')) return tables;
    if (sql.includes('crm_users."Membership" m JOIN')) return [{ name: 'Ana', email: 'ana@agency.test', role: 'admin', status: 'active', isOwner: true, joinedAt: null }];
    const match = sql.match(/FROM "([^"]+)"\."([^"]+)"/);
    const key = `${match[1]}.${match[2]}`;
    if (failing.includes(key)) throw new Error('permission denied');
    expect(params).toEqual([AGENCY]);
    return rowsByTable[key] ?? [];
  });
}

beforeEach(() => vi.clearAllMocks());

describe('toCsv', () => {
  it('leaves out the agency id, passwords, tokens and encrypted secrets', () => {
    const csv = toCsv([{ id: 'a', tenantId: AGENCY, name: 'X', password: 'p', resetToken: 't', secretCiphertext: 'c', webhookSecret: 's' }]);

    expect(csv.split('\r\n')[0]).toBe('﻿id,name');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([{ note: 'a, "b"\nc' }]).split('\r\n')[1]).toBe('"a, ""b""\nc"');
  });

  it('defuses a value a spreadsheet would run as a formula', () => {
    expect(toCsv([{ name: '=HYPERLINK("http://evil")' }]).split('\r\n')[1]).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it('writes dates as ISO text and objects as JSON', () => {
    const row = toCsv([{ at: new Date('2026-11-16T10:00:00Z'), meta: { a: 1 } }]).split('\r\n')[1];

    expect(row).toBe('2026-11-16T10:00:00.000Z,"{""a"":1}"');
  });

  it('drops binary columns', () => {
    expect(toCsv([{ id: 'a', blob: new Uint8Array([1, 2]) }]).split('\r\n')[0]).toBe('﻿id');
  });
});

describe('listAgencyTables', () => {
  it('skips Lushware\'s own schemas', async () => {
    database({ tables: [
      { schema: 'crm_leads', table: 'Lead' },
      { schema: 'crm_platform', table: 'AuditLog' },
      { schema: 'crm_auth', table: 'RefreshSession' },
    ] });

    expect(await listAgencyTables(db)).toEqual([{ schema: 'crm_leads', table: 'Lead' }]);
  });

  it('skips a table whose name is not a plain identifier', async () => {
    database({ tables: [{ schema: 'crm_leads', table: 'Lead"; DROP TABLE x; --' }] });

    expect(await listAgencyTables(db)).toEqual([]);
  });
});

describe('buildAgencyExport', () => {
  const run = (setup) => { database(setup); return runWithTenant(AGENCY, () => buildAgencyExport({ agencyName: 'North Star', now: new Date('2026-11-16T10:00:00Z') })); };

  it('puts one CSV per table with rows into a valid ZIP', async () => {
    const { zip } = await run({
      tables: [{ schema: 'crm_leads', table: 'Lead' }, { schema: 'crm_billing', table: 'Invoice' }],
      rowsByTable: { 'crm_leads.Lead': [{ id: 'l1', tenantId: AGENCY, name: 'Priya' }] },
    });

    const files = unzip(zip);
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'leads_Lead.csv', 'staff.csv']);
    expect(files['leads_Lead.csv']).toBe('﻿id,name\r\nl1,Priya\r\n');
  });

  it('lists the staff with their role but never a password', async () => {
    const { zip } = await run({ tables: [] });

    expect(unzip(zip)['staff.csv'].split('\r\n')[0]).toBe('﻿name,email,role,status,isOwner,joinedAt');
  });

  it('notes a table it could not read instead of failing the export', async () => {
    const { zip, skipped } = await run({
      tables: [{ schema: 'crm_integrations', table: 'TenantIntegration' }],
      failing: ['crm_integrations.TenantIntegration'],
    });

    expect(skipped).toEqual(['integrations_TenantIntegration.csv']);
    expect(unzip(zip)['README.txt']).toContain('integrations_TenantIntegration.csv');
  });

  it('refuses to run without an agency', async () => {
    database({ tables: [] });

    await expect(buildAgencyExport()).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });
});

describe('createZip', () => {
  it('refuses a file name that could escape the folder', () => {
    expect(() => createZip([{ name: '../evil.csv', content: 'x' }])).toThrow(/Unsafe file name/);
  });
});

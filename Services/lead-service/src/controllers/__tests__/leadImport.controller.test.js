import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, assignLead, audit } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    lead: { findMany: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    lead: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, tx, assignLead: vi.fn(), audit: vi.fn() };
});

vi.mock('../../db/client.js', () => ({ default: prisma }));
vi.mock('../lead.controller.js', () => ({ autoAssignForImport: assignLead }));
vi.mock('../../utils/audit.js', () => ({ audit }));
vi.mock('../../../../shared/tenancy/src/index.js', async (importOriginal) => ({
  ...(await importOriginal()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

import { importLeadCsv, previewLeadCsv } from '../leadImport.controller.js';

const makeResponse = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.lead.findMany.mockResolvedValue([]);
  prisma.$transaction.mockImplementation((work) => work(tx));
  tx.$queryRaw.mockResolvedValue([]);
  tx.lead.findMany.mockResolvedValue([]);
  tx.lead.create.mockResolvedValue({ id: 'lead-id' });
  assignLead.mockResolvedValue(null);
  audit.mockResolvedValue();
});

describe('previewLeadCsv', () => {
  it('returns valid rows and row-specific validation failures', async () => {
    const req = { body: { csv: 'name,email\nAlex,alex@example.com\n,not-an-email' } };
    const res = makeResponse();

    await previewLeadCsv(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ totalRows: 2, validCount: 1, invalidCount: 1 }),
    }));
  });

  it('rejects unsupported request fields before querying leads', async () => {
    const req = { body: { csv: 'name,email\nAlex,alex@example.com', tenantId: 'other-tenant' } };
    const next = vi.fn();

    await previewLeadCsv(req, makeResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe('importLeadCsv', () => {
  it('creates valid rows as new leads and records a summary audit', async () => {
    const req = {
      user: { id: 'owner-id' },
      body: {
        rows: [{
          rowNumber: 2,
          data: { name: 'Alex Owner', email: 'alex@example.com' },
        }],
      },
    };
    const res = makeResponse();

    await importLeadCsv(req, res);

    expect(tx.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'alex@example.com',
        lifecycleStatus: 'NEW',
        platform: 'Manual_Entry',
        statusHistory: { create: [expect.objectContaining({ changedById: 'owner-id' })] },
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(audit).toHaveBeenCalledWith(req, expect.objectContaining({ action: 'lead.csv_imported' }));
  });

  it('skips contacts that became duplicates after preview', async () => {
    tx.lead.findMany.mockResolvedValue([{ email: 'alex@example.com', phoneNormalized: null, whatsappNormalized: null }]);
    const req = {
      user: { id: 'owner-id' },
      body: { rows: [{ rowNumber: 2, data: { name: 'Alex Owner', email: 'alex@example.com' } }] },
    };
    const res = makeResponse();

    await importLeadCsv(req, res);

    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        importedCount: 0,
        errors: [expect.objectContaining({ rowNumber: 2 })],
      },
    });
  });
});

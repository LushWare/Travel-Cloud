import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { authHeaders } from '../factories/user.factory.js';

const { mockPrisma, exportService, auditMock } = vi.hoisted(() => ({
  mockPrisma: { organizationSettings: { findFirst: vi.fn() } },
  exportService: { buildAgencyExport: vi.fn() },
  auditMock: { audit: vi.fn(), describePerson: vi.fn() },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));
vi.mock('../../src/services/dataExport.service.js', () => exportService);
vi.mock('../../src/utils/audit.js', () => auditMock);

const { default: app } = await import('../../src/app.js');

const ZIP = Buffer.from('PK-fake-zip');

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.organizationSettings.findFirst.mockResolvedValue({ companyName: 'North Star' });
  exportService.buildAgencyExport.mockResolvedValue({ zip: ZIP, files: 3, skipped: [] });
});

describe('GET /api/v1/admin/data-export', () => {
  it('sends the owner a ZIP download', async () => {
    const res = await request(app).get('/api/v1/admin/data-export').set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="agency-data-\d{4}-\d{2}-\d{2}\.zip"$/);
  });

  it('records the export in the audit log', async () => {
    await request(app).get('/api/v1/admin/data-export').set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }));

    expect(auditMock.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'agency.data_exported' }));
  });

  it('refuses an admin who is not the owner', async () => {
    const res = await request(app).get('/api/v1/admin/data-export').set(authHeaders({ role: 'admin' }));

    expect(res.status).toBe(403);
    expect(exportService.buildAgencyExport).not.toHaveBeenCalled();
  });

  it('refuses a sales rep', async () => {
    const res = await request(app).get('/api/v1/admin/data-export').set(authHeaders({ role: 'salesRep' }));

    expect(res.status).toBe(403);
  });

  it('refuses Lushware view-only help access', async () => {
    const res = await request(app).get('/api/v1/admin/data-export')
      .set(authHeaders({ role: 'superAdmin', isSuperAdmin: true }))
      .set('x-platform-help-grant', 'grant-1');

    expect(res.status).toBe(403);
    expect(exportService.buildAgencyExport).not.toHaveBeenCalled();
  });
});

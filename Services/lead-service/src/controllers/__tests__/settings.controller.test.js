import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests call handlers directly, so they run as one fixed agency.
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

const { mockSettingsUpsert, mockSettingsUpdate, mockQueryRaw, mockExecuteRaw } = vi.hoisted(() => ({
  mockSettingsUpsert: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockExecuteRaw: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
    $queryRaw: mockQueryRaw,
    $executeRaw: mockExecuteRaw,
  },
}));

import { getAssignmentSettings, updateAssignmentSettings } from '../settings.controller.js';
import { runWithTenant } from '../../../../shared/tenancy/src/index.js';

const auditRows = () => mockExecuteRaw.mock.calls.map(([, ...values]) => values);

const adminUser = { id: 'admin-1', role: 'admin', isSuperAdmin: false, permissions: [] };

function buildReqRes({ body = {}, user = adminUser } = {}) {
  const req = { body, user };
  const res = { json: vi.fn() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockSettingsUpsert.mockReset();
  mockSettingsUpdate.mockReset();
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset().mockResolvedValue(1);
});

describe('getAssignmentSettings', () => {
  it('upserts on the fixed singleton key so it always resolves to the same row', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1, assignmentMode: 'auto' });

    const { req, res, next } = buildReqRes();
    await getAssignmentSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSettingsUpsert).toHaveBeenCalledWith({
      where: { tenantId_singletonKey: { tenantId: '11111111-1111-4111-8111-111111111111', singletonKey: 1 } },
      update: {},
      create: { singletonKey: 1 },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'settings-1', singletonKey: 1, assignmentMode: 'auto' } });
  });

  it('never makes a second, separate create call — upsert is the only Prisma call', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-new', singletonKey: 1, assignmentMode: 'manual' });

    const { req, res, next } = buildReqRes();
    await getAssignmentSettings(req, res, next);

    expect(mockSettingsUpsert).toHaveBeenCalledTimes(1);
  });
});

describe('updateAssignmentSettings', () => {
  it('accepts the payload the frontend Assignment Settings dialog sends', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1 });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1', assignmentMode: 'auto', autoStrategy: 'round_robin' });

    const { req, res, next } = buildReqRes({
      body: { assignmentMode: 'auto', autoStrategy: 'round_robin', requireActiveLogin48h: true },
    });
    await updateAssignmentSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { assignmentMode: 'auto', autoStrategy: 'round_robin', requireActiveLogin48h: true, updatedById: 'admin-1' },
    });
  });

  it('ignores unrecognized fields rather than persisting them', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1 });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1', assignmentMode: 'manual' });

    const { req, res, next } = buildReqRes({ body: { notARealField: true, assignmentMode: 'manual' } });
    await updateAssignmentSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { assignmentMode: 'manual', updatedById: 'admin-1' },
    });
  });

  it('saves enabledSalesRepIds when every id is an active member of this agency', async () => {
    mockQueryRaw.mockResolvedValue([{ userId: 'rep-1' }, { userId: 'rep-2' }]);
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1 });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1' });

    const { req, res, next } = buildReqRes({ body: { enabledSalesRepIds: ['rep-1', 'rep-2'] } });
    await updateAssignmentSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { enabledSalesRepIds: ['rep-1', 'rep-2'], updatedById: 'admin-1' },
    });
  });

  it('rejects enabledSalesRepIds containing a user from another agency', async () => {
    mockQueryRaw.mockResolvedValue([{ userId: 'rep-1' }]);

    const { req, res, next } = buildReqRes({ body: { enabledSalesRepIds: ['rep-1', 'other-agency-rep'] } });
    await updateAssignmentSettings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('skips the membership check when enabledSalesRepIds is empty', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1 });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1' });

    const { req, res, next } = buildReqRes({ body: { enabledSalesRepIds: [] } });
    await updateAssignmentSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('rejects an empty-string rep id before touching the database', async () => {
    const { req, res, next } = buildReqRes({ body: { enabledSalesRepIds: [''] } });
    await updateAssignmentSettings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it('records which assignment settings changed in the audit log', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1, assignmentMode: 'manual', autoStrategy: 'round_robin' });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1', assignmentMode: 'auto' });

    const { req, res, next } = buildReqRes({ body: { assignmentMode: 'auto', autoStrategy: 'round_robin' } });
    await runWithTenant('11111111-1111-4111-8111-111111111111', () => updateAssignmentSettings(req, res, next));

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][4]).toBe('leads.assignment_settings_changed');
    expect(JSON.parse(rows[0][8])).toEqual({ fields: ['assignmentMode'] });
  });

  it('records nothing when the save changed no values', async () => {
    mockSettingsUpsert.mockResolvedValue({ id: 'settings-1', singletonKey: 1, assignmentMode: 'auto' });
    mockSettingsUpdate.mockResolvedValue({ id: 'settings-1', assignmentMode: 'auto' });

    const { req, res, next } = buildReqRes({ body: { assignmentMode: 'auto' } });
    await runWithTenant('11111111-1111-4111-8111-111111111111', () => updateAssignmentSettings(req, res, next));

    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  it('rejects an invalid autoStrategy value', async () => {
    const { req, res, next } = buildReqRes({ body: { autoStrategy: 'not_a_real_strategy' } });
    await updateAssignmentSettings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });
});

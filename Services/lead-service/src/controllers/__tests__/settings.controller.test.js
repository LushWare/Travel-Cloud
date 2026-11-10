import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests call handlers directly, so they run as one fixed agency.
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

const { mockSettingsUpsert, mockSettingsUpdate } = vi.hoisted(() => ({
  mockSettingsUpsert: vi.fn(),
  mockSettingsUpdate: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
  },
}));

import { getAssignmentSettings, updateAssignmentSettings } from '../settings.controller.js';

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

  it('rejects an invalid autoStrategy value', async () => {
    const { req, res, next } = buildReqRes({ body: { autoStrategy: 'not_a_real_strategy' } });
    await updateAssignmentSettings(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });
});

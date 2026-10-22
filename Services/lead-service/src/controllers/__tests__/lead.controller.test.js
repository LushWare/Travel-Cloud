import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLeadFindUnique,
  mockLeadFindFirst,
  mockLeadFindMany,
  mockLeadUpdate,
  mockLeadCreate,
  mockLeadRemarkCreate,
  mockLeadRemarkFindFirst,
  mockSettingsUpsert,
  mockSettingsUpdate,
  mockSelectionCount,
  mockTransaction,
  mockGatekeeperInputs,
  mockLoadPrimarySelection,
  mockLeadCommunicationLogCreate,
  mockSendWhatsappText,
  mockLeadGroupBy,
  mockLeadAggregate,
  mockLeadCount,
} = vi.hoisted(() => ({
  mockLeadFindUnique: vi.fn(),
  mockLeadFindFirst: vi.fn(),
  mockLeadFindMany: vi.fn(),
  mockLeadUpdate: vi.fn(),
  mockLeadCreate: vi.fn(),
  mockLeadRemarkCreate: vi.fn(),
  mockLeadRemarkFindFirst: vi.fn(),
  mockSettingsUpsert: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockSelectionCount: vi.fn(),
  mockTransaction: vi.fn(),
  mockGatekeeperInputs: vi.fn(),
  mockLoadPrimarySelection: vi.fn(),
  mockLeadCommunicationLogCreate: vi.fn(),
  mockSendWhatsappText: vi.fn(),
  mockLeadGroupBy: vi.fn(),
  mockLeadAggregate: vi.fn(),
  mockLeadCount: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: {
      findUnique: mockLeadFindUnique, findFirst: mockLeadFindFirst, findMany: mockLeadFindMany,
      update: mockLeadUpdate, create: mockLeadCreate,
      groupBy: mockLeadGroupBy, aggregate: mockLeadAggregate, count: mockLeadCount,
    },
    leadRemark: { create: mockLeadRemarkCreate, findFirst: mockLeadRemarkFindFirst },
    leadCommunicationLog: { create: mockLeadCommunicationLogCreate },
    settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
    leadPackageSelection: { count: mockSelectionCount },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../services/gatekeeper.service.js', () => ({
  gatekeeperInputs: mockGatekeeperInputs,
  loadPrimarySelection: mockLoadPrimarySelection,
}));

vi.mock('../../services/notification.client.js', () => ({
  sendWhatsappText: mockSendWhatsappText,
}));

import {
  updateLead, createLead, draftLead, assignLead, unassignLead, getLeads,
  getLeadsByStatus, searchLeads, handleFacebookLeadEvent, handleGoogleAdsLeadEvent,
  logCommunication, sendWhatsappReply, getLeadStats,
} from '../lead.controller.js';

const PKG_A = '11111111-1111-1111-1111-111111111111';

const leadFixture = (overrides = {}) => ({
  id: 'lead-1',
  lifecycleStatus: 'DRAFTING',
  numberOfTravelers: 2,
  travelDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-10'),
  assignedToId: 'user-1',
  lostReason: null,
  primarySelectionId: 'sel-1',
  ...overrides,
});

const adminUser = { id: 'user-1', role: 'admin', isSuperAdmin: false, permissions: ['manage_leads'] };

function buildReqRes({ leadId = 'lead-1', body = {}, user = adminUser } = {}) {
  const req = { params: { id: leadId }, body, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

describe('createLead — initial package selection', () => {
  beforeEach(() => {
    mockLeadCreate.mockReset();
    mockLeadUpdate.mockReset();
    mockLeadFindUnique.mockReset();
    mockSettingsUpsert.mockReset().mockResolvedValue({ assignmentMode: 'manual' });
    mockSettingsUpdate.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) => fn({
      lead: { create: mockLeadCreate, update: mockLeadUpdate, findUnique: mockLeadFindUnique },
      settings: { upsert: mockSettingsUpsert, update: mockSettingsUpdate },
    }));
  });

  it('creates a real-package selection and points primarySelectionId at it', async () => {
    mockLeadCreate.mockResolvedValue({ id: 'lead-1', packageSelections: [{ id: 'sel-1', packageId: PKG_A }] });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', packageSelections: [{ id: 'sel-1', packageId: PKG_A }] });

    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe', packageId: PKG_A, packageName: 'Pkg A' } });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        packageSelections: { create: [{ isManual: false, packageId: PKG_A, packageName: 'Pkg A' }] },
      }),
    }));
    expect(mockLeadUpdate).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { primarySelectionId: 'sel-1' } });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('creates a manual selection and ignores any packageId sent alongside it', async () => {
    mockLeadCreate.mockResolvedValue({ id: 'lead-1', packageSelections: [{ id: 'sel-1', isManual: true }] });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', packageSelections: [{ id: 'sel-1', isManual: true }] });

    const { req, res, next } = buildReqRes({
      body: { name: 'Jane Doe', isManualItinerary: true, packageId: PKG_A, packageName: 'Pkg A' },
    });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        packageSelections: { create: [{ isManual: true, packageId: null, packageName: null }] },
      }),
    }));
  });

  it('creates a lead with no package selection when neither packageId nor isManualItinerary is given', async () => {
    mockLeadCreate.mockResolvedValue({ id: 'lead-1', packageSelections: [] });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', packageSelections: [] });

    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe' } });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const createCall = mockLeadCreate.mock.calls[0][0];
    expect(createCall.data.packageSelections).toBeUndefined();
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe('updateLead — lifecycle transitions', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockReset();
    mockLeadUpdate.mockReset();
    mockGatekeeperInputs.mockReset().mockReturnValue({
      sellSubtotal: 0, verifiedPaymentTotal: 0, depositAmount: 0, flightActualTotal: 0, hotelActualTotal: 0,
    });
    mockLoadPrimarySelection.mockReset().mockResolvedValue({ pricing: {}, costLines: [] });
    mockLeadUpdate.mockResolvedValue(leadFixture());
  });

  it('rejects setting lifecycleStatus to QUOTED directly — must use the per-selection quote endpoint', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING' }));

    const { req, res, next } = buildReqRes({ body: { lifecycleStatus: 'QUOTED' } });
    await updateLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/packages\/:selectionId\/quote/) }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('allows a lead-level transition to CLOSED_LOST with a reason', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING' }));

    const { req, res, next } = buildReqRes({ body: { lifecycleStatus: 'CLOSED_LOST', lostReason: 'Budget' } });
    await updateLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lifecycleStatus: 'CLOSED_LOST', lostReason: 'Budget' }),
    }));
  });

  it('rejects CLOSED_LOST without a reason', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING' }));

    const { req, res, next } = buildReqRes({ body: { lifecycleStatus: 'CLOSED_LOST' } });
    await updateLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/lostReason/i) }));
  });

  it('rejects travel date changes once quoted', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'QUOTED' }));

    const { req, res, next } = buildReqRes({ body: { travelDate: '2026-03-01' } });
    await updateLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/travel dates/i) }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('rejects traveler count changes once quoted', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'QUOTED', numberOfTravelers: 2 }));

    const { req, res, next } = buildReqRes({ body: { numberOfTravelers: 4 } });
    await updateLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/numberOfTravelers/i) }));
  });

  it('allows plain contact-field edits with no lifecycle change', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture());

    const { req, res, next } = buildReqRes({ body: { name: 'Renamed Lead' } });
    await updateLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Renamed Lead' }),
    }));
  });
});

describe('draftLead', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockReset();
    mockLeadUpdate.mockReset();
    mockSelectionCount.mockReset();
    mockLoadPrimarySelection.mockReset().mockResolvedValue({ pricing: {}, costLines: [] });
    mockGatekeeperInputs.mockReset().mockReturnValue({
      sellSubtotal: 0, verifiedPaymentTotal: 0, depositAmount: 0, flightActualTotal: 0, hotelActualTotal: 0,
    });
    mockLeadUpdate.mockResolvedValue(leadFixture({ lifecycleStatus: 'DRAFTING' }));
  });

  it('rejects a lead with no package selections', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'NEW' }));
    mockSelectionCount.mockResolvedValue(0);

    const { req, res, next } = buildReqRes();
    await draftLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/no package selected/i) }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('moves to DRAFTING without eagerly copying anything, once a selection exists', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ lifecycleStatus: 'NEW' }));
    mockSelectionCount.mockResolvedValue(1);

    const { req, res, next } = buildReqRes();
    await draftLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ lifecycleStatus: 'DRAFTING' }),
    }));
  });
});

describe('createLead — auto-assignment (round robin)', () => {
  const txLead = { create: mockLeadCreate, update: mockLeadUpdate, findUnique: mockLeadFindUnique };
  const txSettings = { upsert: mockSettingsUpsert, update: mockSettingsUpdate };

  beforeEach(() => {
    mockLeadCreate.mockReset();
    mockLeadUpdate.mockReset();
    mockLeadFindUnique.mockReset();
    mockSettingsUpsert.mockReset();
    mockSettingsUpdate.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) => fn({ lead: txLead, settings: txSettings }));
    mockLeadCreate.mockResolvedValue({ id: 'lead-1', packageSelections: [] });
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', packageSelections: [] });
  });

  it('assigns the rep at the current roundRobinIndex and increments it, for an admin-created lead with no assignee', async () => {
    mockSettingsUpsert.mockResolvedValue({
      id: 'settings-1', assignmentMode: 'auto', autoStrategy: 'round_robin',
      enabledSalesRepIds: ['rep-a', 'rep-b'], roundRobinIndex: 1,
    });

    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe' } });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: 'rep-b', assignmentMode: 'auto' }),
    }));
    expect(mockSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: { roundRobinIndex: { increment: 1 } },
    });
  });

  it('does not auto-assign when Settings.assignmentMode is manual', async () => {
    mockSettingsUpsert.mockResolvedValue({
      id: 'settings-1', assignmentMode: 'manual', autoStrategy: 'round_robin',
      enabledSalesRepIds: ['rep-a', 'rep-b'], roundRobinIndex: 0,
    });

    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe' } });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: null }),
    }));
    expect(mockSettingsUpdate).not.toHaveBeenCalled();
  });

  it('does not auto-assign when the creating user is a salesRep — the lead self-assigns instead', async () => {
    mockSettingsUpsert.mockResolvedValue({
      id: 'settings-1', assignmentMode: 'auto', autoStrategy: 'round_robin',
      enabledSalesRepIds: ['rep-a', 'rep-b'], roundRobinIndex: 0,
    });
    const salesRepUser = { id: 'rep-self', role: 'salesRep', isSuperAdmin: false, permissions: ['manage_leads'] };

    const { req, res, next } = buildReqRes({ body: { name: 'Jane Doe' }, user: salesRepUser });
    await createLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: 'rep-self', assignmentMode: 'manual' }),
    }));
    expect(mockSettingsUpsert).not.toHaveBeenCalled();
  });
});

describe('assignLead / unassignLead — authorization and consistency', () => {
  const adminOrSalesRep = (overrides) => ({ id: 'actor-1', role: 'salesRep', isSuperAdmin: false, permissions: [], ...overrides });

  beforeEach(() => {
    mockLeadFindUnique.mockReset();
    mockLeadUpdate.mockReset();
  });

  it('rejects a salesRep without the manage_leads permission from assigning a lead', async () => {
    const { req, res, next } = buildReqRes({ user: adminOrSalesRep({ permissions: [] }), body: { assignedTo: 'rep-b' } });
    await assignLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('allows a salesRep with the manage_leads permission to assign an unassigned lead', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ assignedToId: null }));
    mockLeadUpdate.mockResolvedValue(leadFixture({ assignedToId: 'rep-b' }));

    const { req, res, next } = buildReqRes({ user: adminOrSalesRep({ permissions: ['manage_leads'] }), body: { assignedTo: 'rep-b' } });
    await assignLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: 'rep-b', assignmentMode: 'manual' }),
    }));
  });

  it('refuses to let a salesRep with manage_leads move a lead that already has an owner', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ assignedToId: 'rep-a' }));

    const { req, res, next } = buildReqRes({ user: adminOrSalesRep({ permissions: ['manage_leads'] }), body: { assignedTo: 'rep-b' } });
    await assignLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('allows an admin to move a lead that already has an owner', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ assignedToId: 'rep-a' }));
    mockLeadUpdate.mockResolvedValue(leadFixture({ assignedToId: 'rep-b' }));

    const { req, res, next } = buildReqRes({ user: adminUser, body: { assignedTo: 'rep-b' } });
    await assignLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: 'rep-b' }),
    }));
  });

  it('allows a superAdmin to move a lead that already has an owner', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ assignedToId: 'rep-a' }));
    mockLeadUpdate.mockResolvedValue(leadFixture({ assignedToId: 'rep-b' }));

    const superAdmin = { id: 'super-1', role: 'salesRep', isSuperAdmin: true, permissions: [] };
    const { req, res, next } = buildReqRes({ user: superAdmin, body: { assignedTo: 'rep-b' } });
    await assignLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assignedToId: 'rep-b' }),
    }));
  });

  it('resets assignmentMode to manual when unassigning a lead', async () => {
    mockLeadFindUnique.mockResolvedValue(leadFixture({ assignmentMode: 'auto' }));
    mockLeadUpdate.mockResolvedValue(leadFixture({ assignedToId: null, assignmentMode: 'manual' }));

    const { req, res, next } = buildReqRes({ user: adminUser });
    await unassignLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { assignedToId: null, assignedById: 'user-1', assignmentMode: 'manual' },
    }));
  });

  it('returns a clean 404 instead of throwing when unassigning a lead that does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const { req, res, next } = buildReqRes({ user: adminUser });
    await unassignLead(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

describe('getLeadsByStatus / searchLeads — ownership scoping', () => {
  const salesRepUser = { id: 'rep-1', role: 'salesRep', isSuperAdmin: false, permissions: [] };

  beforeEach(() => {
    mockLeadFindMany.mockReset().mockResolvedValue([]);
  });

  it('scopes getLeadsByStatus to the caller’s own leads when role is salesRep', async () => {
    const req = { params: { status: 'NEW' }, query: {}, user: salesRepUser };
    const res = { json: vi.fn() };
    await getLeadsByStatus(req, res, vi.fn());

    expect(mockLeadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ lifecycleStatus: 'NEW' }, { assignedToId: 'rep-1' }] },
    }));
  });

  it('returns leads for the given status across all reps when role is admin', async () => {
    const req = { params: { status: 'NEW' }, query: {}, user: adminUser };
    const res = { json: vi.fn() };
    await getLeadsByStatus(req, res, vi.fn());

    expect(mockLeadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ lifecycleStatus: 'NEW' }] },
    }));
  });

  it('scopes searchLeads to the caller’s own leads plus the visible PENDING_VERIFICATION queue when role is salesRep', async () => {
    const req = { query: { query: 'jane' }, user: salesRepUser };
    const res = { json: vi.fn() };
    await searchLeads(req, res, vi.fn());

    const calledWhere = mockLeadFindMany.mock.calls[0][0].where;
    expect(calledWhere.AND).toContainEqual({
      OR: [{ assignedToId: 'rep-1' }, { lifecycleStatus: 'PENDING_VERIFICATION' }],
    });
  });

  it('does not scope searchLeads when role is admin', async () => {
    const req = { query: { query: 'jane' }, user: adminUser };
    const res = { json: vi.fn() };
    await searchLeads(req, res, vi.fn());

    const calledWhere = mockLeadFindMany.mock.calls[0][0].where;
    expect(calledWhere.AND).toHaveLength(1);
  });
});

describe('handleFacebookLeadEvent', () => {
  const txLead = { create: mockLeadCreate };
  const txSettings = { upsert: mockSettingsUpsert, update: mockSettingsUpdate };

  beforeEach(() => {
    mockLeadFindFirst.mockReset();
    mockLeadCreate.mockReset();
    mockLeadRemarkCreate.mockReset();
    mockLeadRemarkFindFirst.mockReset().mockResolvedValue(null);
    mockSettingsUpsert.mockReset().mockResolvedValue({ assignmentMode: 'manual' });
    mockSettingsUpdate.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) => fn({ lead: txLead, settings: txSettings }));
  });

  it('creates a lead from a Facebook lead payload when no duplicate exists', async () => {
    mockLeadFindFirst.mockResolvedValue(null);
    mockLeadCreate.mockResolvedValue({ id: 'lead-new', assignedToId: null });

    const req = { body: { leadgenId: 'fb-1', name: 'Jane', email: 'jane@test.com', phone: '123' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handleFacebookLeadEvent(req, res, vi.fn());

    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'jane@test.com', source: 'facebook', platform: 'Facebook' }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-new', duplicate: false }),
    }));
  });

  it('appends a remark to the existing lead instead of creating a duplicate', async () => {
    mockLeadFindFirst.mockResolvedValue({ id: 'lead-existing' });

    const req = { body: { leadgenId: 'fb-2', name: 'Jane', email: 'jane@test.com' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handleFacebookLeadEvent(req, res, vi.fn());

    expect(mockLeadCreate).not.toHaveBeenCalled();
    expect(mockLeadRemarkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-existing' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: { leadId: 'lead-existing', duplicate: true },
    }));
  });

  it('rejects a payload with neither email nor phone', async () => {
    const req = { body: { leadgenId: 'fb-3', name: 'Jane' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await handleFacebookLeadEvent(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockLeadFindFirst).not.toHaveBeenCalled();
  });
});

describe('handleGoogleAdsLeadEvent', () => {
  const txLead = { create: mockLeadCreate };
  const txSettings = { upsert: mockSettingsUpsert, update: mockSettingsUpdate };

  beforeEach(() => {
    mockLeadFindFirst.mockReset().mockResolvedValue(null);
    mockLeadCreate.mockReset().mockResolvedValue({ id: 'lead-google', assignedToId: null });
    mockLeadRemarkCreate.mockReset();
    mockSettingsUpsert.mockReset().mockResolvedValue({ assignmentMode: 'manual' });
    mockSettingsUpdate.mockReset();
    mockTransaction.mockReset().mockImplementation(async (fn) => fn({ lead: txLead, settings: txSettings }));
  });

  it('creates a Google Ads lead with its provider ID and trip details', async () => {
    const req = { body: {
      leadId: 'google-1', name: 'Jane Doe', email: 'Jane@Test.com', phone: '+1 (555) 123-4567',
      destination: 'Sri Lanka', travelDate: '2027-04-01T00:00:00.000Z', numberOfTravelers: 2,
    } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handleGoogleAdsLeadEvent(req, res, vi.fn());

    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'jane@test.com', phone: '15551234567', source: 'google_ads', platform: 'Google_Ads',
        intakeChannel: 'google-ads', intakeSessionId: 'google-1', destination: 'Sri Lanka',
        numberOfTravelers: 2,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('saves test leads and uses the configured sales rep auto-assignment', async () => {
    mockSettingsUpsert.mockResolvedValue({
      id: 'settings-1',
      assignmentMode: 'auto',
      autoStrategy: 'round_robin',
      enabledSalesRepIds: ['sales-rep-1'],
      roundRobinIndex: 0,
    });
    mockLeadCreate.mockResolvedValue({ id: 'lead-google-test', assignedToId: 'sales-rep-1' });
    const req = { body: {
      leadId: 'google-test-1', isTest: true, name: 'Test Traveler',
      email: 'test@example.com', phone: '+1 555 123 4567',
    } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

    await handleGoogleAdsLeadEvent(req, res, vi.fn());

    expect(mockLeadFindFirst).toHaveBeenCalledTimes(1);
    expect(mockSettingsUpsert).toHaveBeenCalled();
    expect(mockSettingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { roundRobinIndex: { increment: 1 } },
    }));
    expect(mockLeadCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: '[TEST] Test Traveler',
        tags: ['google-ads-lead', 'google-ads-test'],
        assignedToId: 'sales-rep-1',
        assignmentMode: 'auto',
        intakeSessionId: 'google-test-1',
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns the existing lead when Google retries the same lead ID', async () => {
    mockLeadFindFirst.mockResolvedValueOnce({ id: 'lead-existing' });
    const req = { body: { leadId: 'google-1', phone: '15551234567' } };
    const res = { json: vi.fn() };

    await handleGoogleAdsLeadEvent(req, res, vi.fn());

    expect(mockLeadCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { leadId: 'lead-existing', duplicate: true } });
  });

  it('matches normalized phone numbers and does not repeat duplicate remarks on retries', async () => {
    mockLeadFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'lead-existing' });
    mockLeadRemarkFindFirst.mockResolvedValue({ id: 'remark-existing' });
    const req = { body: { leadId: 'google-1', phone: '+1 (555) 123-4567' } };
    const res = { json: vi.fn() };

    await handleGoogleAdsLeadEvent(req, res, vi.fn());

    expect(mockLeadFindFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { OR: expect.arrayContaining([{ phoneNormalized: '15551234567' }]) },
    }));
    expect(mockLeadRemarkCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { leadId: 'lead-existing', duplicate: true } });
  });

  it('rejects leads without a valid contact method', async () => {
    const req = { body: { leadId: 'google-1', name: 'Jane Doe' } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await handleGoogleAdsLeadEvent(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockLeadCreate).not.toHaveBeenCalled();
  });
});

describe('logCommunication — WhatsApp/billing timeline ingestion', () => {
  beforeEach(() => {
    mockLeadFindFirst.mockReset();
    mockLeadCommunicationLogCreate.mockReset();
  });

  it('logs directly against leadId when provided, skipping the phone lookup', async () => {
    mockLeadCommunicationLogCreate.mockResolvedValue({ id: 'log-1' });

    const req = { body: { leadId: 'lead-1', type: 'whatsapp', notes: 'Quotation Q-1 sent' } };
    const res = { json: vi.fn() };
    await logCommunication(req, res, vi.fn());

    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(mockLeadCommunicationLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadId: 'lead-1', type: 'whatsapp', notes: 'Quotation Q-1 sent' }),
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { matched: true, leadId: 'lead-1' } });
  });

  it('resolves a lead by normalized phone digits when leadId is not given', async () => {
    mockLeadFindFirst.mockResolvedValue({ id: 'lead-2' });
    mockLeadCommunicationLogCreate.mockResolvedValue({ id: 'log-2' });

    const req = { body: { phone: '+1 (555) 123-4567', type: 'whatsapp', notes: 'WhatsApp (customer): hi' } };
    const res = { json: vi.fn() };
    await logCommunication(req, res, vi.fn());

    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ phoneNormalized: '15551234567' }, { whatsappNormalized: '15551234567' }] },
    });
    expect(mockLeadCommunicationLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-2' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { matched: true, leadId: 'lead-2' } });
  });

  it('queries the normalized columns so an E.164 lead stored with a leading plus still matches', async () => {
    mockLeadFindFirst.mockResolvedValue({ id: 'lead-rep-created' });
    mockLeadCommunicationLogCreate.mockResolvedValue({ id: 'log-3' });

    const req = { body: { phone: '94771234567', type: 'whatsapp', notes: 'WhatsApp (customer): hi' } };
    const res = { json: vi.fn() };
    await logCommunication(req, res, vi.fn());

    expect(mockLeadFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ phoneNormalized: '94771234567' }, { whatsappNormalized: '94771234567' }] },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { matched: true, leadId: 'lead-rep-created' } });
  });

  it('skips the lookup and responds matched:false when the phone holds no digits', async () => {
    const req = { body: { phone: 'n/a', type: 'whatsapp', notes: 'WhatsApp (customer): hi' } };
    const res = { json: vi.fn() };
    await logCommunication(req, res, vi.fn());

    expect(mockLeadFindFirst).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { matched: false } });
  });

  it('responds matched:false without erroring when no lead matches the phone number', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    const req = { body: { phone: '15559999999', type: 'whatsapp', notes: 'WhatsApp (customer): hi' } };
    const res = { json: vi.fn() };
    await logCommunication(req, res, vi.fn());

    expect(mockLeadCommunicationLogCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { matched: false } });
  });

  it('rejects a payload with neither leadId nor phone', async () => {
    const req = { body: { type: 'whatsapp', notes: 'orphan note' } };
    const res = { json: vi.fn() };
    const next = vi.fn();
    await logCommunication(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(mockLeadCommunicationLogCreate).not.toHaveBeenCalled();
  });
});

describe('sendWhatsappReply — agent free-form reply', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockReset();
    mockLeadCommunicationLogCreate.mockReset();
    mockSendWhatsappText.mockReset();
  });

  it('sends via notification-service and logs an outbound entry on success', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', whatsapp: '15551234567', phone: null, assignedToId: 'user-1' });
    mockSendWhatsappText.mockResolvedValue({ success: true });
    mockLeadCommunicationLogCreate.mockResolvedValue({ id: 'log-3', notes: 'WhatsApp (agent): On it!' });

    const { req, res } = buildReqRes({ body: { text: 'On it!' } });
    await sendWhatsappReply(req, res, vi.fn());

    expect(mockSendWhatsappText).toHaveBeenCalledWith({ to: '15551234567', body: 'On it!' });
    expect(mockLeadCommunicationLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leadId: 'lead-1', type: 'whatsapp', byId: 'user-1' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'log-3', notes: 'WhatsApp (agent): On it!' } });
  });

  it('falls back to phone when whatsapp is not set on the lead', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', whatsapp: null, phone: '15557654321', assignedToId: 'user-1' });
    mockSendWhatsappText.mockResolvedValue({ success: true });
    mockLeadCommunicationLogCreate.mockResolvedValue({ id: 'log-4' });

    const { req, res } = buildReqRes({ body: { text: 'On it!' } });
    await sendWhatsappReply(req, res, vi.fn());

    expect(mockSendWhatsappText).toHaveBeenCalledWith({ to: '15557654321', body: 'On it!' });
  });

  it('rejects when the lead has no phone number on file', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', whatsapp: null, phone: null, assignedToId: 'user-1' });

    const { req, res, next } = buildReqRes({ body: { text: 'On it!' } });
    await sendWhatsappReply(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockSendWhatsappText).not.toHaveBeenCalled();
  });

  it("rejects a salesRep replying on a lead assigned to someone else", async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-1', whatsapp: '15551234567', assignedToId: 'other-user' });
    const salesRep = { id: 'user-2', role: 'salesRep', isSuperAdmin: false, permissions: [] };

    const { req, res, next } = buildReqRes({ body: { text: 'On it!' }, user: salesRep });
    await sendWhatsappReply(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockSendWhatsappText).not.toHaveBeenCalled();
  });

  it('returns 404 when the lead does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const { req, res, next } = buildReqRes({ body: { text: 'On it!' } });
    await sendWhatsappReply(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('getLeadStats — assigned/unassigned/conversionRate summary', () => {
  beforeEach(() => {
    mockLeadGroupBy.mockReset();
    mockLeadAggregate.mockReset();
    mockLeadCount.mockReset();
  });

  it('computes assigned, unassigned, and conversionRate for an admin (unscoped) request', async () => {
    mockLeadGroupBy.mockResolvedValue([
      { lifecycleStatus: 'NEW', _count: 3 },
      { lifecycleStatus: 'CONFIRMED', _count: 2 },
    ]);
    mockLeadAggregate.mockResolvedValue({ _count: 22 });
    // Promise.all order in the controller: assigned count, then confirmed count.
    mockLeadCount.mockResolvedValueOnce(11).mockResolvedValueOnce(2);

    const { req, res, next } = buildReqRes({ user: adminUser });
    await getLeadStats(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      summary: expect.objectContaining({
        total: 22,
        assigned: 11,
        unassigned: 11,
        converted: 2,
        conversionRate: '9.1',
      }),
    }));
  });

  it('does not let the assigned-count query clobber a salesRep\'s own assignedToId scope', async () => {
    // Regression test: prisma.lead.count({ where: { ...where, assignedToId: { not:
    // null } } }) used to silently overwrite where.assignedToId (the salesRep's own
    // id) with { not: null }, counting every assigned lead app-wide instead of just
    // this rep's own leads - producing assigned > total and a negative unassigned.
    // The fix composes both conditions via an AND array instead of a key-colliding
    // spread.
    mockLeadGroupBy.mockResolvedValue([{ lifecycleStatus: 'NEW', _count: 3 }]);
    mockLeadAggregate.mockResolvedValue({ _count: 3 });
    mockLeadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    const salesRepUser = { id: 'rep-self', role: 'salesRep', isSuperAdmin: false, permissions: [] };
    const { req, res, next } = buildReqRes({ user: salesRepUser });
    await getLeadStats(req, res, next);

    const assignedCountCall = mockLeadCount.mock.calls[0][0];
    expect(assignedCountCall.where).toEqual({
      AND: [
        { OR: [{ assignedToId: 'rep-self' }, { lifecycleStatus: 'PENDING_VERIFICATION' }] },
        { assignedToId: { not: null } },
      ],
    });

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ total: 3, assigned: 3, unassigned: 0 }),
    }));
  });

  it('returns "0.0" conversionRate when there are no leads in scope', async () => {
    mockLeadGroupBy.mockResolvedValue([]);
    mockLeadAggregate.mockResolvedValue({ _count: 0 });
    mockLeadCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const { req, res, next } = buildReqRes({ user: adminUser });
    await getLeadStats(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ total: 0, assigned: 0, unassigned: 0, conversionRate: '0.0' }),
    }));
  });
});
describe('getLeads / searchLeads — remarks reach the list UI', () => {
  beforeEach(() => {
    mockLeadFindMany.mockReset().mockResolvedValue([]);
    mockLeadCount.mockReset().mockResolvedValue(0);
  });

  it('includes each lead’s remarks in the paginated list response', async () => {
    const req = { query: {}, user: adminUser };
    await getLeads(req, { json: vi.fn() }, vi.fn());

    expect(mockLeadFindMany.mock.calls[0][0].include.remarks).toEqual({ orderBy: { date: 'desc' } });
  });

  it('restricts the paginated list to a bounded comma-separated id set', async () => {
    const req = { query: { ids: 'lead-1,lead-2,,lead-3' }, user: adminUser };
    await getLeads(req, { json: vi.fn() }, vi.fn());

    expect(mockLeadFindMany.mock.calls[0][0].where.AND).toContainEqual({
      id: { in: ['lead-1', 'lead-2', 'lead-3'] },
    });
  });

  it('includes each lead’s remarks in search results', async () => {
    const req = { query: { query: 'jane' }, user: adminUser };
    await searchLeads(req, { json: vi.fn() }, vi.fn());

    expect(mockLeadFindMany.mock.calls[0][0].include.remarks).toEqual({ orderBy: { date: 'desc' } });
  });
});

describe('updateLead — remarks replacement', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockReset().mockResolvedValue(leadFixture());
    mockLeadUpdate.mockReset().mockResolvedValue(leadFixture());
  });

  it('replaces the whole remarks list when the client sends one', async () => {
    const { req, res, next } = buildReqRes({ body: { remarks: [{ text: 'Called the client', date: '2026-09-11' }] } });
    await updateLead(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        remarks: {
          deleteMany: {},
          create: [{ text: 'Called the client', date: new Date('2026-09-11'), addedById: 'user-1' }],
        },
      }),
    }));
  });

  it('clears every remark when the client sends an empty list', async () => {
    const { req, res, next } = buildReqRes({ body: { remarks: [] } });
    await updateLead(req, res, next);

    expect(mockLeadUpdate.mock.calls[0][0].data.remarks).toEqual({ deleteMany: {}, create: [] });
  });

  it('leaves remarks untouched when the field is absent', async () => {
    const { req, res, next } = buildReqRes({ body: { name: 'Renamed Lead' } });
    await updateLead(req, res, next);

    expect(mockLeadUpdate.mock.calls[0][0].data.remarks).toBeUndefined();
  });
});

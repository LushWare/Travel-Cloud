import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const {
  mockLeadFindUnique,
  mockLeadFindMany,
  mockLeadUpsert,
  mockLeadCommLogFindMany,
  mockLeadCommLogCreateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockLeadFindUnique: vi.fn(),
  mockLeadFindMany: vi.fn(),
  mockLeadUpsert: vi.fn(),
  mockLeadCommLogFindMany: vi.fn(),
  mockLeadCommLogCreateMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    lead: {
      findFirst: vi.fn(),
      findUnique: mockLeadFindUnique,
      findMany: mockLeadFindMany,
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: mockLeadUpsert,
      create: vi.fn(),
    },
    leadCommunicationLog: {
      findMany: mockLeadCommLogFindMany,
      createMany: mockLeadCommLogCreateMany,
      create: vi.fn(),
    },
    leadRemark: { create: vi.fn() },
    leadStatusHistory: { create: vi.fn() },
    leadPackageSelection: { count: vi.fn() },
    settings: { upsert: vi.fn(), update: vi.fn() },
    $transaction: mockTransaction,
  },
}));

vi.mock('../../services/gatekeeper.service.js', () => ({
  gatekeeperInputs: vi.fn(() => ({
    sellSubtotal: 0, verifiedPaymentTotal: 0, depositAmount: 0, flightActualTotal: 0, hotelActualTotal: 0,
  })),
  loadPrimarySelection: vi.fn(async () => ({ pricing: {}, costLines: [] })),
}));

vi.mock('../../services/notification.client.js', () => ({
  sendWhatsappText: vi.fn(async () => ({ success: true })),
}));

process.env.INTERNAL_EVENTS_TOKEN = 'test-internal-token';

const { default: app } = await import('../../app.js');

const txClient = {
  lead: {
    findFirst: vi.fn(),
    findUnique: mockLeadFindUnique,
    findMany: mockLeadFindMany,
    upsert: mockLeadUpsert,
    create: vi.fn(),
    update: vi.fn(),
  },
  leadCommunicationLog: {
    findMany: mockLeadCommLogFindMany,
    createMany: mockLeadCommLogCreateMany,
    create: vi.fn(),
  },
  leadStatusHistory: { create: vi.fn() },
};

const TOKEN = 'test-internal-token';

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn) => fn(txClient));
  mockLeadCommLogFindMany.mockResolvedValue([]);
  mockLeadCommLogCreateMany.mockResolvedValue({ count: 2 });
});

// ── GET /internal/by-phone ──────────────────────────────────────────────────

describe('GET /api/v1/leads/internal/by-phone', () => {
  const get = (phone) =>
    request(app)
      .get(`/api/v1/leads/internal/by-phone?phone=${encodeURIComponent(phone)}`)
      .set('x-internal-token', TOKEN);

  it('rejects a request without the internal token', async () => {
    const res = await request(app).get('/api/v1/leads/internal/by-phone?phone=94771234567');
    expect(res.status).toBe(401);
  });

  it('queries the normalized columns so a lead stored with a leading plus still matches', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    await get('+94 77 123 4567');

    expect(mockLeadFindMany.mock.calls[0][0].where.OR).toEqual([
      { phoneNormalized: '94771234567' },
      { whatsappNormalized: '94771234567' },
    ]);
  });

  it('excludes closed and cancelled leads from the match', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    await get('94771234567');

    expect(mockLeadFindMany.mock.calls[0][0].where.lifecycleStatus).toEqual({
      notIn: ['CLOSED_LOST', 'CANCELLED'],
    });
  });

  it('returns count 0 with no matches for an unknown caller', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    const res = await get('94771234567');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 0, samePerson: true, matches: [] });
  });

  it('returns only the caller first name, never the full name', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal Perera', lifecycleStatus: 'QUOTED', destination: 'Maldives', assignedToId: 'rep-1' },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].firstName).toBe('Nimal');
  });

  it('maps QUOTED onto the coarse quote_sent status class', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal', lifecycleStatus: 'QUOTED', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].statusClass).toBe('quote_sent');
  });

  it('maps CONFIRMED onto the confirmed status class', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].statusClass).toBe('confirmed');
  });

  it('returns exactly the bounded projection and no other lead field', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal', lifecycleStatus: 'QUOTED', destination: 'Maldives', assignedToId: 'rep-1' },
    ]);
    const res = await get('94771234567');

    expect(Object.keys(res.body.data.matches[0]).sort()).toEqual([
      'assignedToId', 'destination', 'firstName', 'leadId', 'recency', 'statusClass',
    ]);
  });

  it('never returns a raw travel date, only the recency classification', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-1', name: 'Nimal', lifecycleStatus: 'QUOTED', destination: 'Maldives', assignedToId: 'rep-1',
        travelDate: new Date('2026-12-01'), endDate: new Date('2026-12-08'), updatedAt: new Date(),
      },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].travelDate).toBeUndefined();
    expect(res.body.data.matches[0].endDate).toBeUndefined();
  });

  it('selects only the bounded projection from the database', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    await get('94771234567');

    expect(mockLeadFindMany.mock.calls[0][0].select).toEqual({
      id: true, name: true, lifecycleStatus: true, destination: true, assignedToId: true,
      travelDate: true, endDate: true, updatedAt: true,
    });
  });

  it('returns both matches when one number is shared by two leads', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal', lifecycleStatus: 'QUOTED', destination: null, assignedToId: null },
      { id: 'lead-2', name: 'Kamal', lifecycleStatus: 'CONFIRMED', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.count).toBe(2);
  });

  it('reports samePerson false when the matched leads carry two different names', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal Perera', lifecycleStatus: 'QUOTED', destination: null, assignedToId: null },
      { id: 'lead-2', name: 'Kamala Silva', lifecycleStatus: 'NEW', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.samePerson).toBe(false);
  });

  it('reports samePerson true for a repeat customer whose leads all carry one name', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: 'Nimal Perera', lifecycleStatus: 'CONFIRMED', destination: null, assignedToId: null },
      { id: 'lead-2', name: 'Nimal Perera', lifecycleStatus: 'CONFIRMED', destination: null, assignedToId: null },
      { id: 'lead-3', name: 'Nimal Perera', lifecycleStatus: 'NEW', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.samePerson).toBe(true);
  });

  it('marks a trip whose end date has gone by as PAST', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-1', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Maldives', assignedToId: null,
        travelDate: new Date('2019-01-01'), endDate: new Date('2019-01-08'), updatedAt: new Date('2019-01-08'),
      },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].recency).toBe('PAST');
  });

  it('marks a trip that has not travelled yet as LIVE', async () => {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-1', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Maldives', assignedToId: null,
        travelDate: soon, endDate: soon, updatedAt: new Date(),
      },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].recency).toBe('LIVE');
  });

  it('looks past the first five leads so a long-standing customer is still classified', async () => {
    mockLeadFindMany.mockResolvedValue([]);
    await get('94771234567');

    expect(mockLeadFindMany.mock.calls[0][0].take).toBe(10);
  });

  it('rejects a phone parameter holding no digits with 400', async () => {
    const res = await get('n/a');
    expect(res.status).toBe(400);
  });

  it('rejects a missing phone parameter with 400', async () => {
    const res = await request(app)
      .get('/api/v1/leads/internal/by-phone')
      .set('x-internal-token', TOKEN);

    expect(res.status).toBe(400);
  });

  it('returns a null first name for a lead with no name', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-1', name: null, lifecycleStatus: 'NEW', destination: null, assignedToId: null },
    ]);
    const res = await get('94771234567');

    expect(res.body.data.matches[0].firstName).toBeNull();
  });
});

// ── POST /internal/intake, voice channel ────────────────────────────────────

describe('voice channel lead intake', () => {
  const voiceBody = (overrides = {}) => ({
    channel: 'voice',
    sessionId: 'call_abc123',
    contact: { phone: '94771234567' },
    slots: { destination: 'Maldives' },
    transcript: [
      { id: 'call_abc123:0', role: 'assistant', content: 'Thanks for calling.', at: '2026-09-10T00:00:00.000Z' },
      { id: 'call_abc123:1', role: 'user', content: 'Maldives in December please', at: '2026-09-10T00:00:01.000Z' },
    ],
    ...overrides,
  });

  const postIntake = (body) =>
    request(app)
      .post('/api/v1/leads/internal/intake')
      .set('x-internal-token', TOKEN)
      .send(body);

  const arrangeNewLead = () => {
    mockLeadFindUnique.mockResolvedValue(null);
    mockLeadUpsert.mockResolvedValue({ id: 'lead-v1', lifecycleStatus: 'PENDING_VERIFICATION' });
  };

  it('accepts voice as a valid intake channel', async () => {
    arrangeNewLead();
    const res = await postIntake(voiceBody());
    expect(res.status).toBe(200);
  });

  it('creates a voice lead with the voice_agent source', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.source).toBe('voice_agent');
  });

  it('creates a voice lead on the Voice_Agent platform', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.platform).toBe('Voice_Agent');
  });

  it('quarantines a voice lead at PENDING_VERIFICATION like every machine-made lead', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.lifecycleStatus).toBe('PENDING_VERIFICATION');
  });

  it('marks a voice lead as AI handled', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.aiHandled).toBe(true);
  });

  it('populates the normalized phone mirror on a voice lead', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.phoneNormalized).toBe('94771234567');
  });

  it('keys the lead on the provider conversation id so a webhook retry does not fork a second lead', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].where).toEqual({
      intakeChannel_intakeSessionId: { intakeChannel: 'voice', intakeSessionId: 'call_abc123' },
    });
  });

  it('records the voice origin in the status history note', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadUpsert.mock.calls[0][0].create.statusHistory.create[0].notes)
      .toBe('Created by voice agent lead intake');
  });

  it('does not mark a chatbot lead as AI handled', async () => {
    arrangeNewLead();
    await postIntake(voiceBody({
      channel: 'chatbot',
      sessionId: 'session-1',
      contact: { email: 'jane@test.com' },
    }));
    expect(mockLeadUpsert.mock.calls[0][0].create.aiHandled).toBe(false);
  });

  it('keeps the chatbot status history note for a chatbot lead', async () => {
    arrangeNewLead();
    await postIntake(voiceBody({
      channel: 'chatbot',
      sessionId: 'session-1',
      contact: { email: 'jane@test.com' },
    }));
    expect(mockLeadUpsert.mock.calls[0][0].create.statusHistory.create[0].notes)
      .toBe('Created by chatbot lead intake');
  });

  it('appends the call transcript as communication log rows', async () => {
    arrangeNewLead();
    await postIntake(voiceBody());
    expect(mockLeadCommLogCreateMany).toHaveBeenCalled();
  });

  it('rejects an unknown intake channel', async () => {
    const res = await postIntake(voiceBody({ channel: 'telepathy' }));
    expect(res.status).toBe(400);
  });

  it('appends only to the communication log once the lead has been claimed', async () => {
    mockLeadFindUnique.mockResolvedValue({ id: 'lead-v1', lifecycleStatus: 'DRAFTING' });
    await postIntake(voiceBody());

    expect(mockLeadUpsert).not.toHaveBeenCalled();
    expect(mockLeadCommLogCreateMany).toHaveBeenCalled();
  });
});

// ── GET /:id/related ────────────────────────────────────────────────────────
// A repeat customer's calls each raise their own lead, so the rep needs one
// view that ties them back together — and spots an accidental duplicate.

describe('GET /api/v1/leads/:id/related', () => {
  const REP = {
    'x-user-id': 'rep-1',
    'x-user-role': 'salesRep',
    'x-user-permissions': '[]',
  };
  const ADMIN = {
    'x-user-id': 'admin-1',
    'x-user-role': 'admin',
    'x-user-permissions': '[]',
  };

  const get = (id, headers = REP) =>
    request(app).get(`/api/v1/leads/${id}/related`).set(headers);

  const subject = (over = {}) => ({
    id: 'lead-1', phoneNormalized: '94771234567', whatsappNormalized: null, assignedToId: 'rep-1', ...over,
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/leads/lead-1/related');
    expect(res.status).toBe(401);
  });

  it('returns 404 for a lead that does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const res = await get('lead-1');
    expect(res.status).toBe(404);
  });

  it('refuses a salesRep asking about a lead assigned to someone else', async () => {
    mockLeadFindUnique.mockResolvedValue(subject({ assignedToId: 'rep-2' }));
    const res = await get('lead-1');
    expect(res.status).toBe(403);
  });

  it('lets an admin see the related leads of any rep', async () => {
    mockLeadFindUnique.mockResolvedValue(subject({ assignedToId: 'rep-2' }));
    mockLeadFindMany.mockResolvedValue([]);
    const res = await get('lead-1', ADMIN);
    expect(res.status).toBe(200);
  });

  it('returns an empty list without querying when the lead has no number on file', async () => {
    mockLeadFindUnique.mockResolvedValue(subject({ phoneNormalized: null, whatsappNormalized: null }));
    const res = await get('lead-1');

    expect(res.body.data).toEqual({ count: 0, related: [] });
    expect(mockLeadFindMany).not.toHaveBeenCalled();
  });

  it('excludes the lead being viewed from its own related list', async () => {
    mockLeadFindUnique.mockResolvedValue(subject());
    mockLeadFindMany.mockResolvedValue([]);
    await get('lead-1');

    expect(mockLeadFindMany.mock.calls[0][0].where.id).toEqual({ not: 'lead-1' });
  });

  it('matches on the whatsapp number as well as the phone number', async () => {
    mockLeadFindUnique.mockResolvedValue(subject({ whatsappNormalized: '94779999999' }));
    mockLeadFindMany.mockResolvedValue([]);
    await get('lead-1');

    expect(mockLeadFindMany.mock.calls[0][0].where.OR).toEqual([
      { phoneNormalized: { in: ['94771234567', '94779999999'] } },
      { whatsappNormalized: { in: ['94771234567', '94779999999'] } },
    ]);
  });

  it('counts every other lead sharing the number', async () => {
    mockLeadFindUnique.mockResolvedValue(subject());
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-2', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Maldives' },
      { id: 'lead-3', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Dubai' },
    ]);
    const res = await get('lead-1');

    expect(res.body.data.count).toBe(2);
  });

  it('classifies a finished past trip as PAST for the rep', async () => {
    mockLeadFindUnique.mockResolvedValue(subject());
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-2', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Maldives',
        travelDate: new Date('2019-01-01'), endDate: new Date('2019-01-08'), updatedAt: new Date('2019-01-08'),
      },
    ]);
    const res = await get('lead-1');

    expect(res.body.data.related[0].recency).toBe('PAST');
  });

  it('includes no pricing figure in the related-lead projection', async () => {
    mockLeadFindUnique.mockResolvedValue(subject());
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-2', name: 'Nimal', lifecycleStatus: 'CONFIRMED', destination: 'Maldives', aiHandled: true,
        travelDate: new Date('2026-12-01'), endDate: new Date('2026-12-08'),
        updatedAt: new Date('2026-09-01'), leadDateTime: new Date('2026-08-01'),
      },
    ]);
    const res = await get('lead-1');

    expect(Object.keys(res.body.data.related[0]).sort()).toEqual([
      'aiHandled', 'createdAt', 'destination', 'endDate', 'id', 'lifecycleStatus', 'name', 'recency', 'travelDate',
    ]);
  });

  it('shows the newest related lead first', async () => {
    mockLeadFindUnique.mockResolvedValue(subject());
    mockLeadFindMany.mockResolvedValue([]);
    await get('lead-1');

    expect(mockLeadFindMany.mock.calls[0][0].orderBy).toEqual({ updatedAt: 'desc' });
  });
});

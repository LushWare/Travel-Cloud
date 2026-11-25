import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { FALLBACK_POLICY_MESSAGE } from '@travel-crm/policy-retrieval';

const {
  mockGenerateStructured,
  mockPrisma,
  mockFetchPolicyDocuments,
  mockClassifyAssistantIntent,
  mockLoadPackageCatalogue,
  mockLoadPackageDetail,
  mockLoadFilteredPackages,
} = vi.hoisted(() => ({
  mockGenerateStructured: vi.fn(),
  mockPrisma: {
    assistantEvent: { create: vi.fn() },
  },
  mockFetchPolicyDocuments: vi.fn(),
  mockClassifyAssistantIntent: vi.fn(),
  mockLoadPackageCatalogue: vi.fn(),
  mockLoadPackageDetail: vi.fn(),
  mockLoadFilteredPackages: vi.fn(),
}));

vi.mock('../../ai/aiClient.js', () => ({
  generateStructured: mockGenerateStructured,
  isAIConfigured: vi.fn(() => true),
}));
vi.mock('../../ai/assistantRouter.js', () => ({
  classifyAssistantIntent: mockClassifyAssistantIntent,
  confidenceBucket: (confidence) => (confidence >= 0.9 ? 'high' : confidence >= 0.7 ? 'medium' : 'low'),
}));

// app.js pulls in routes → db/client.js, which constructs a real
// PrismaClient at import time; mock it so this suite doesn't need DATABASE_URL.
vi.mock('../../db/client.js', () => ({ default: mockPrisma }));
// The real retrieveSnippets + FALLBACK_POLICY_MESSAGE still run (importOriginal
// spread); only the user-service fetch is stubbed.
vi.mock('@travel-crm/policy-retrieval', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchPolicyDocuments: mockFetchPolicyDocuments };
});

// Only the three reads are stubbed: `matchPackage`, `packageFactValues` and
// `countSentence` stay real, so the prompt and the sentences are exercised as
// they are. Stubbing the reads is not optional —
// without it this suite reaches a live package-service on localhost, which
// makes both the assertions and the runtime depend on what is running on the
// machine.
vi.mock('../../catalogue/packageContext.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadPackageCatalogue: mockLoadPackageCatalogue,
    loadPackageDetail: mockLoadPackageDetail,
    loadFilteredPackages: mockLoadFilteredPackages,
  };
});

// The session store is mocked rather than exercised here: its own behaviour
// (create, append, dedupe, expiry) belongs to its own suite, and the controller
// only needs to be told what a session looked like. The default is "no store",
// which is the state every pre-session test in this file was written against —
// the turn then falls back to the request's own window and `shownPackageIds`,
// exactly as it did before sessions existed.
const mockStore = vi.hoisted(() => ({
  loadSession: vi.fn(),
  appendTurn: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock('../../sessions/assistantSession.js', () => mockStore);

const mockSubmitWebsiteBooking = vi.hoisted(() => vi.fn());

vi.mock('../../booking/bookingRequest.js', () => ({
  submitWebsiteBooking: mockSubmitWebsiteBooking,
}));

// The grounded search is mocked rather than exercised here: its own suite covers
// the provider call, the two grounded response shapes and the citation rules,
// and this suite is about what the turn does with the result.
const mockGenerateGrounded = vi.hoisted(() => vi.fn());

vi.mock('../../ai/groundedSearch.js', () => ({
  generateGrounded: mockGenerateGrounded,
  GROUNDING_TIMEOUT_MS: 12_000,
}));

const { default: app } = await import('../../app.js');

// Turn messages must carry a stable id and an ISO timestamp (see the
// WizardTurnMessage contract). Content is used as the id so each fixture is
// unique and stable across the resent sliding window.
function assistantMsg(content, role = 'user') {
  return { id: `m-${content}`, role, content, at: '2026-09-04T00:00:00.000Z' };
}

const AVAILABLE_ROUTES = [
  { name: 'packages', path: '/packages' },
  { name: 'destinations', path: '/destinations-international' },
];

// A client that declares the filters its packages page honours. Kept separate
// from AVAILABLE_ROUTES so the no-filters route shape stays covered too.
const FILTER_ROUTES = [
  { name: 'packages', path: '/packages', params: ['destination', 'priceMin', 'priceMax', 'sort'] },
];

// A client that also declares the destinations that exist — the real shape,
// where the URL value and the name a person says are different strings.
const DESTINATION_ROUTES = [
  {
    name: 'packages',
    path: '/packages',
    params: ['destination', 'priceMax'],
    paramValues: {
      destination: [
        { value: 'uae', label: 'Dubai' },
        { value: 'indonesia', label: 'Bali' },
      ],
    },
  },
];

// A client that offers the planner and a package's customization page — the two
// places the site builds a trip the catalogue does not already contain. The
// customize target is a template the server fills from the package it resolved,
// which is what keeps an id the model can neither see nor author out of the URL.
const CUSTOM_TRIP_ROUTES = [
  {
    name: 'packages',
    path: '/packages',
    params: ['destination'],
    paramValues: {
      destination: [
        { value: 'japan', label: 'Japan' },
        { value: 'uae', label: 'Dubai' },
      ],
    },
  },
  { name: 'planner', path: '/planner', params: [] },
  { name: 'customize', path: '/package/:id/customize', params: [] },
];

function baseBody(overrides = {}) {
  return {
    sessionId: 'session-1',
    messages: [assistantMsg('Show me the packages')],
    availableRoutes: AVAILABLE_ROUTES,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.loadSession.mockResolvedValue({ ok: false });
  mockStore.appendTurn.mockResolvedValue({ ok: true, nextSeq: 1 });
  mockStore.updateSession.mockResolvedValue({ ok: true });
  mockFetchPolicyDocuments.mockResolvedValue([]);
  mockClassifyAssistantIntent.mockRejectedValue(new Error('router unavailable'));
  // No catalogue and no count by default, which is exactly the behaviour every
  // pre-existing case in this file was written against.
  mockLoadPackageCatalogue.mockResolvedValue([]);
  mockLoadPackageDetail.mockResolvedValue(null);
  // The default is "the read told us nothing": no count, no names, so the model's
  // own message stands. Every pre-preview navigate test in this file was written
  // against that behaviour.
  mockLoadFilteredPackages.mockResolvedValue({ packages: [], total: null });
  delete process.env.ASSISTANT_ROUTER_SOCIAL_ENABLED;
  delete process.env.ASSISTANT_ROUTER_OFF_TOPIC_ENABLED;
  delete process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED;
  // Grounded search is on by default (an opt-out flag); a case that wants it off
  // sets it.
  delete process.env.ASSISTANT_TRAVEL_SEARCH_ENABLED;
});

describe('POST /api/v1/assistant/turn — stage-one router', () => {
  it('uses an enabled high-confidence social fast path without policy retrieval or stage two', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: {
        intent: 'social',
        confidence: 0.99,
        hasActionableClause: false,
        socialSubtype: 'greeting',
        reasonCode: 'single_social',
      },
      decision: { committed: true, reason: 'threshold_met' },
      latencyMs: 12,
      version: 'assistant-router.v1',
      model: 'gemini-3.5-flash',
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Hello')] }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      toolCall: { tool: 'respond_conversationally', args: { mode: 'social', socialSubtype: 'greeting' } },
      serverResult: { mode: 'social', source: 'router' },
    });
    expect(mockFetchPolicyDocuments).not.toHaveBeenCalled();
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('requires stage-one and stage-two travel_general agreement for model-authored guidance', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: {
        intent: 'travel_general',
        confidence: 0.94,
        hasActionableClause: true,
        socialSubtype: 'none',
        reasonCode: 'low_risk_travel',
      },
      decision: { committed: false, reason: 'resolver_required' },
      latencyMs: 8,
      version: 'assistant-router.v1',
      model: 'gemini-3.5-flash',
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'travel_general', message: 'Consider choosing one region and leaving a flexible day.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('How should I plan a relaxed week?')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ mode: 'travel_general', source: 'resolver' });
    expect(res.body.data.message).toBe('Consider choosing one region and leaving a flexible day.');
  });

  it('does not accept travel_general model text when stage one disagrees', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: {
        intent: 'ambiguous',
        confidence: 0.5,
        hasActionableClause: true,
        socialSubtype: 'none',
        reasonCode: 'mixed_or_unclear',
      },
      decision: { committed: false, reason: 'resolver_required' },
      latencyMs: 7,
      version: 'assistant-router.v1',
      model: 'gemini-3.5-flash',
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'travel_general', message: 'Untrusted generated guidance.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Maybe plan something and tell me the refund price')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ mode: 'social', source: 'resolver' });
    expect(res.body.data.message).not.toContain('Untrusted');
  });

  it('replaces sensitive guidance with fixed escalation copy', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: {
        intent: 'sensitive',
        confidence: 0.99,
        hasActionableClause: true,
        socialSubtype: 'none',
        reasonCode: 'protected_topic',
      },
      decision: { committed: false, reason: 'resolver_required' },
      latencyMs: 6,
      version: 'assistant-router.v1',
      model: 'gemini-3.5-flash',
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'travel_general', message: 'You do not need a visa.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Do I need a visa tomorrow?')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('answer_faq_policy');
    expect(res.body.data.message).toContain('relevant official authority');
    expect(res.body.data.message).not.toContain('do not need a visa');
  });
});

describe('POST /api/v1/assistant/turn — navigate', () => {
  it('resolves the route/path from the client-offered allowlist when the model names an offered route', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'destinations', message: 'Sure — taking you to the destinations page.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Take me to international destinations')] }));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.toolCall.tool).toBe('navigate');
    expect(res.body.data.serverResult).toEqual({ route: 'destinations', path: '/destinations-international' });
    expect(res.body.data.message).toBe('Sure — taking you to the destinations page.');
    expect(mockClassifyAssistantIntent).not.toHaveBeenCalled();
    expect(mockPrisma.assistantEvent.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        turnId: 'm-Take me to international destinations',
        eventType: 'resolution',
        tool: 'navigate',
        route: 'destinations',
        metadata: expect.objectContaining({
          finalStageTwoTool: 'navigate',
          fallbackUsed: false,
          stageTwoLatencyMs: expect.any(Number),
        }),
      },
    });
  });

  it('ignores a route the client never offered — null result, nothing executed', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'refunds', message: 'Taking you to the refunds page.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Take me to the refund page')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('navigate');
    // Never executed: no path is fabricated and the server does not navigate.
    expect(res.body.data.serverResult).toEqual({ route: null, path: null });
    // Never empty — an empty assistant message would poison the resent
    // sliding window on every later turn (both wire schemas require
    // content.min(1)), permanently bricking the session (/ship red-team).
    expect(res.body.data.message).toBe(
      "I can't take you there directly — try asking for a specific page, like packages or destinations.",
    );
  });

  it('appends the resolved filters to the offered path so the page opens filtered', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: {
        route: 'packages',
        destination: 'Dubai',
        priceMax: 1000,
        message: 'Here are the Dubai packages under 1000.',
      },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('Show me Dubai packages under 1000')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      route: 'packages',
      path: '/packages?destination=dubai&priceMax=1000',
    });
    expect(res.body.data.message).toBe('Here are the Dubai packages under 1000.');
  });

  it('coerces a numeric string filter rather than failing the turn on validation', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', priceMax: '1000', message: 'Under 1000.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Under 1000 please')], availableRoutes: FILTER_ROUTES }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?priceMax=1000' });
  });

  it('still filters by a stated price bound when the model answered with a sort instead', async () => {
    // Mirrors the measured gemini-2.5-flash response to this exact sentence:
    // sort: "price-low", which reorders the list without removing anything from
    // it. The bound is read from the sentence, so the filter survives a model
    // that substituted an ordering for it.
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', sort: 'price-low', message: 'Cheapest first.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('packages need to be below 100 dollars')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      route: 'packages',
      path: '/packages?priceMax=100&sort=price-low',
    });
  });

  it('leaves a filter extraction cannot read to the model, and adds its own alongside', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'dubai' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('dubai packages under 100')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.body.data.serverResult).toEqual({
      route: 'packages',
      path: '/packages?destination=dubai&priceMax=100',
    });
  });

  it('filters by the destination the visitor named, using the client\u2019s value for it', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'packages' } });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('tell me about dubai packages')],
          availableRoutes: DESTINATION_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    // The visitor said "Dubai"; the URL takes "uae". The client owns that
    // mapping, so the server never has to know it.
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?destination=uae' });
  });

  it('drops a destination the client never declared, rather than shipping a slug that shows everything', async () => {
    // The package list ignores an unknown destination and returns the whole
    // catalogue, so this would otherwise render as an unfiltered page that
    // looks filtered.
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'atlantis' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('show me atlantis packages')],
          availableRoutes: DESTINATION_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages' });
  });

  it('prefers the visitor\u2019s own words over a different destination the model chose', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'indonesia' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('tell me about dubai packages')],
          availableRoutes: DESTINATION_ROUTES,
        }),
      );

    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?destination=uae' });
  });

  it('keeps the model\u2019s destination when the client sent no list to check it against', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'dubai' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('dubai packages')], availableRoutes: FILTER_ROUTES }));

    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?destination=dubai' });
  });

  it('combines a matched destination with a stated price bound', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', sort: 'popularity' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('dubai packages under 1000')],
          availableRoutes: DESTINATION_ROUTES,
        }),
      );

    expect(res.body.data.serverResult).toEqual({
      route: 'packages',
      path: '/packages?destination=uae&priceMax=1000',
    });
  });

  it('overrides a model price bound that contradicts the visitor, preferring the stated one', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', priceMax: 5000 },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('packages under 100')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?priceMax=100' });
  });

  it('sorts instead of filtering when the visitor asks which packages are best', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', sort: 'popularity' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('What are the best performing packages?')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?sort=popularity' });
    // Navigable with no model-authored copy: an empty message would poison
    // every later turn's resent window.
    expect(res.body.data.message).toBe('Sure — heading there now.');
  });

  it('navigates unfiltered when the model sends a filter the offered route never declared', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', rating: 5, message: 'Five-star packages.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Show me five star packages')], availableRoutes: FILTER_ROUTES }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages' });
  });

  it('navigates unfiltered when the offered route declares no filters at all', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'dubai' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Show me Dubai packages')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages' });
  });
});

describe('POST /api/v1/assistant/turn — answer_faq_policy', () => {
  it('quotes the server-retrieved snippet verbatim when the model selects it', async () => {
    mockFetchPolicyDocuments.mockResolvedValue([
      { id: 'doc-1', title: 'Refund Policy', body: 'Cancellations within 30 days of departure are non-refundable except for medical emergencies with documentation.' },
    ]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_faq_policy',
      args: { question: 'Is my trip refundable if I cancel within 30 days?', selectedSnippetIds: ['snippet-0'], message: "Here's what our policy says:" },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Is my trip refundable if I cancel within 30 days?')] }));

    expect(res.body.data.serverResult.answered).toBe(true);
    expect(res.body.data.serverResult.snippets[0].quote).toBe(
      'Cancellations within 30 days of departure are non-refundable except for medical emergencies with documentation.',
    );
    expect(res.body.data.serverResult.snippets[0].docId).toBe('doc-1');
  });

  it('model-authored quote text is discarded even when it selects a valid snippet id', async () => {
    mockFetchPolicyDocuments.mockResolvedValue([
      { id: 'doc-1', title: 'Refund Policy', body: 'Full refunds are issued for cancellations made more than 30 days before departure.' },
    ]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_faq_policy',
      args: { question: 'What is your refund policy for cancellations?', selectedSnippetIds: ['snippet-0'], message: 'We always offer bereavement fare refunds.', quote: 'A fabricated quote the model wrote.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('What is your refund policy for cancellations?')] }));

    expect(res.body.data.serverResult.answered).toBe(true);
    expect(res.body.data.serverResult.snippets[0].quote).toBe(
      'Full refunds are issued for cancellations made more than 30 days before departure.',
    );
    expect(JSON.stringify(res.body.data.serverResult)).not.toContain('fabricated quote');
    expect(JSON.stringify(res.body.data.serverResult)).not.toContain('bereavement');
  });

  it('no matching snippet returns the exact FALLBACK_POLICY_MESSAGE, ignoring the model', async () => {
    mockFetchPolicyDocuments.mockResolvedValue([]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_faq_policy',
      args: { question: 'What is your refund policy?', selectedSnippetIds: ['snippet-0'], message: 'Made up policy text the model tried to author.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('What is your refund policy?')] }));

    expect(res.body.data.serverResult.answered).toBe(false);
    expect(res.body.data.serverResult.fallbackMessage).toBe(FALLBACK_POLICY_MESSAGE);
    // The visitor-facing turn text is the server fallback too — the model's
    // authored text never reaches the visitor as policy.
    expect(res.body.data.message).toBe(FALLBACK_POLICY_MESSAGE);
  });
});

describe('POST /api/v1/assistant/turn — conversational outcomes', () => {
  it('returns reviewed server copy for a pure greeting when the rollout flag is enabled', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'greeting', message: 'Untrusted model copy' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Hello')] }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      toolCall: {
        tool: 'respond_conversationally',
        args: { mode: 'social', socialSubtype: 'greeting' },
      },
      serverResult: { mode: 'social', source: 'resolver' },
      message: 'Hi! I can help you explore destinations, find packages, build a custom trip with AI, or answer LushWare policy questions.',
    });
    expect(res.body.data.message).not.toContain('Untrusted');
    // Two attempts, and both inside what is left of the turn: the resolver's
    // occasional runaway answer is a sampling artefact, so a second draw is worth
    // its latency, but never past the caller's own deadline.
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 2,
        timeoutMs: expect.any(Number),
        deadlineMs: expect.any(Number),
      }),
    );
  });

  it('answers a capability question with server-owned copy, discarding model text', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'capability', message: 'Untrusted model copy' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('What can you do?')] }));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      toolCall: { tool: 'respond_conversationally', args: { mode: 'capability' } },
      serverResult: { mode: 'capability', source: 'resolver' },
    });
    expect(res.body.data.message).toContain('take you to any page');
    expect(res.body.data.message).not.toContain('Untrusted');
    // No planner on this client, so no custom-trip promise: what the assistant
    // may offer is what this turn actually registered.
    expect(res.body.data.message).not.toContain('take you to the planner');
  });

  it('names the custom-trip routes only when the client offered them', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'capability' },
    });

    const offered = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ availableRoutes: CUSTOM_TRIP_ROUTES }));
    const withheld = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Hello')] }));

    expect(offered.body.data.message).toContain('take you to the planner');
    expect(offered.body.data.message).toContain('customization page, where you tailor that trip');
    expect(withheld.body.data.message).not.toContain('take you to the planner');
    expect(withheld.body.data.message).not.toContain('customization page');
  });

  it.each([
    ['thanks', "You're welcome! If you need anything else for your trip, just ask."],
    ['farewell', 'Safe travels! Come back anytime you need help planning your trip.'],
  ])('maps the %s subtype to its reviewed server copy', async (socialSubtype, expectedMessage) => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Social message')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.args.socialSubtype).toBe(socialSubtype);
    expect(res.body.data.message).toBe(expectedMessage);
  });

  it('returns the reviewed warm redirect and discards model-authored args', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'redirect_off_topic',
      args: { message: 'Go away', route: 'refunds' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Write me a sorting algorithm')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall).toEqual({ tool: 'redirect_off_topic', args: {} });
    expect(res.body.data.serverResult).toEqual({ redirected: true, source: 'resolver' });
    expect(res.body.data.message).toContain('help with travel and LushWare trips');
    expect(res.body.data.message).not.toContain('Go away');
  });

  it('degrades new model tools to the legacy policy fallback while the rollout flag is disabled', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'greeting' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Hello')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('answer_faq_policy');
    expect(res.body.data.message).toBe(FALLBACK_POLICY_MESSAGE);
  });

  it('maps malformed recognized-tool args to a canonical safe response', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'unknown', message: 'Anything.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Can you clarify?')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.args).toEqual({ mode: 'social', socialSubtype: 'repair' });
    expect(res.body.data.message).toContain("Tell me what you're trying to do");
  });

  it('delivers low-risk travel copy when the router did not run', async () => {
    // The reported failure: the router is flag-gated and rate-limited, and when
    // it did not answer at all, the hint was null — which was read as "not
    // travel" and rewritten into "tell me what you're trying to do". An absent
    // hint is not a disagreement; a hint that says something else still is.
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'travel_general', message: 'Shoulder season means fewer crowds on the same routes.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Tell me what are the trending locations')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.args.mode).toBe('travel_general');
    expect(res.body.data.serverResult).toEqual({ mode: 'travel_general', source: 'resolver' });
    expect(res.body.data.message).toBe('Shoulder season means fewer crowds on the same routes.');
  });

  it('refuses a travel answer that cites the sensitive surface', async () => {
    // The router is what normally classifies such a turn as sensitive, and this
    // branch is now reachable while the router is unavailable — which is the
    // default in this suite. So the claim is caught in the prose itself: a visa
    // or health assertion must not reach a visitor just because the safety
    // classifier happened to be down.
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'travel_general', message: 'A visa is guaranteed.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Tell me something about travel')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.message).not.toContain('visa is guaranteed');
    expect(res.body.data.message).toContain('visas, entry requirements, health');
    expect(res.body.data.serverResult).toEqual({ mode: 'social', source: 'resolver' });
  });
});

describe('POST /api/v1/assistant/turn — request validation', () => {
  it('rejects a body with no sessionId with a 400 by Zod', async () => {
    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send({
        messages: [assistantMsg('Show me the packages')],
        availableRoutes: AVAILABLE_ROUTES,
      });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('rejects an empty messages array with a 400 by Zod', async () => {
    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [] }));

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('rejects a messages array longer than 20 with a 400 by Zod', async () => {
    const messages = Array.from({ length: 21 }, (_, i) => assistantMsg(`message number ${i}`));
    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages }));

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/assistant/turn — model tool-contract enforcement', () => {
  it('rejects model output outside the fixed tool vocabulary with a 502 and never dispatches', async () => {
    // The Gemini JSON schema constrains generation, but the Zod safeParse is
    // the enforcement boundary: an out-of-vocabulary tool must fail the turn
    // rather than fall through to the switch default or execute anything.
    mockGenerateStructured.mockResolvedValue({
      tool: 'send_email',
      args: { recipient: 'visitor@example.com', body: 'You won!' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Email me the refund policy')] }));

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('AI response did not match the tool contract');
    expect(res.body.serverResult).toBeUndefined();
    expect(mockPrisma.assistantEvent.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        turnId: 'm-Email me the refund policy',
        eventType: 'resolution',
        tool: null,
        route: null,
        metadata: expect.objectContaining({
          failureCategory: 'schema',
          fallbackUsed: false,
          stageTwoLatencyMs: expect.any(Number),
        }),
      },
    });
  });

});

describe('POST /api/v1/assistant/turn — never-empty / never-oversized message guarantee', () => {
  it('falls back to a tool-appropriate default when the model omits args.message for a resolved navigate', async () => {
    // The response JSON schema has no `required` list inside `args` (see
    // assistantTurn.v1.js), so the model can legally omit `message` even
    // though the prompt asks for one. An empty message would poison the
    // client's resent sliding window on every later turn (/ship red-team).
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Show me packages')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Sure — heading there now.');
  });

  it('falls back to a tool-appropriate lead-in when the model omits args.message for a matched FAQ answer', async () => {
    mockFetchPolicyDocuments.mockResolvedValue([
      { id: 'doc-1', title: 'Refund Policy', body: 'Cancellations within 30 days of departure are non-refundable except for medical emergencies with documentation.' },
    ]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_faq_policy',
      args: { question: 'Is my trip refundable if I cancel within 30 days?', selectedSnippetIds: ['snippet-0'] },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Is my trip refundable if I cancel within 30 days?')] }));

    expect(res.status).toBe(200);
    // Never the generic "didn't catch that" apology sitting above a real
    // answer — that was a contradiction the model-message-missing path used
    // to produce (found in /ship's Claude adversarial review).
    expect(res.body.data.message).toBe("Here's what I found:");
    expect(res.body.data.serverResult.answered).toBe(true);
  });

  it('clamps an oversized model message to the wire schema max instead of letting it brick the session', async () => {
    // args is an open z.record with no length cap, and Gemini's 1024+ token
    // budget makes a >2000-char reply reachable — the exact mirror of the
    // empty-message brick (/ship red-team + Claude adversarial review).
    const oversized = 'x'.repeat(2500);
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'refunds', message: oversized },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Take me to the refund page')] }));

    expect(res.status).toBe(200);
    // Declined route always uses the fixed message regardless of what the
    // model sent — pick an offered route instead to prove the clamp itself.
    expect(res.body.data.message.length).toBeLessThanOrEqual(2000);
  });

  it('clamps an oversized model message on a resolved navigate to exactly 2000 chars', async () => {
    const oversized = 'y'.repeat(2500);
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', message: oversized },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('Show me packages')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(oversized.slice(0, 2000));
    expect(res.body.data.message.length).toBe(2000);
  });
});

describe('POST /api/v1/assistant/turn — answering about packages', () => {
  const CATALOGUE = [
    {
      id: 'p-japan',
      title: 'Japan Cultural Journey',
      destination: 'Japan',
      durationDays: 9,
      category: 'FAMILY',
      price: 4485,
      currency: 'USD',
      rating: 4.7,
      numReviews: 16,
      description: 'Nine days of temples.',
    },
    {
      id: 'p-dubai',
      title: 'Dubai Luxury Experience',
      destination: 'Dubai, UAE',
      durationDays: 4,
      category: 'COUPLE',
      price: 663,
      currency: 'USD',
      rating: 4.8,
      numReviews: 16,
      description: 'Four days of opulence.',
    },
  ];

  const ask = (content) => baseBody({ messages: [assistantMsg(content)] });

  it('answers from the records, keeping prose whose every number resolves to one', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: {
        packageIds: ['p-japan'],
        message: 'The Japan Cultural Journey runs 9 days and starts at 4485.',
      },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('the cultural journey package, tell me about it'));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('answer_packages');
    expect(res.body.data.message).toBe('The Japan Cultural Journey runs 9 days and starts at 4485.');
    expect(res.body.data.serverResult.packages).toEqual([
      {
        id: 'p-japan',
        title: 'Japan Cultural Journey',
        destination: 'Japan',
        durationDays: 9,
        price: 4485,
        currency: 'USD',
        rating: 4.7,
        numReviews: 16,
      },
    ]);
  });

  it('replaces prose stating a number no record supports, and still returns the records', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'It costs 999 dollars.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('how much is the cultural journey'));

    expect(res.status).toBe(200);
    // A price the visitor can read must come from a record. The card carries
    // the figures, so the sentence only points at it — the old fallback recited
    // the whole summary, which re-told the visitor what they had already read.
    expect(res.body.data.message).toBe('Japan Cultural Journey — the details are below.');
    expect(res.body.data.serverResult.present).toBe(true);
    expect(res.body.data.serverResult.packages).toHaveLength(1);
  });

  it('presents a package the visitor has not seen yet, with no flag from the model', async () => {
    // The deterministic half of the presentation rule, and the common case: the
    // server knows this package has never been drawn, so the card appears
    // whether or not the model thought to ask for it.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'It runs for nine days.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('tell me about the cultural journey'));

    expect(res.body.data.serverResult.present).toBe(true);
  });

  it('does not draw the card again for a package the visitor has already been shown', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'It is 4485.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('how about prices')], shownPackageIds: ['p-japan'] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.present).toBe(false);
    // The records still travel: they are what the answer was grounded in, and
    // they are what the client would draw if this turn had asked to present.
    expect(res.body.data.serverResult.packages).toHaveLength(1);
    expect(res.body.data.message).toBe('It is 4485.');
  });

  it('draws the card again when the visitor asks to see the package', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'Here it is.', present: true },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('show me it')], shownPackageIds: ['p-japan'] }));

    expect(res.body.data.serverResult.present).toBe(true);
    expect(res.body.data.message).toBe('Here it is.');
  });

  it('points at the details rather than reciting them when several packages are cited', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan', 'p-dubai'], message: 'They cost 999 and 888.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('compare the japan and dubai trips'));

    expect(res.body.data.message).toBe('Here are the details.');
    expect(res.body.data.serverResult.present).toBe(true);
    expect(res.body.data.serverResult.packages).toHaveLength(2);
  });

  it('reads the detail for the conversation\u2019s subject when the message names nothing', async () => {
    // The reported failure: a follow-up never repeats the title, so resolving
    // from the current message alone found nothing and the detail was never
    // fetched — leaving the assistant to truthfully report it had no day-by-day
    // outline, while the endpoint had one all along.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadPackageDetail.mockResolvedValue({
      title: 'Japan Cultural Journey',
      description: 'Nine days of temples.',
      inclusions: ['Hotels', 'Rail pass'],
      exclusions: ['Flights'],
      itinerary: [{ dayNumber: 1, title: 'Arrival in Tokyo' }],
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'It starts in Tokyo.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('tell me more about it')], shownPackageIds: ['p-japan'] }));

    expect(res.status).toBe(200);
    expect(mockLoadPackageDetail).toHaveBeenCalledWith('p-japan', expect.anything());
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('day by day') }),
    );
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('Arrival in Tokyo') }),
    );
  });

  it('prefers a package named in the message over the one last shown', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadPackageDetail.mockResolvedValue({
      title: 'Dubai Luxury Experience',
      inclusions: [],
      exclusions: [],
      itinerary: [],
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-dubai'], message: 'Four days.' },
    });

    await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('tell me more about the dubai luxury experience')],
          shownPackageIds: ['p-japan'],
        }),
      );

    expect(mockLoadPackageDetail).toHaveBeenCalledWith('p-dubai', expect.anything());
  });

  it('reads no detail when nothing names a package and none has been shown', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'packages' } });

    await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('what can you do')] }));

    expect(mockLoadPackageDetail).not.toHaveBeenCalled();
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.not.stringContaining('Detail for') }),
    );
  });

  it.each(['tell me more about it', 'more about days'])(
    'does not redraw the card for a plain request for more information (%s)',
    async (content) => {
      // The card redrew on "tell me more about it" because the prompt offered
      // "more details" as a trigger for it. The model cannot ask for a card any
      // more — presentation is the server's decision — so a flag it still sends
      // changes nothing.
      mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
      mockLoadPackageDetail.mockResolvedValue({ title: 'Japan Cultural Journey' });
      mockGenerateStructured.mockResolvedValue({
        tool: 'answer_packages',
        args: { packageIds: ['p-japan'], message: 'It runs for nine days.', present: true },
      });

      const res = await request(app)
        .post('/api/v1/assistant/turn')
        .send(baseBody({ messages: [assistantMsg(content)], shownPackageIds: ['p-japan'] }));

      expect(res.status).toBe(200);
      expect(res.body.data.serverResult.present).toBe(false);
    },
  );

  it('answers about more than one package, in the order they were cited', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-dubai', 'p-japan'], message: 'Both are worth a look.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('compare the dubai luxury experience and the cultural journey'));

    expect(res.body.data.serverResult.packages.map((pkg) => pkg.id)).toEqual(['p-dubai', 'p-japan']);
    expect(res.body.data.message).toBe('Both are worth a look.');
  });

  it('drops a cited id the catalogue does not contain', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-atlantis', 'p-dubai'], message: 'Here it is.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('show me the atlantis one'));

    expect(res.body.data.serverResult.packages.map((pkg) => pkg.id)).toEqual(['p-dubai']);
  });

  it('falls back rather than inventing an answer when nothing cited exists and no prose was written', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-atlantis'], message: '' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('tell me about atlantis'));

    expect(res.body.data.message).toBe(FALLBACK_POLICY_MESSAGE);
    expect(res.body.data.serverResult).toEqual({ packages: [], present: false });
  });

  it('keeps the prose when nothing could be cited but the prose states no unsupported number', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-atlantis'], message: 'We do not have that destination yet.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('tell me about atlantis'));

    expect(res.body.data.serverResult).toEqual({ packages: [], present: false });
    expect(res.body.data.message).toBe('We do not have that destination yet.');
  });

  it('never points at a card it will not draw when no cited package exists', async () => {
    // The model answered about a package the catalogue does not contain and
    // stated a number the records cannot support. The old path kept the pointer
    // sentence and forced presentation on, so the visitor got "Here are the
    // details." above an empty panel — no records to render, and no fallback
    // line for the client to put there instead.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-atlantis'], message: 'The Atlantis trip costs 3500 for 6 nights.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('tell me about atlantis'));

    expect(res.body.data.serverResult).toEqual({ packages: [], present: false });
    expect(res.body.data.message).toBe(FALLBACK_POLICY_MESSAGE);
    expect(res.body.data.message).not.toContain('details are below');
  });

  it('offers no policy snippets on a turn about a named package, so none can be quoted', async () => {
    // The reported failure: a baggage section containing the word "package"
    // was retrieved for a question about a package, and quoted as the answer.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadPackageDetail.mockResolvedValue({
      title: 'Japan Cultural Journey',
      description: 'Nine days of temples.',
      inclusions: ['Hotels', 'Rail pass'],
      exclusions: ['Flights'],
      itinerary: [{ dayNumber: 1, title: 'Arrival' }],
    });
    mockFetchPolicyDocuments.mockResolvedValue([
      {
        id: 'doc-baggage',
        title: 'Baggage Policy',
        body: 'Every package includes one checked bag up to 23kg and one carry-on bag.',
      },
    ]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_packages',
      args: { packageIds: ['p-japan'], message: 'It includes hotels and a rail pass.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('the cultural journey package, tell me about it'));

    expect(res.status).toBe(200);
    expect(mockFetchPolicyDocuments).not.toHaveBeenCalled();
    expect(res.body.data.toolCall.tool).toBe('answer_packages');
    // The detail read is what makes the answer about the package rather than
    // about the catalogue entry, and it rides in the prompt.
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining('Detail for "Japan Cultural Journey"') }),
    );
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.not.stringContaining('checked bag up to 23kg') }),
    );
  });

  it('still retrieves policy for a turn that names no package', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockFetchPolicyDocuments.mockResolvedValue([
      {
        id: 'doc-refund',
        title: 'Refund Policy',
        body: 'A full refund is available when you cancel more than 30 days before departure.',
      },
    ]);
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_faq_policy',
      args: { question: 'refund', selectedSnippetIds: ['snippet-0'], message: 'Here is the refund rule.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('what is your refund policy if I cancel?'));

    expect(mockFetchPolicyDocuments).toHaveBeenCalled();
    expect(res.body.data.serverResult.answered).toBe(true);
  });

  it('states the count the service reports when navigating to a filterable page', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({ packages: [], total: 0 });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', sort: 'price-low' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('packages need to be below 100 dollars')],
          availableRoutes: FILTER_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      route: 'packages',
      path: '/packages?priceMax=100&sort=price-low',
      total: 0,
    });
    expect(res.body.data.message).toBe('There are 0 packages under $100.');
  });

  it('names every match when the filtered read returns them all', async () => {
    // The count alone told the visitor how many and nothing about which, so the
    // only way to find out was to leave the chat.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({
      packages: [
        { id: 'p-bali', title: 'Bali Honeymoon Bliss' },
        { id: 'p-dubai', title: 'Dubai Luxury Experience' },
      ],
      total: 2,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', priceMax: 1000 },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('packages under 1000')], availableRoutes: FILTER_ROUTES }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.path).toBe('/packages?priceMax=1000');
    expect(res.body.data.serverResult.total).toBe(2);
    expect(res.body.data.message).toBe(
      'There are 2 packages under $1,000: Bali Honeymoon Bliss and Dubai Luxury Experience.',
    );
  });

  it('names the first few and points at the list when more matched than are named', async () => {
    // A partial list presented as the whole answer would be a quiet lie, so the
    // sentence says there are more and the chip is the way to them.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({
      packages: [
        { id: 'p-bali', title: 'Bali Honeymoon Bliss' },
        { id: 'p-srilanka', title: 'Sri Lanka Heritage Explorer' },
        { id: 'p-dubai', title: 'Dubai Luxury Experience' },
      ],
      total: 7,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', priceMax: 1000 },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('packages under 1000')], availableRoutes: FILTER_ROUTES }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.total).toBe(7);
    expect(res.body.data.message).toBe(
      'There are 7 packages under $1,000, including Bali Honeymoon Bliss, Sri Lanka Heritage Explorer and Dubai Luxury Experience. Open the list to see them all.',
    );
  });

  it('never asks for a preview on a route that declares no filters', async () => {
    // No declared filters means no filter vocabulary, so there is no filtered set
    // to count or name — the same rule that has always gated the count.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'destinations' } });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('take me to destinations'));

    expect(res.status).toBe(200);
    expect(mockLoadFilteredPackages).not.toHaveBeenCalled();
    expect(res.body.data.serverResult).toEqual({
      route: 'destinations',
      path: '/destinations-international',
    });
  });

  it('sends a visitor to the customization page of the package they named', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'customize', message: 'Opening it for you.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('i want to customize the japan cultural journey')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    // The model names the route; the id comes from the catalogue the server
    // loaded. A literal ":id" here would be a URL that 404s.
    expect(res.body.data.serverResult).toEqual({
      route: 'customize',
      path: '/package/p-japan/customize',
    });
    expect(res.body.data.message).toBe('Opening the customization page for Japan Cultural Journey.');
  });

  it('sends a visitor to the customization page of the package under discussion', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'customize' } });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('i want my own version of it')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
          shownPackageIds: ['p-dubai'],
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      route: 'customize',
      path: '/package/p-dubai/customize',
    });
  });

  it('asks which package rather than sending a customize link with no package in it', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'customize' } });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('can you customise something for me')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages' });
    expect(res.body.data.message).toContain('Which package would you like to customise?');
  });

  it('answers a place the catalogue does not have honestly, not with everything it has', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({ packages: [], total: 25 });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'tokyo', message: 'We have no Tokyo trips.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('do you have any tokyo packages')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    // "tokyo" is not one of the destinations the page lists, so the filter is
    // dropped — and a count over the whole catalogue would then read as an answer
    // about Tokyo. That sentence is what this replaces.
    expect(res.body.data.serverResult.path).toBe('/packages');
    expect(res.body.data.message).toContain("I don't have a trip for that place");
    expect(res.body.data.message).not.toContain('There are');
  });

  it('keeps the model clause for a place we cover only as a country, and adds the count', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({
      packages: [
        { id: 'p-japan-a', title: 'Japan Cherry Blossom Trail' },
        { id: 'p-japan', title: 'Japan Cultural Journey' },
      ],
      total: 2,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: {
        route: 'packages',
        destination: 'japan',
        message: 'We have no Tokyo-specific trip.',
      },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('i mean one include tokyo city')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.path).toBe('/packages?destination=japan');
    // The clause was previously discarded outright, so the one sentence that said
    // "not Tokyo" never reached the visitor.
    expect(res.body.data.message.startsWith('We have no Tokyo-specific trip.')).toBe(true);
    expect(res.body.data.message).toContain('Japan Cultural Journey');
  });

  it('drops a model clause stating a number no record supports', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockLoadFilteredPackages.mockResolvedValue({
      packages: [{ id: 'p-japan', title: 'Japan Cultural Journey' }],
      total: 1,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', destination: 'japan', message: 'There are 9 packages waiting.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('packages in japan')],
          availableRoutes: CUSTOM_TRIP_ROUTES,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.message).not.toContain('9 packages');
    expect(res.body.data.message).toContain('Japan Cultural Journey');
  });

  it('leaves the model text in place when no count can be resolved', async () => {
    mockLoadPackageCatalogue.mockResolvedValue([]);
    mockLoadFilteredPackages.mockResolvedValue({ packages: [], total: null });
    mockGenerateStructured.mockResolvedValue({
      tool: 'navigate',
      args: { route: 'packages', message: 'Taking you to the packages page.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('packages under 1000')], availableRoutes: FILTER_ROUTES }));

    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages?priceMax=1000' });
    expect(res.body.data.message).toBe('Taking you to the packages page.');
  });

  it('resolves the turn when the catalogue cannot be read at all', async () => {
    // A package-service outage must not take the assistant with it: no
    // catalogue means no package block, and navigation behaves as before.
    mockLoadPackageCatalogue.mockResolvedValue([]);
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'packages' } });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('show me packages'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ route: 'packages', path: '/packages' });
    expect(mockGenerateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.not.stringContaining('Packages that exist') }),
    );
  });

  it('never answers an actionable turn with the social repair copy', async () => {
    // The transcript's dead end: "can you select me one" answered with "No
    // problem. Tell me what you're trying to do…" — advice to someone who had
    // just said what they wanted.
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: { intent: 'ambiguous', confidence: 0.9, hasActionableClause: true, socialSubtype: 'none' },
      decision: { committed: false, reason: 'resolver_required' },
      version: 'v1',
      model: 'test',
      latencyMs: 5,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'repair' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('can you select me one'));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(
      'I could not pick one for you from that. Tell me a destination, a budget or a trip length and I will show you what matches, or say "packages" to see them all.',
    );
  });

  it('still uses the repair copy when the turn carried nothing to act on', async () => {
    process.env.ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = 'true';
    mockClassifyAssistantIntent.mockResolvedValue({
      classification: { intent: 'ambiguous', confidence: 0.4, hasActionableClause: false, socialSubtype: 'repair' },
      decision: { committed: false, reason: 'resolver_required' },
      version: 'v1',
      model: 'test',
      latencyMs: 5,
    });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'repair' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('hmm'));

    expect(res.body.data.message).toBe(
      "No problem. Tell me what you're trying to do, and I'll help you find the right travel option or page.",
    );
  });

  it('hands a booking to the package the model cited', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'hand_off',
      args: { kind: 'booking', packageId: 'p-japan', message: 'On the way.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('book the japan one'));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('hand_off');
    expect(res.body.data.serverResult).toEqual({
      handoff: { kind: 'booking', packageId: 'p-japan', title: 'Japan Cultural Journey' },
    });
    expect(res.body.data.message).toBe('I can take you to the booking form for Japan Cultural Journey.');
  });

  it('books the package already under discussion when the visitor only says "book it"', async () => {
    // The conversation's subject, not the current message, decides this: a
    // follow-up almost never repeats the title, and refusing on that would be a
    // dead end at the one point the visitor has clearly decided.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'hand_off',
      args: { kind: 'booking', message: 'On the way.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('book it')], shownPackageIds: ['p-dubai'] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      handoff: { kind: 'booking', packageId: 'p-dubai', title: 'Dubai Luxury Experience' },
    });
  });

  it('refuses to invent a booking that does not exist, and offers a person instead', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'hand_off',
      args: { kind: 'booking', packageId: 'p-does-not-exist', message: 'On the way.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('book something'));

    expect(res.status).toBe(200);
    // An id that is not in the catalogue resolves to nothing rather than to a
    // booking for a package that does not exist.
    expect(res.body.data.serverResult).toEqual({ handoff: { kind: 'human' } });
    expect(res.body.data.message).toContain('call, message on WhatsApp, or send the contact form');
  });

  it('names every channel when the visitor asks for a person', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'hand_off',
      args: { kind: 'human', message: 'Sure.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('can I talk to a person'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({ handoff: { kind: 'human' } });
    // Told where the channels are, not merely that a team exists.
    expect(res.body.data.message).toContain('call, message on WhatsApp, or send the contact form');
  });

  // ── Booking capture ───────────────────────────────────────────────────────
  // A submission is not a form post: booking-service creates a customer account,
  // a lead and a booking, bumps the package's booking count and emails a sales
  // rep. So every case below asserts on WHEN the write happens, not only on what
  // the visitor reads.
  // `messages` is the conversation the store holds, and it matters: the email
  // guard reads the visitor's own turns, so a session that does not contain the
  // address they typed is a session where a booking cannot be sent. That is the
  // point of the guard, and these fixtures reflect a real conversation rather
  // than an empty one.
  const VISITOR_TURNS = [
    { id: 'm1', seq: 1, role: 'user', content: 'book the japan one, ana@example.com, 14 march 2027' },
    { id: 'm1-a', seq: 2, role: 'assistant', content: 'I can send a booking request for Japan Cultural Journey.' },
  ];

  const bookingSession = ({ turnCount = 0, messages = VISITOR_TURNS, ...sessionOverrides } = {}) => ({
    ok: true,
    session: {
      id: 'session-1',
      shownPackageIds: [],
      bookingDraft: {},
      bookingStatus: null,
      bookingId: null,
      bookingAskedTurn: null,
      turnCount,
      ...sessionOverrides,
    },
    messages,
    thisTurn: turnCount + 1,
  });

  const COMPLETE_DRAFT = {
    packageId: 'p-japan',
    packageTitle: 'Japan Cultural Journey',
    email: 'ana@example.com',
    travelDate: '2027-03-14',
    travelers: 2,
  };

  it('asks for what a booking needs instead of sending one', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(bookingSession());
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'On it.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('book the japan one'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking).toEqual({ status: 'needs_details', missing: ['email', 'travelDate'] });
    expect(res.body.data.message).toContain('the email address to confirm it to');
    expect(res.body.data.message).toContain('the travel date');
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
  });

  it('shows the summary and asks for confirmation rather than sending a complete request', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ bookingDraft: { ...COMPLETE_DRAFT, packageTitle: undefined } }),
    );
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Ready.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('book it for ana@example.com on 2027-03-14 for 2'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking.status).toBe('awaiting_confirmation');
    // The date is spelled out because this line is the only place a misread date
    // is visible before the booking service acts on it.
    expect(res.body.data.message).toContain('14 Mar 2027');
    expect(res.body.data.message).toContain('2 travellers');
    expect(res.body.data.message).toContain('ana@example.com');
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
    expect(mockStore.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ bookingStatus: 'awaiting_confirmation' }),
    );
  });

  it('sends the booking on the turn that immediately follows the confirmation question', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 3, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockSubmitWebsiteBooking.mockResolvedValue({ ok: true, bookingId: 'bk-1' });
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Sending.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).toHaveBeenCalledTimes(1);
    expect(mockSubmitWebsiteBooking).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'p-japan', email: 'ana@example.com', travelDate: '2027-03-14', travelers: 2 }),
      expect.anything(),
    );
    expect(res.body.data.serverResult.booking).toEqual({ status: 'submitted', bookingId: 'bk-1' });
    expect(res.body.data.message).toContain('Reference bk-1');
    expect(mockStore.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ bookingStatus: 'submitted', bookingId: 'bk-1' }),
    );
  });

  it('honours its own confirmation even when the model picked another tool', async () => {
    // The audit caught this: asked to answer a bare "yes, send it", the model
    // chose a social reply, and the booking the visitor had already agreed to was
    // lost. The question being answered is the server's, so the server routes the
    // turn to the booking case whatever the model picked.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 3, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockSubmitWebsiteBooking.mockResolvedValue({ ok: true, bookingId: 'bk-2' });
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'repair' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).toHaveBeenCalledTimes(1);
    expect(res.body.data.toolCall.tool).toBe('request_booking');
    expect(res.body.data.serverResult.booking).toEqual({ status: 'submitted', bookingId: 'bk-2' });
  });

  it('answers a repeated yes with the reference even when the model picked another tool', async () => {
    // After a submission there is no open question to anchor to, so a second
    // "yes" is answered from the session's own record rather than by the model —
    // the audit caught it landing on the social repair line and losing the
    // reference the visitor had just been given.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 5, bookingStatus: 'submitted', bookingId: 'bk-1', bookingDraft: COMPLETE_DRAFT }),
    );
    mockGenerateStructured.mockResolvedValue({
      tool: 'respond_conversationally',
      args: { mode: 'social', socialSubtype: 'repair' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
    expect(res.body.data.toolCall.tool).toBe('request_booking');
    expect(res.body.data.message).toContain('bk-1');
  });

  it('re-asks rather than sending when the yes also changes the draft', async () => {
    // "yes, make it 3 travellers" is a NEW draft, and a confirmation is only a
    // confirmation of the summary the visitor read — so this gets a fresh summary
    // to confirm instead of a booking nobody has seen.
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 3, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { travelers: 3, message: 'Sure.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('yes, make it 3 travellers'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
    expect(res.body.data.serverResult.booking.status).toBe('awaiting_confirmation');
    expect(res.body.data.message).toContain('3 travellers');
    // The anchor moves to this turn, so the visitor's next "yes" confirms the
    // summary they are reading now rather than arriving one turn too late.
    expect(mockStore.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ bookingAskedTurn: 4 }),
    );
  });

  it('never sends a booking twice', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 5, bookingStatus: 'submitted', bookingId: 'bk-1', bookingDraft: COMPLETE_DRAFT }),
    );
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Sending again.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
    expect(res.body.data.serverResult.booking).toEqual({ status: 'submitted', bookingId: 'bk-1' });
    expect(res.body.data.message).toContain('bk-1');
  });

  it('re-asks rather than sending when the confirmation was not the next thing the visitor said', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    // Asked on turn 3, and this is turn 5: the "yes" is answering something the
    // visitor has since stopped reading.
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 4, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Okay.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('yes'));

    expect(res.status).toBe(200);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
    expect(res.body.data.serverResult.booking.status).toBe('awaiting_confirmation');
    expect(res.body.data.message).toContain('Reply "yes" and I will send it.');
  });

  it('refuses an email the visitor never typed, however plausible it looks', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    // No session history at all, so nothing the visitor typed contains that
    // address. The model read a full address out of nothing — accepting it would
    // create a customer account and email a sales rep for someone who never
    // asked.
    mockStore.loadSession.mockResolvedValue(bookingSession({ messages: [] }));
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', email: 'ana@example.com', travelDate: '2027-03-14', message: 'Booked.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('book the japan one'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking.missing).toEqual(['email']);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
  });

  it('refuses a travel date in the past', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(bookingSession());
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', email: 'ana@example.com', travelDate: '2020-01-01', message: 'Ready.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('book the japan one, ana@example.com, 1 january 2020'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking.missing).toEqual(['travelDate']);
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
  });

  it('keeps the draft and clears the confirmation when the booking service rejects the request', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 3, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockSubmitWebsiteBooking.mockResolvedValue({ ok: false, reason: 'rejected' });
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Sending.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking).toEqual({ status: 'rejected' });
    expect(mockStore.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ bookingStatus: null, bookingDraft: expect.objectContaining({ email: 'ana@example.com' }) }),
    );
  });

  it('tells the visitor nothing was booked when the booking service cannot be reached', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockStore.loadSession.mockResolvedValue(
      bookingSession({ turnCount: 3, bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 3, bookingDraft: COMPLETE_DRAFT }),
    );
    mockSubmitWebsiteBooking.mockResolvedValue({ ok: false, reason: 'unavailable' });
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', message: 'Sending.' },
    });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('Yes, send it'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking).toEqual({ status: 'unavailable' });
    expect(res.body.data.message).toContain('nothing was booked');
    // The confirmation is kept so "try again" is one turn away, and never marked
    // submitted — nothing was written.
    expect(mockStore.updateSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ bookingStatus: 'awaiting_confirmation', bookingAskedTurn: 4 }),
    );
  });

  it('sends the visitor to the booking form when there is no session to capture into', async () => {
    mockLoadPackageCatalogue.mockResolvedValue(CATALOGUE);
    mockGenerateStructured.mockResolvedValue({
      tool: 'request_booking',
      args: { packageId: 'p-japan', email: 'ana@example.com', travelDate: '2027-03-14', message: 'Ready.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('book the japan one, ana@example.com, 14 march 2027'));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.booking).toEqual({ status: 'unavailable' });
    expect(res.body.data.message).toContain('booking form on the package page');
    expect(mockSubmitWebsiteBooking).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/assistant/turn — page actions', () => {
  const CAPABILITIES = {
    version: 1,
    surface: 'planner',
    actions: [
      'set_destination',
      'set_travellers',
      'set_preferences',
      'set_contact_details',
      'go_to_step',
      'generate_itinerary',
      'regenerate_days',
      'edit_day',
    ],
  };
  const PAGE_CONTEXT = {
    surface: 'planner',
    revision: 'planner',
    step: 3,
    destination: 'Kandy',
    duration: 3,
    days: [{ dayNumber: 1, title: 'Arrival' }],
  };

  const pageBody = (overrides = {}) =>
    baseBody({ capabilities: CAPABILITIES, pageContext: PAGE_CONTEXT, ...overrides });

  // A form is a SURFACE, not an action bolted onto one: the mounted form decides
  // which fields may be written, and the form id is the surface id.
  const FORM_CAPABILITIES = { version: 1, surface: 'contact', actions: ['prefill_form'] };
  const FORM_CONTEXT = { surface: 'contact', revision: 'contact', step: 1 };
  const formBody = (overrides = {}) =>
    baseBody({ capabilities: FORM_CAPABILITIES, pageContext: FORM_CONTEXT, ...overrides });

  it('hands a form fill to the page with the fields the contract validated', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'prefill_form',
      args: { form: 'contact', field_name: 'Ana', field_email: 'ana@example.com', message: 'Filling that in.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(formBody({ messages: [assistantMsg('my name is Ana and my email is ana@example.com')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('prefill_form');
    // The payload names fields and nothing else: no submit flag exists to set,
    // and the page presses no button on the assistant's behalf.
    expect(res.body.data.serverResult).toEqual({
      action: { tool: 'prefill_form', form: 'contact', fields: { name: 'Ana', email: 'ana@example.com' } },
      revision: 'contact',
      surface: 'contact',
    });
  });

  it('drops a field the form does not have, and a value its type rejects, keeping the rest', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'prefill_form',
      args: {
        form: 'contact',
        field_name: 'Ana',
        // Not a contact field at all, and one that belongs to the booking form.
        field_resume: 'cv.pdf',
        field_travelers: 4,
        // Right field, wrong value for its declared type.
        field_email: 'not an email',
        field_message: 'We would like to visit in March.',
        message: 'Filling that in.',
      },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(formBody({ messages: [assistantMsg('here are my details')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.action.fields).toEqual({
      name: 'Ana',
      message: 'We would like to visit in March.',
    });
  });

  it('refuses a fill for a form that is not the one on screen', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'prefill_form',
      args: { form: 'booking', field_email: 'ana@example.com', message: 'Filling that in.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(formBody({ messages: [assistantMsg('ana@example.com')] }));

    expect(res.status).toBe(200);
    // The same treatment an unoffered page action gets: the reviewed capability
    // answer, never a write the page would refuse.
    expect(res.body.data.serverResult.mode).toBe('capability');
    expect(res.body.data.serverResult.action).toBeUndefined();
  });

  it('refuses a fill on a page that has no form at all', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'prefill_form',
      args: { form: 'contact', field_name: 'Ana', message: 'Filling that in.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(pageBody({ messages: [assistantMsg('my name is Ana')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult.mode).toBe('capability');
    expect(res.body.data.serverResult.action).toBeUndefined();
  });

  it('returns the validated action with the page revision it was chosen against', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'edit_day',
      args: { dayNumber: 3, operation: 'add_activities', values: ['whale watching'], message: 'Adding that now.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(pageBody({ messages: [assistantMsg('add whale watching to day 3')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall).toEqual({
      tool: 'edit_day',
      args: { dayNumber: 3, operation: 'add_activities', values: ['whale watching'], message: 'Adding that now.' },
    });
    // The action travels without the model's own line — the client parses it
    // against the shared action contract, which has no `message` on the page
    // fields beyond the reply.
    expect(res.body.data.serverResult).toEqual({
      action: { tool: 'edit_day', dayNumber: 3, operation: 'add_activities', values: ['whale watching'] },
      revision: 'planner',
      surface: 'planner',
    });
    expect(res.body.data.message).toBe('Adding that now.');
  });

  it('has a line of its own for every page action that runs without a model message', async () => {
    // The shared NO_MESSAGE_FALLBACK ("Sorry, I didn't quite catch that") reads as
    // failure next to an action that ran, so every page action needs its own
    // sentence. This is the guard that would have caught the split vocabulary
    // shipping with four tools and no fallbacks.
    const cases = [
      ['set_destination', { destination: 'Kandy' }],
      ['set_travellers', { travelers: 3 }],
      ['set_preferences', { preferences: 'slow pace' }],
      ['set_contact_details', { field: 'email', value: 'ana@example.com' }],
      ['go_to_step', { step: 2 }],
      ['generate_itinerary', {}],
      ['regenerate_days', { dayNumbers: [1] }],
      ['edit_day', { dayNumber: 1, operation: 'set_title', values: ['Arrival'] }],
    ];

    for (const [tool, args] of cases) {
      mockGenerateStructured.mockResolvedValue({ tool, args });

      const res = await request(app)
        .post('/api/v1/assistant/turn')
        .send(pageBody({ messages: [assistantMsg(`${tool} please`)] }));

      expect(res.status, `${tool} should dispatch`).toBe(200);
      expect(res.body.data.message, `${tool} needs its own line`).not.toContain('quite catch that');
      expect(res.body.data.message.length).toBeGreaterThan(0);
    }
  });

  it('dispatches every one of the page actions the browser can register', async () => {
    // One case per name in ASSISTANT_PAGE_ACTIONS: an action with no `switch`
    // case falls to the default and answers 502, which is exactly what happened
    // when this vocabulary was split and four names were added without cases.
    const cases = [
      ['set_destination', { destination: 'Kandy' }],
      ['set_travellers', { travelers: 3 }],
      ['set_preferences', { preferences: 'slow pace' }],
      ['set_contact_details', { field: 'email', value: 'ana@example.com' }],
      ['go_to_step', { step: 2 }],
      ['generate_itinerary', {}],
      ['regenerate_days', { dayNumbers: [1] }],
      ['edit_day', { dayNumber: 1, operation: 'set_title', values: ['Arrival'] }],
    ];

    for (const [tool, args] of cases) {
      mockGenerateStructured.mockResolvedValue({ tool, args: { ...args, message: 'On it.' } });

      const res = await request(app)
        .post('/api/v1/assistant/turn')
        .send(pageBody({ messages: [assistantMsg(`${tool} please`)] }));

      expect(res.status, `${tool} should dispatch`).toBe(200);
      expect(res.body.data.serverResult.action.tool).toBe(tool);
      expect(res.body.data.serverResult.revision).toBe('planner');
    }
  });

  it('has a dispatch case for every core outcome, so none reaches the 502 default', async () => {
    // The guard this exists for: a tool in CORE_ASSISTANT_TOOLS with no `switch`
    // case falls to the default and the visitor gets a 502 for a turn the model
    // answered correctly. The page-action cases above prove their own names; this
    // covers the rest of the core set, including `answer_current_view`, whose
    // sentence the server composes.
    const cases = [
      ['navigate', { route: 'packages' }],
      ['answer_faq_policy', { question: 'refund', selectedSnippetIds: [] }],
      ['answer_packages', { packageIds: [] }],
      ['hand_off', { kind: 'human' }],
      ['request_booking', {}],
      ['answer_current_view', {}],
    ];

    for (const [tool, args] of cases) {
      mockGenerateStructured.mockResolvedValue({ tool, args: { ...args, message: 'On it.' } });

      const res = await request(app)
        .post('/api/v1/assistant/turn')
        .send(baseBody({ messages: [assistantMsg(`${tool} please`)] }));

      expect(res.status, `${tool} should dispatch`).toBe(200);
    }
  });

  it('drops a day the trip does not have before the page ever sees it', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'regenerate_days',
      args: { dayNumbers: [2, 31], message: 'Redoing those.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(pageBody({ messages: [assistantMsg('redo days 2 and 31')] }));

    expect(res.body.data.serverResult.action).toEqual({ tool: 'regenerate_days', dayNumbers: [2] });
  });

  it('answers a page action that carries no model message with its own line', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'generate_itinerary', args: {} });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(pageBody({ messages: [assistantMsg('build the itinerary')] }));

    expect(res.body.data.message).toBe('Building your day-by-day plan.');
    expect(res.body.data.serverResult.action).toEqual({ tool: 'generate_itinerary' });
  });

  it('refuses a page action the browser did not register, answering with capability copy', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'generate_itinerary',
      args: { message: 'Building it.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('build the itinerary')],
          capabilities: { version: 1, surface: 'planner', actions: [] },
          pageContext: PAGE_CONTEXT,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall).toEqual({
      tool: 'respond_conversationally',
      args: { mode: 'capability' },
    });
    expect(res.body.data.serverResult).toEqual({ mode: 'capability', source: 'resolver' });
    expect(res.body.data.message).not.toContain('Building it.');
  });

  it('refuses a page action reported against a different surface than the capabilities', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'edit_day',
      args: { dayNumber: 1, operation: 'set_title', values: ['Arrival'], message: 'Updating.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        baseBody({
          messages: [assistantMsg('change day 1')],
          capabilities: CAPABILITIES,
          pageContext: { ...PAGE_CONTEXT, surface: 'customize', revision: 'customize:p1' },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('respond_conversationally');
    expect(res.body.data.message).not.toContain('Updating.');
  });

  it('does not offer a page action when the client sends no manifest at all', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'navigate', args: { route: 'packages', message: 'Here.' } });

    const res = await request(app).post('/api/v1/assistant/turn').send(baseBody());

    expect(res.status).toBe(200);
    // The prompt's enum is the contract; the assertion here is that a turn with
    // no manifest is still an ordinary turn.
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    expect(res.body.data.toolCall.tool).toBe('navigate');
  });
});

describe('POST /api/v1/assistant/turn — grounded travel search', () => {
  const searchTurn = (message) => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'search_travel_info',
      args: { query: 'best time to visit Kandy', message: 'Looking that up.' },
    });
    return request(app).post('/api/v1/assistant/turn').send(baseBody({ messages: [assistantMsg(message)] }));
  };

  it('answers a travel question from the search, with its sources and the advisory line', async () => {
    mockGenerateGrounded.mockResolvedValue({
      text: 'December to March is the driest stretch.',
      citations: [{ title: 'example.com', uri: 'https://example.com/kandy-weather' }],
    });

    const res = await searchTurn('what is the best time of year to visit Kandy');

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toEqual({
      searched: true,
      query: 'best time to visit Kandy',
      citations: [{ title: 'example.com', uri: 'https://example.com/kandy-weather' }],
    });
    expect(res.body.data.message).toContain('December to March is the driest stretch.');
    expect(res.body.data.message).toContain("Check your government's official travel advisory");
    // The model's own line never states anything about conditions.
    expect(res.body.data.message).not.toContain('Looking that up');
  });

  it('refuses a query outside the travel domain without searching', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'search_travel_info',
      args: { query: 'write me a python script for that' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(baseBody({ messages: [assistantMsg('write me a python script for that')] }));

    expect(res.status).toBe(200);
    expect(res.body.data.serverResult).toBeNull();
    expect(res.body.data.message).toContain('I only look up travel information');
    expect(mockGenerateGrounded).not.toHaveBeenCalled();
  });

  it('does not search when the deployment switched grounded search off', async () => {
    process.env.ASSISTANT_TRAVEL_SEARCH_ENABLED = 'false';

    const res = await searchTurn('what is the best time of year to visit Kandy');

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('I cannot search the web in this chat right now');
    expect(mockGenerateGrounded).not.toHaveBeenCalled();
  });

  it('degrades to copy when the search itself fails, never to the model\u2019s own prose', async () => {
    mockGenerateGrounded.mockRejectedValue(new Error('provider down'));

    const res = await searchTurn('what is the best time of year to visit Kandy');

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('The web lookup did not go through just now');
    expect(res.body.data.message).not.toContain('Looking that up');
    expect(res.body.data.serverResult).toBeNull();
  });
});

describe('POST /api/v1/assistant/turn — the view answer', () => {
  const ask = (content, overrides = {}) => baseBody({ messages: [assistantMsg(content)], ...overrides });

  const PACKAGES_ROUTE = { name: 'packages', path: '/packages', params: ['destination', 'priceMax'] };

  it('composes the count from the page\u2019s own report, and relays that report back', async () => {
    mockGenerateStructured.mockResolvedValue({
      tool: 'answer_current_view',
      args: { message: 'There are 25 packages.' },
    });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        ask('how many are showing under 1500', {
          availableRoutes: [PACKAGES_ROUTE],
          currentView: {
            path: '/packages',
            params: { destination: 'uae', priceMax: '1500' },
            filteredCount: 3,
            renderedCount: 2,
            catalogueTotal: 25,
          },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.data.toolCall.tool).toBe('answer_current_view');
    expect(res.body.data.message).toBe('There are 3 trips matching the filters on this page. 2 are shown so far.');
    // The model's own sentence named a number the page never reported, and the
    // screen is the one thing the visitor can check in a second.
    expect(res.body.data.message).not.toContain('25');
    expect(res.body.data.serverResult.view.filteredCount).toBe(3);
  });

  it('says it cannot see the page rather than guessing when nothing was reported', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'answer_current_view', args: {} });

    const res = await request(app).post('/api/v1/assistant/turn').send(ask('what am I looking at?'));

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe(
      "I can't see the page you're on right now. Tell me what you're looking for and I'll help you find it.",
    );
    expect(res.body.data.serverResult.view).toBeNull();
  });

  it('names the page and says so when the page could not count', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'answer_current_view', args: {} });

    const res = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('how many are showing?', { currentView: { path: '/packages' } }));

    expect(res.body.data.message).toBe(
      "You're on /packages, but it hasn't told me how many results are showing. Ask me about the catalogue and I'll look it up.",
    );
  });

  it('drops the qualifier when the page drew everything it counted, and keeps the singular for one', async () => {
    mockGenerateStructured.mockResolvedValue({ tool: 'answer_current_view', args: {} });

    const all = await request(app)
      .post('/api/v1/assistant/turn')
      .send(ask('how many?', { currentView: { path: '/packages', filteredCount: 3, renderedCount: 3 } }));
    expect(all.body.data.message).toBe('There are 3 trips on this page.');

    const one = await request(app)
      .post('/api/v1/assistant/turn')
      .send(
        ask('how many?', {
          currentView: { path: '/packages', params: { destination: 'japan' }, filteredCount: 1, renderedCount: 1 },
        }),
      );
    expect(one.body.data.message).toBe('There is 1 trip matching the filters on this page.');
  });
});

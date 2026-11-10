import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const { mockGenerateStructured, mockPrisma } = vi.hoisted(() => ({
  mockGenerateStructured: vi.fn(),
  mockPrisma: {
    package: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    activityCatalog: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../../ai/geminiClient.js', () => ({
  generateStructured: mockGenerateStructured,
  isAIConfigured: vi.fn(() => true),
}));

// app.js pulls in package.routes.js → db/client.js, which constructs a real
// PrismaClient at import time; mock it so this suite doesn't need DATABASE_URL.
vi.mock('../../db/client.js', () => ({ default: mockPrisma }));

const { default: serviceApp } = await import('../../app.js');
const { default: express } = await import('express');

const TEST_AGENCY = '11111111-1111-4111-8111-111111111111';
// Requests reach the service with the agency the gateway took from the login.
const app = express().use((req, _res, next) => {
  req.headers['x-tenant-id'] ??= TEST_AGENCY;
  next();
}, serviceApp);

function authHeaders() {
  return {
    'x-user-id': 'agent-1',
    'x-user-role': 'admin',
    'x-user-email': 'agent@test.com',
    'x-user-name': 'Test Agent',
    'x-user-permissions': '[]',
    'x-user-is-super-admin': 'false',
  };
}

const generatedPackage = {
  title: 'Bali Beach Escape',
  description: 'A relaxing beach getaway.',
  destination: 'Bali',
  durationDays: 2,
  price: 800,
  category: 'FAMILY',
  inclusions: ['Hotel'],
  exclusions: ['Flights'],
  days: [
    { dayNumber: 1, title: 'Arrival', locations: ['Denpasar'], activities: ['Beach Walk'], meals: { dinner: true }, transport: 'car' },
    { dayNumber: 2, title: 'Snorkeling', locations: ['Nusa Dua'], activities: ['Snorkeling Tour'], meals: { breakfast: true }, transport: 'boat' },
  ],
};

function mockedCreatedPackage(overrides = {}) {
  return {
    id: 'pkg-ai-1',
    title: generatedPackage.title,
    slug: 'bali-beach-escape-123',
    description: generatedPackage.description,
    destination: 'Bali',
    durationDays: 2,
    category: 'FAMILY',
    coverImage: null,
    inclusions: ['Hotel'],
    exclusions: ['Flights'],
    termsAndConditions: '',
    basePrice: 800,
    defaultMarginType: 'PERCENTAGE',
    defaultMarginInput: 20,
    currency: 'USD',
    isActive: false,
    isFeatured: false,
    rating: 0,
    numReviews: 0,
    views: 0,
    bookings: 0,
    createdBy: 'agent-1',
    images: [],
    itineraryDays: [
      {
        dayNumber: 1,
        title: 'Arrival',
        breakfastCount: 0,
        lunchCount: 0,
        dinnerCount: 1,
        places: [{ id: 'dp-1', placeId: null, customName: 'Denpasar', orderIndex: 0 }],
        activities: [{ id: 'da-1', activityId: 'act-1', activity: { id: 'act-1', name: 'Beach Walk', description: null, defaultCost: 0 }, costOverride: null, orderIndex: 0 }],
        transports: [{ id: 'dt-1', routeType: 'DAILY_ROUTING', transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 0, distanceKm: null, originPlaceId: null, destinationPlaceId: null }],
      },
    ],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('POST /api/v1/packages/generate-ai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.activityCatalog.findUnique.mockResolvedValue(null);
    mockPrisma.activityCatalog.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `act-${data.name}`, name: data.name, defaultCost: data.defaultCost ?? 0 })
    );
  });

  it('persists the AI-generated package with activity names resolved, not dropped', async () => {
    mockGenerateStructured.mockResolvedValue(generatedPackage);
    mockPrisma.package.create.mockResolvedValue(mockedCreatedPackage());

    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 2, category: 'family', packageType: 'Deluxe', description: 'water sports please' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.itineraryDays[0].activities[0].activity.name).toBe('Beach Walk');

    // Verify the free-text "description" field from the dialog actually reached the prompt.
    const promptArg = mockGenerateStructured.mock.calls[0][0].prompt;
    expect(promptArg).toContain('water sports please');
    expect(promptArg).toContain('Deluxe');

    // Verify the create payload routed activities through catalog resolution (activityId), not a bare `name`.
    const createArg = mockPrisma.package.create.mock.calls[0][0];
    const day1Activities = createArg.data.itineraryDays.create[0].activities.create;
    expect(day1Activities[0]).toEqual({ activityId: 'act-Beach Walk', costOverride: null, orderIndex: 0 });
  });

  it('scales the token budget with duration instead of using a fixed cap that truncates long itineraries', async () => {
    mockGenerateStructured.mockResolvedValue({ ...generatedPackage, durationDays: 20, days: generatedPackage.days });
    mockPrisma.package.create.mockResolvedValue(mockedCreatedPackage());

    await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 20 });

    const { maxOutputTokens } = mockGenerateStructured.mock.calls[0][0];
    expect(maxOutputTokens).toBe(1500 + 20 * 700);
    expect(maxOutputTokens).toBeGreaterThan(8192); // the old fixed cap that caused the truncation bug
  });

  it('pads the itinerary to exactly the requested duration when the model returns fewer days', async () => {
    mockGenerateStructured.mockResolvedValue({ ...generatedPackage, days: [generatedPackage.days[0]] });
    mockPrisma.package.create.mockResolvedValue(mockedCreatedPackage());

    await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 2 });

    const createArg = mockPrisma.package.create.mock.calls[0][0];
    expect(createArg.data.itineraryDays.create).toHaveLength(2);
  });

  it('returns 400 when destination is missing', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ duration: 3 });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 400 when duration exceeds the sanity cap', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 400 });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI client reports it is not configured', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI generation is not configured'), { statusCode: 503 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(503);
    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 502 and never touches the database when the model output fails schema/JSON validation', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI did not return valid JSON'), { statusCode: 502 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .set(authHeaders())
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(502);
    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-ai')
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(401);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/packages/generate-from-title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns AI-generated marketing content without touching the database', async () => {
    mockGenerateStructured.mockResolvedValue({
      description: 'Great trip', highlights: ['Sunsets'], inclusions: ['Hotel'], exclusions: ['Flights'], termsAndConditions: 'Pay in full',
    });

    const res = await request(app)
      .post('/api/v1/packages/generate-from-title')
      .set(authHeaders())
      .send({ title: 'Sunset Getaway', destination: 'Bali', duration: 3, category: 'family' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Great trip');
    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-from-title')
      .set(authHeaders())
      .send({ destination: 'Bali' });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/packages/generate-itinerary-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const previewDays = [
    { dayNumber: 1, title: 'Arrival', locations: ['Denpasar'], activities: ['Beach Walk'], meals: { dinner: true }, transport: 'car' },
    { dayNumber: 2, title: 'Snorkeling', locations: ['Nusa Dua'], activities: ['Snorkeling Tour'], meals: { breakfast: true }, transport: 'boat' },
  ];

  it('returns 200 with days on success, with no Authorization header (genuinely public)', async () => {
    mockGenerateStructured.mockResolvedValue({ days: previewDays });

    const res = await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.days).toHaveLength(2);
    expect(res.body.data.days[0].locations).toEqual(['Denpasar']);
  });

  it('never persists — package.create is never called', async () => {
    mockGenerateStructured.mockResolvedValue({ days: previewDays });

    await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ destination: 'Bali', duration: 2 });

    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('pads to exactly duration days when the model returns fewer', async () => {
    mockGenerateStructured.mockResolvedValue({ days: [previewDays[0]] });

    const res = await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(2);
    expect(res.body.data.days[1]).toMatchObject({ dayNumber: 2, title: 'Day 2' });
  });

  it('returns 400 when destination is missing', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ duration: 2 });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI client reports it is not configured', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI generation is not configured'), { statusCode: 503 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(503);
    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 502 when the model output fails schema/JSON validation', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI did not return valid JSON'), { statusCode: 502 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-itinerary-preview')
      .send({ destination: 'Bali', duration: 2 });

    expect(res.status).toBe(502);
    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/packages/itinerary-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with reply/slots/readyToGenerate: true, with no Authorization header (genuinely public)', async () => {
    mockGenerateStructured.mockResolvedValue({ reply: 'Great, a 3-day Kandy trip!', slots: { destination: 'Kandy', duration: 3 } });

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'I want a 3 day trip to Kandy' }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      reply: 'Great, a 3-day Kandy trip!',
      slots: { destination: 'Kandy', duration: 3 },
      readyToGenerate: true,
    });
  });

  it('returns readyToGenerate: false when only destination is known (no duration)', async () => {
    mockGenerateStructured.mockResolvedValue({ reply: 'How long is your trip?', slots: { destination: 'Kandy' } });

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'I want to go to Kandy' }] });

    expect(res.body.data.readyToGenerate).toBe(false);
  });

  it('merges with previously-known slots from the request body', async () => {
    mockGenerateStructured.mockResolvedValue({ reply: 'Great, 3 days it is!', slots: { duration: 3 } });

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: '3 days' }], slots: { destination: 'Kandy' } });

    expect(res.body.data.slots).toEqual({ destination: 'Kandy', duration: 3 });
    expect(res.body.data.readyToGenerate).toBe(true);
  });

  it('drops an out-of-range duration from the model', async () => {
    mockGenerateStructured.mockResolvedValue({ reply: 'Got it!', slots: { destination: 'Kandy', duration: 45 } });

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'A very long trip to Kandy' }] });

    expect(res.body.data.slots).toEqual({ destination: 'Kandy' });
    expect(res.body.data.readyToGenerate).toBe(false);
  });

  it('never persists — package.create is never called', async () => {
    mockGenerateStructured.mockResolvedValue({ reply: 'Great!', slots: { destination: 'Kandy', duration: 3 } });

    await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'Kandy, 3 days' }] });

    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 400 when messages: []', async () => {
    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [] });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI client reports it is not configured', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI generation is not configured'), { statusCode: 503 }));

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'Kandy, 3 days' }] });

    expect(res.status).toBe(503);
  });

  it('returns 502 when the model output fails schema/JSON validation', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI did not return valid JSON'), { statusCode: 502 }));

    const res = await request(app)
      .post('/api/v1/packages/itinerary-chat')
      .send({ messages: [{ role: 'user', content: 'Kandy, 3 days' }] });

    expect(res.status).toBe(502);
  });
});

describe('POST /api/v1/packages/generate-day-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const aiDay = { dayNumber: 3, title: 'Waterfalls', locations: ['Tegenungan Waterfall'], activities: ['Waterfall hike'], meals: { lunch: true }, transport: 'car' };

  it('returns 200 with a single day on success, with no Authorization header (genuinely public)', async () => {
    mockGenerateStructured.mockResolvedValue({ day: aiDay });

    const res = await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', dayNumber: 3, totalDuration: 7 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.day).toMatchObject({ dayNumber: 3, title: 'Waterfalls', locations: ['Tegenungan Waterfall'] });
  });

  it('forces dayNumber to the requested value even when the model returns a different one', async () => {
    mockGenerateStructured.mockResolvedValue({ day: { ...aiDay, dayNumber: 99 } });

    const res = await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', dayNumber: 3, totalDuration: 7 });

    expect(res.body.data.day.dayNumber).toBe(3);
  });

  it('excludes the target day from the existingDays context sent to the prompt, even if the client includes it', async () => {
    mockGenerateStructured.mockResolvedValue({ day: aiDay });

    await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({
        destination: 'Bali',
        dayNumber: 3,
        totalDuration: 7,
        existingDays: [
          { dayNumber: 1, title: 'Arrival', locations: ['Ubud'], activities: ['Temple visit'] },
          { dayNumber: 3, title: 'Stale Day 3', locations: ['Old Location'], activities: ['Old Activity'] },
        ],
      });

    const promptArg = mockGenerateStructured.mock.calls[0][0].prompt;
    expect(promptArg).toContain('Ubud');
    expect(promptArg).not.toContain('Old Location');
  });

  it('never persists — package.create is never called', async () => {
    mockGenerateStructured.mockResolvedValue({ day: aiDay });

    await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', dayNumber: 3, totalDuration: 7 });

    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 400 when dayNumber is missing', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', totalDuration: 7 });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI client reports it is not configured', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI generation is not configured'), { statusCode: 503 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', dayNumber: 3, totalDuration: 7 });

    expect(res.status).toBe(503);
  });

  it('returns 502 when the model output fails schema/JSON validation', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI did not return valid JSON'), { statusCode: 502 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-day-preview')
      .send({ destination: 'Bali', dayNumber: 3, totalDuration: 7 });

    expect(res.status).toBe(502);
  });
});

describe('POST /api/v1/packages/generate-days-preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rangeDays = [
    { dayNumber: 4, title: 'Beach Day', locations: ['Seminyak Beach'], activities: ['Surfing lesson'] },
    { dayNumber: 5, title: 'Departure', locations: ['Airport'], activities: ['Souvenir shopping'] },
  ];

  it('returns 200 with days mapped positionally onto the requested dayNumbers, with no Authorization header (genuinely public)', async () => {
    mockGenerateStructured.mockResolvedValue({ days: rangeDays });

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.days).toEqual([
      expect.objectContaining({ dayNumber: 4, title: 'Beach Day' }),
      expect.objectContaining({ dayNumber: 5, title: 'Departure' }),
    ]);
  });

  it('maps positionally onto requested dayNumbers even when the model mislabels dayNumber', async () => {
    mockGenerateStructured.mockResolvedValue({
      days: [
        { ...rangeDays[0], dayNumber: 1 },
        { ...rangeDays[1], dayNumber: 2 },
      ],
    });

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(res.body.data.days.map((d) => d.dayNumber)).toEqual([4, 5]);
  });

  it('sorts unsorted dayNumbers before positional mapping — [5, 4] never swaps day content between slots', async () => {
    // buildGenerateDaysRangePrompt always asks the model for days in
    // ascending order regardless of request order, so the model naturally
    // returns day4-content first, day5-content second here.
    mockGenerateStructured.mockResolvedValue({
      days: [
        { dayNumber: 4, title: 'Beach Day', locations: ['Seminyak Beach'], activities: ['Surfing lesson'] },
        { dayNumber: 5, title: 'Departure', locations: ['Airport'], activities: ['Souvenir shopping'] },
      ],
    });

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [5, 4], totalDuration: 7 });

    expect(res.body.data.days).toEqual([
      expect.objectContaining({ dayNumber: 4, title: 'Beach Day' }),
      expect.objectContaining({ dayNumber: 5, title: 'Departure' }),
    ]);
  });

  it('on shortfall, omits unfilled slots instead of padding with placeholders', async () => {
    mockGenerateStructured.mockResolvedValue({ days: [rangeDays[0]] });

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0].dayNumber).toBe(4);
  });

  it('never persists — package.create is never called', async () => {
    mockGenerateStructured.mockResolvedValue({ days: rangeDays });

    await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(mockPrisma.package.create).not.toHaveBeenCalled();
  });

  it('returns 400 when dayNumbers is an empty array', async () => {
    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [], totalDuration: 7 });

    expect(res.status).toBe(400);
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });

  it('returns 503 when the AI client reports it is not configured', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI generation is not configured'), { statusCode: 503 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(res.status).toBe(503);
  });

  it('returns 502 when the model output fails schema/JSON validation', async () => {
    mockGenerateStructured.mockRejectedValue(Object.assign(new Error('AI did not return valid JSON'), { statusCode: 502 }));

    const res = await request(app)
      .post('/api/v1/packages/generate-days-preview')
      .send({ destination: 'Bali', dayNumbers: [4, 5], totalDuration: 7 });

    expect(res.status).toBe(502);
  });
});

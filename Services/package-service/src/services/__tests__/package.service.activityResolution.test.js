import { describe, it, expect, vi, beforeEach } from 'vitest';

// These tests call handlers directly, so they run as one fixed agency.
vi.mock('../../../../shared/tenancy/src/index.js', async (original) => ({
  ...(await original()),
  requireTenantId: () => '11111111-1111-4111-8111-111111111111',
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    activityCatalog: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('../../db/client.js', () => ({ default: mockPrisma }));

const { resolveActivityCatalogIds, buildItineraryDaysData } = await import('../package.service.js');

// Regression coverage for the AI-package bug where day.activities (plain name
// strings from the Gemini response) never made it into the persisted
// PackageDayActivity rows — PackageDayActivity has no `name` column, so
// AI-generated activities must be resolved against Activity_Catalog first,
// exactly like the manual package editor's submit path.
describe('resolveActivityCatalogIds → buildItineraryDaysData (AI-generated day activities)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new catalog entry for an unseen activity name and carries its id through to the Prisma create payload', async () => {
    mockPrisma.activityCatalog.findUnique.mockResolvedValue(null);
    mockPrisma.activityCatalog.create.mockResolvedValue({ id: 'act-new', name: 'Elephant Safari', defaultCost: 0 });

    const aiDays = [{
      dayNumber: 1,
      title: 'Day 1',
      activities: [{ name: 'Elephant Safari', orderIndex: 0 }],
    }];

    const { days: resolved } = await resolveActivityCatalogIds(aiDays);

    expect(mockPrisma.activityCatalog.create).toHaveBeenCalledWith({
      data: { name: 'Elephant Safari', defaultCost: 0 },
    });
    expect(resolved[0].activities[0].activityId).toBe('act-new');

    const prismaData = buildItineraryDaysData(resolved);
    expect(prismaData[0].activities.create).toEqual([
      { activityId: 'act-new', costOverride: null, orderIndex: 0 },
    ]);
  });

  it('reuses an existing catalog entry by name instead of creating a duplicate', async () => {
    mockPrisma.activityCatalog.findUnique.mockResolvedValue({ id: 'act-existing', name: 'City Tour', defaultCost: 40 });

    const aiDays = [{
      dayNumber: 1,
      title: 'Day 1',
      activities: [{ name: 'City Tour', orderIndex: 0 }],
    }];

    const { days: resolved } = await resolveActivityCatalogIds(aiDays);

    expect(mockPrisma.activityCatalog.create).not.toHaveBeenCalled();
    expect(resolved[0].activities[0].activityId).toBe('act-existing');
  });

  it('never drops an activity silently — every AI-supplied name resolves to a real activityId', async () => {
    mockPrisma.activityCatalog.findUnique.mockResolvedValue(null);
    mockPrisma.activityCatalog.create
      .mockResolvedValueOnce({ id: 'act-1', name: 'Snorkeling', defaultCost: 0 })
      .mockResolvedValueOnce({ id: 'act-2', name: 'Beach Walk', defaultCost: 0 });

    const aiDays = [{
      dayNumber: 1,
      title: 'Day 1',
      activities: [
        { name: 'Snorkeling', orderIndex: 0 },
        { name: 'Beach Walk', orderIndex: 1 },
      ],
    }];

    const { days: resolved } = await resolveActivityCatalogIds(aiDays);
    const prismaData = buildItineraryDaysData(resolved);

    expect(prismaData[0].activities.create).toHaveLength(2);
    expect(prismaData[0].activities.create.map((a) => a.activityId)).toEqual(['act-1', 'act-2']);
  });

  it('creates a not-yet-catalogued name exactly once even when it repeats across many days (regression: P2002 race)', async () => {
    // A real multi-day AI itinerary reuses generic activity names across
    // days (e.g. "Breakfast", "Free time") — resolving each occurrence
    // concurrently without deduping first raced multiple `create()` calls
    // for the same name into Activity_Catalog's unique(name) constraint.
    mockPrisma.activityCatalog.findUnique.mockResolvedValue(null);
    mockPrisma.activityCatalog.create.mockResolvedValue({ id: 'act-breakfast', name: 'Breakfast', defaultCost: 0 });

    const aiDays = Array.from({ length: 15 }, (_, i) => ({
      dayNumber: i + 1,
      title: `Day ${i + 1}`,
      activities: [{ name: 'Breakfast', orderIndex: 0 }],
    }));

    const { days: resolved } = await resolveActivityCatalogIds(aiDays);

    expect(mockPrisma.activityCatalog.create).toHaveBeenCalledTimes(1);
    expect(resolved.every((day) => day.activities[0].activityId === 'act-breakfast')).toBe(true);
  });
});

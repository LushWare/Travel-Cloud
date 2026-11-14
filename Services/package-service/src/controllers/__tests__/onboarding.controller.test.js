import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx } = vi.hoisted(() => {
  const tx = {
    place: { count: vi.fn(), createMany: vi.fn() },
    activityCatalog: { count: vi.fn(), createMany: vi.fn() },
  };
  const prisma = { $transaction: vi.fn() };
  return { prisma, tx };
});

vi.mock('../../db/client.js', () => ({ default: prisma }));

import {
  initializeOnboardingCatalog,
  initializeOnboardingSchema,
} from '../onboarding.controller.js';

const response = () => ({ json: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation((work) => work(tx));
  tx.place.count.mockResolvedValue(0);
  tx.activityCatalog.count.mockResolvedValue(0);
  tx.place.createMany.mockResolvedValue({ count: 8 });
  tx.activityCatalog.createMany.mockResolvedValue({ count: 8 });
});

describe('initializeOnboardingCatalog', () => {
  it('validates that the initialization request has no unexpected fields', () => {
    expect(initializeOnboardingSchema.safeParse({}).success).toBe(true);
    expect(initializeOnboardingSchema.safeParse({ tenantId: 'other-agency' }).success).toBe(false);
  });

  it('creates starter places and activities for an empty tenant catalog', async () => {
    const res = response();

    await initializeOnboardingCatalog({}, res);

    expect(tx.place.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ name: 'Bali, Indonesia', type: 'CITY' })]),
      skipDuplicates: true,
    }));
    expect(tx.activityCatalog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ name: 'Guided city tour', defaultCost: 0 })]),
      skipDuplicates: true,
    }));
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { placesCreated: 8, activitiesCreated: 8 },
    });
  });

  it('does not replace or re-add catalog entries for an agency that already has data', async () => {
    tx.place.count.mockResolvedValue(2);
    tx.activityCatalog.count.mockResolvedValue(3);
    const res = response();

    await initializeOnboardingCatalog({}, res);

    expect(tx.place.createMany).not.toHaveBeenCalled();
    expect(tx.activityCatalog.createMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { placesCreated: 0, activitiesCreated: 0 },
    });
  });

  it('fills only the empty catalog when an agency already has entries in the other catalog', async () => {
    tx.place.count.mockResolvedValue(1);
    const res = response();

    await initializeOnboardingCatalog({}, res);

    expect(tx.place.createMany).not.toHaveBeenCalled();
    expect(tx.activityCatalog.createMany).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { placesCreated: 0, activitiesCreated: 8 },
    });
  });
});

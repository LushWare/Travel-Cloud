import { describe, it, expect, vi } from 'vitest';
import { snapshotSelectionQuotation } from '../../src/services/lead-selection.service.js';
import { LeadSnapshotForQuotation } from '@travel-crm/contracts';

describe('snapshotSelectionQuotation — outgoing payload contract', () => {
  it('sends a from-lead payload that parses against LeadSnapshotForQuotation', async () => {
    const selectionRow = {
      id: 'sel-1',
      packageId: null, // skip package-service enrichment — not the focus of this test
      packageName: 'Manual Trip',
      pricing: {
        currency: 'USD',
        discountType: 'none',
        discountValue: 0,
        serviceChargeRate: 0,
        marginType: null,
        marginValue: 0,
        depositType: null,
        depositValue: 0,
        paidAmount: 0,
      },
      costLines: [],
      lead: {
        id: 'lead-1',
        name: 'Jane Doe',
        email: 'jane@test.com',
        phone: '555-0100',
        city: 'Colombo',
        destination: 'Sri Lanka',
        travelDate: null,
        endDate: null,
        numberOfTravelers: 2,
      },
    };

    const prismaClient = {
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) }, // materialized — skip materializeSelection
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }) },
      leadPackageSelection: { findUnique: vi.fn().mockResolvedValue(selectionRow) },
    };

    let capturedBody = null;
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ data: { id: 'quote-1' } }) };
    });

    await snapshotSelectionQuotation('sel-1', { createdById: 'agent-1', fetchImpl, prismaClient });

    expect(capturedBody).not.toBeNull();
    expect(() => LeadSnapshotForQuotation.parse(capturedBody)).not.toThrow();
    expect(capturedBody.leadId).toBe('lead-1');
    expect(capturedBody.createdById).toBe('agent-1');
  });

  it('rejects if the real payload were to drop a required field (sanity check on the schema itself)', () => {
    const brokenPayload = { currency: 'USD' }; // missing leadId and everything else
    expect(() => LeadSnapshotForQuotation.parse(brokenPayload)).toThrow();
  });

  it('carries day images and activities through the snapshot, and the parsed payload keeps them (not stripped)', async () => {
    const selectionRow = {
      id: 'sel-1',
      packageId: null,
      packageName: 'Manual Trip',
      pricing: {
        currency: 'USD', discountType: 'none', discountValue: 0, serviceChargeRate: 0,
        marginType: null, marginValue: 0, depositType: null, depositValue: 0, paidAmount: 0,
      },
      costLines: [],
      lead: {
        id: 'lead-1', name: 'Jane Doe', email: 'jane@test.com', phone: '555-0100', city: 'Colombo',
        destination: 'Sri Lanka', travelDate: null, endDate: null, numberOfTravelers: 2,
      },
      itineraryDays: [{
        dayNumber: 1,
        title: 'Arrival',
        breakfastCount: 1, lunchCount: 0, dinnerCount: 0,
        places: [{ customName: 'Colombo' }],
        activities: [{ name: 'City Tour', description: 'A guided walk.', defaultCost: 20, costOverride: null }],
        images: [{ url: 'https://res.cloudinary.com/x/day1.jpg', orderIndex: 0 }],
      }],
    };

    const prismaClient = {
      leadItineraryDay: { count: vi.fn().mockResolvedValue(1) },
      // The day's activity has no saved AUTO line yet, so quoting reprices first.
      leadPricing: { findUnique: vi.fn().mockResolvedValue({ id: 'pr-1' }), update: vi.fn().mockResolvedValue({}) },
      leadCostLine: { deleteMany: vi.fn() },
      leadPackageSelection: { findUnique: vi.fn().mockResolvedValue(selectionRow), update: vi.fn() },
      $transaction: vi.fn().mockImplementation(async (ops) => Promise.all(ops)),
    };

    let capturedBody = null;
    const fetchImpl = vi.fn().mockImplementation(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ data: { id: 'quote-1' } }) };
    });

    await snapshotSelectionQuotation('sel-1', { createdById: 'agent-1', fetchImpl, prismaClient });

    const parsed = LeadSnapshotForQuotation.parse(capturedBody);
    expect(parsed.itineraryDays[0].images).toEqual(['https://res.cloudinary.com/x/day1.jpg']);
    expect(parsed.itineraryDays[0].activities).toEqual([
      { name: 'City Tour', description: 'A guided walk.', cost: 20 },
    ]);
    expect(parsed.coverImage).toBe('https://res.cloudinary.com/x/day1.jpg');
  });
});

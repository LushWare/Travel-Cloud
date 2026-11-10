import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockCreate, mockUpdate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../db/client.js', () => {
  const client = {
    organizationSettings: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
    },
  };
  return { default: client, identityPrisma: client };
});

import {
  getSettings, updateSettings, getInternalOrganizationSettings, getOrganizationBranding,
} from '../admin.controller.js';

function buildReqRes({ body = {}, user = { id: 'user-1', role: 'admin' } } = {}) {
  const req = { body, user };
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  mockFindFirst.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
});

describe('getSettings', () => {
  it('returns the singleton settings row wrapped in the standard envelope', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });
    const { req, res, next } = buildReqRes();

    await getSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { settings: { id: 'org-1', companyName: 'Lush Travel' } },
    });
  });
});

describe('updateSettings', () => {
  it('rejects an unrecognized field with a 400 AppError instead of touching the DB', async () => {
    const { req, res, next } = buildReqRes({ body: { notARealField: true } });

    await updateSettings(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an invalid contact email with a 400 AppError', async () => {
    const { req, res, next } = buildReqRes({ body: { contactEmail: 'not-an-email' } });

    await updateSettings(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('persists a valid partial update and stamps updatedById from the acting admin', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1' });
    mockUpdate.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });
    const { req, res, next } = buildReqRes({
      body: { companyName: 'Lush Travel' },
      user: { id: 'admin-42', role: 'admin' },
    });

    await updateSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { companyName: 'Lush Travel', updatedById: 'admin-42' },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success',
      data: { settings: { id: 'org-1', companyName: 'Lush Travel' } },
    }));
  });
});

describe('getInternalOrganizationSettings', () => {
  it('returns the full settings row, including bank fields, for a trusted internal caller', async () => {
    mockFindFirst.mockResolvedValue({ id: 'org-1', bankAccountNumber: '999999' });
    const { req, res, next } = buildReqRes();

    await getInternalOrganizationSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { settings: { id: 'org-1', bankAccountNumber: '999999' } },
    });
  });
});

describe('getOrganizationBranding', () => {
  it('returns only the display-safe subset, not bank details or quotation config', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'org-1',
      companyName: 'Lush Travel',
      companyShortName: 'LT',
      tagline: 'Journeys, curated',
      logoUrl: 'https://cdn.test/logo.png',
      invoicePaymentTerms: 'A non-refundable deposit is required.',
      invoicePaymentInstructions: 'Share the payment screenshot after transfer.',
      bankAccountNumber: '999999',
      defaultTaxRate: '7.5',
    });
    const { req, res, next } = buildReqRes({ user: { id: 'rep-1', role: 'salesRep' } });

    await getOrganizationBranding(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: {
        branding: {
          companyName: 'Lush Travel',
          companyShortName: 'LT',
          tagline: 'Journeys, curated',
          logoUrl: 'https://cdn.test/logo.png',
          invoicePaymentTerms: 'A non-refundable deposit is required.',
          invoicePaymentInstructions: 'Share the payment screenshot after transfer.',
        },
      },
    });
  });

  it('does not vary its response by the caller\'s role', async () => {
    // The role gate for this route lives in admin.routes.js's registration
    // order (before the requireAuth+authorize block), not in this
    // controller — it never inspects req.user beyond req.user existing.
    mockFindFirst.mockResolvedValue({ id: 'org-1', companyName: 'Lush Travel' });
    const { req, res, next } = buildReqRes({ user: { id: 'rep-1', role: 'salesRep' } });

    await getOrganizationBranding(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });
});

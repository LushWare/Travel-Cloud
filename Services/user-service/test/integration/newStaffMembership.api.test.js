import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { buildUserRow, authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const AGENCY = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = 'a0000000-0000-4000-8000-000000000099';
const headers = (over = {}) => authHeaders({ role: 'admin', tenantId: AGENCY, ...over });
const membershipCreated = () => mockPrisma.user.create.mock.calls[0][0].data.memberships?.create;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue(buildUserRow());
});

describe('new staff join the admin\'s agency', () => {
  it('adds a new sales rep to the admin\'s agency as invited', async () => {
    await request(app).post('/api/v1/sales-reps').set(headers()).send({ name: 'Rep', email: 'rep@test.com' });

    expect(membershipCreated()).toMatchObject({ tenantId: AGENCY, role: 'salesRep', status: 'invited', invitedById: ACTOR_ID });
  });

  it('adds a new vendor to the admin\'s agency', async () => {
    await request(app).post('/api/v1/vendors').set(headers()).send({ name: 'Hotel', email: 'hotel@test.com' });

    expect(membershipCreated()).toMatchObject({ tenantId: AGENCY, role: 'vendor' });
  });

  it('gives a new admin the same permissions in the agency', async () => {
    await request(app).post('/api/v1/admin/users').set(headers())
      .send({ name: 'Admin', email: 'na@test.com', role: 'admin', permissions: ['manage_leads'] });

    expect(membershipCreated()).toMatchObject({ tenantId: AGENCY, role: 'admin', permissions: ['manage_leads'], isOwner: false });
  });

  it('activates the membership straight away when the admin set the password', async () => {
    await request(app).post('/api/v1/users').set(headers())
      .send({ name: 'Rep', email: 'rep2@test.com', role: 'salesRep', password: 'Long-enough-123' });

    expect(membershipCreated()).toMatchObject({ status: 'active' });
  });

  it('does not make website customers agency members', async () => {
    await request(app).post('/api/v1/users').set(headers()).send({ name: 'Cust', email: 'c@test.com', role: 'customer' });

    expect(membershipCreated()).toBeUndefined();
  });

  it('refuses to create staff when the login carries no agency', async () => {
    const { 'x-tenant-id': _omitted, ...noAgency } = headers();
    const res = await request(app).post('/api/v1/sales-reps').set(noAgency)
      .send({ name: 'Rep', email: 'rep@test.com' });

    expect(res.status).toBe(401);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { buildUserRow, authHeaders, stubMemberships, stubPlanChecks } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    membership: {
      findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), update: vi.fn(), delete: vi.fn(),
    },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';
const admin = () => authHeaders({ role: 'admin' });
// Prisma returns DECIMAL columns as Decimal objects, not numbers.
const decimal = (value) => ({ toString: () => String(value), valueOf: () => value });

const create = (body) => request(app).post('/api/v1/sales-reps').set(admin())
  .send({ name: 'Priya Nair', email: 'priya@test.com', ...body });

beforeEach(() => {
  vi.clearAllMocks();
  stubPlanChecks(mockPrisma);
  stubMemberships(mockPrisma.membership);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ id: ID, role: 'salesRep' }));
  mockPrisma.user.create.mockImplementation(async ({ data }) => buildUserRow({ ...data, commissionRate: decimal(data.commissionRate) }));
  mockPrisma.user.update.mockImplementation(async ({ data }) => buildUserRow({ id: ID, role: 'salesRep', ...data, commissionRate: decimal(data.commissionRate) }));
});

describe('sales rep commission', () => {
  it('saves the commission entered on the Add form', async () => {
    await create({ commissionRate: 12.5 });

    expect(mockPrisma.user.create.mock.calls[0][0].data.commissionRate).toBe(12.5);
  });

  it('defaults to 10% when the Add form leaves it out', async () => {
    await create({});

    expect(mockPrisma.user.create.mock.calls[0][0].data.commissionRate).toBe(10);
  });

  it('saves a commission of 0%', async () => {
    await create({ commissionRate: 0 });

    expect(mockPrisma.user.create.mock.calls[0][0].data.commissionRate).toBe(0);
  });

  it('saves 100%', async () => {
    await create({ commissionRate: 100 });

    expect(mockPrisma.user.create.mock.calls[0][0].data.commissionRate).toBe(100);
  });

  it('rounds to two decimal places to fit the column', async () => {
    await create({ commissionRate: 7.456 });

    expect(mockPrisma.user.create.mock.calls[0][0].data.commissionRate).toBe(7.46);
  });

  it.each([-1, 100.01, 'abc'])('refuses a commission of %s', async (commissionRate) => {
    const res = await create({ commissionRate });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('returns the saved commission as a plain number', async () => {
    const res = await create({ commissionRate: 15 });

    expect(res.body.data.salesRep.commissionRate).toBe(15);
  });

  it('saves a changed commission from the Edit form', async () => {
    await request(app).put(`/api/v1/sales-reps/${ID}`).set(admin()).send({ commissionRate: 20 });

    expect(mockPrisma.user.update.mock.calls[0][0].data.commissionRate).toBe(20);
  });

  it('leaves the commission alone when the Edit form does not send it', async () => {
    await request(app).put(`/api/v1/sales-reps/${ID}`).set(admin()).send({ name: 'Priya N' });

    expect(mockPrisma.user.update.mock.calls[0][0].data).not.toHaveProperty('commissionRate');
  });

  it('saves the commission through the commission endpoint', async () => {
    const res = await request(app).patch(`/api/v1/sales-reps/${ID}/commission`).set(admin()).send({ commissionRate: 8 });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: ID }, data: { commissionRate: 8 } });
  });

  it('only changes the commission of a sales rep', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const res = await request(app).patch(`/api/v1/sales-reps/${ID}/commission`).set(admin()).send({ commissionRate: 8 });

    expect(res.status).toBe(404);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

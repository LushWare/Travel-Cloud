import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { buildUserRow, authHeaders } from '../factories/user.factory.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('../../src/db/client.js', () => ({ default: mockPrisma, identityPrisma: mockPrisma }));

const { default: app } = await import('../../src/app.js');

const ID = 'a0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(null);
});

// The exact shapes Management's add/edit forms send.
describe('staff forms', () => {
  it('accepts the Add Sales Rep form', async () => {
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'salesRep' }));

    const res = await request(app)
      .post('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya Nair', email: 'priya@test.com', phone: '+94771234567', phoneCountry: 'LK' });

    expect(res.status).toBe(201);
  });

  it('saves the phone country of a new sales rep', async () => {
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'salesRep' }));

    await request(app)
      .post('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya Nair', email: 'priya@test.com', phone: '+94771234567', phoneCountry: 'lk' });

    expect(mockPrisma.user.create.mock.calls[0][0].data.phoneCountry).toBe('LK');
  });

  it('accepts the Edit Sales Rep form', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUserRow({ id: ID, role: 'salesRep' }));
    mockPrisma.user.update.mockResolvedValue(buildUserRow({ id: ID, role: 'salesRep' }));

    const res = await request(app)
      .put(`/api/v1/sales-reps/${ID}`)
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya N', email: 'priya@test.com', phone: '+94771234567', phoneCountry: 'LK' });

    expect(res.status).toBe(200);
  });

  it('rejects a phone country that is not a 2-letter code', async () => {
    const res = await request(app)
      .post('/api/v1/sales-reps')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'Priya Nair', email: 'priya@test.com', phoneCountry: 'Sri Lanka' });

    expect(res.status).toBe(400);
  });

  it('accepts the Add Vendor form', async () => {
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'vendor' }));

    const res = await request(app)
      .post('/api/v1/vendors')
      .set(authHeaders({ role: 'admin' }))
      .send({
        name: 'Sunrise', email: 'sunrise@test.com', phone: '+94771234567', phoneCountry: 'LK',
        businessName: 'Sunrise Hotels', serviceType: 'hotel', businessRegistrationNumber: '', taxIdentificationNumber: '',
        address: { street: '', city: 'Kandy', state: '', zipCode: '', country: 'LK' },
        contactPerson: { name: '', phone: '', email: '', designation: '' },
        bankDetails: { accountName: '', accountNumber: '', bankName: '', branchName: '', ifscCode: '', swiftCode: '' },
      });

    expect(res.status).toBe(201);
  });

  it('accepts the Add Admin form', async () => {
    mockPrisma.user.create.mockResolvedValue(buildUserRow({ role: 'admin' }));

    const res = await request(app)
      .post('/api/v1/admin/users')
      .set(authHeaders({ role: 'admin' }))
      .send({ name: 'New Admin', email: 'na@test.com', phone: '+94771234567', role: 'admin', permissions: ['manage_leads'] });

    expect(res.status).toBe(201);
  });
});

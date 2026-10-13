import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../src/db/pool.js', () => ({ default: mockPool }));

const { default: app } = await import('../../src/app.js');

const authHeaders = {
  'x-user-id': 'admin-1',
  'x-user-role': 'admin',
  'x-user-permissions': '[]',
  'x-user-is-super-admin': 'false',
};

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rows: [{ count: '0', value: '0', ids: [] }] });
});

describe('GET /api/v1/analytics/business/signals', () => {
  it('requires an authenticated management actor', async () => {
    const response = await request(app).get('/api/v1/analytics/business/signals');
    expect(response.status).toBe(401);
  });

  it('returns the complete business signal envelope', async () => {
    const response = await request(app)
      .get('/api/v1/analytics/business/signals')
      .set(authHeaders);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.scope).toBe('org');
    expect(Object.keys(response.body.data.signals)).toHaveLength(37);
    expect(response.body.data.signals).toHaveProperty('unverifiedCustomerAccounts');
    expect(response.body.data.signals).toHaveProperty('packagesLowBookings');
    expect(response.body.data.signals).toHaveProperty('packagesLowViews');
    expect(response.body.data.signals).toHaveProperty('packagesLowInquiries');
    expect(response.body.data.signals).toHaveProperty('packagesLowConversions');
    expect(response.body.data.signals).toHaveProperty('packagesNoConversions');
    expect(response.body.data.signals).toHaveProperty('packagesLowRating');
    expect(response.body.data.signals).toHaveProperty('packagesLowReviews');
    expect(response.body.data.signals).toHaveProperty('flightsNeedingReview');
    expect(response.body.data.signals).toHaveProperty('hotelsNeedingReview');
    expect(response.body.data.signals).toHaveProperty('careerOverview');
  });
});

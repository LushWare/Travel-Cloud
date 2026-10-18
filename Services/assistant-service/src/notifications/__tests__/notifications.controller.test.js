import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPrisma, mockFetchBusinessSignals } = vi.hoisted(() => ({
  mockPrisma: {
    businessNotificationState: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
  mockFetchBusinessSignals: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ default: mockPrisma }));
vi.mock('../signalsClient.js', () => ({ fetchBusinessSignals: mockFetchBusinessSignals }));

const { default: app } = await import('../../app.js');
const { NOTIFICATION_SIGNAL_KEYS } = await import('../rules.js');

const authHeaders = {
  'x-user-id': 'rep-1',
  'x-user-role': 'salesRep',
  'x-user-permissions': '[]',
  'x-user-is-super-admin': 'false',
};

const signalResponse = {
  scope: 'own',
  currency: 'USD',
  signals: {
    unconvertedQuotes: { count: 8, value: 24_000, oldestAgeDays: 12, ids: ['quote-1'] },
  },
};

beforeEach(() => {
  process.env.MANAGEMENT_COPILOT_ENABLED = 'false';
  process.env.MANAGEMENT_NOTIFICATIONS_ENABLED = 'true';
  mockPrisma.businessNotificationState.findMany.mockReset().mockResolvedValue([]);
  mockPrisma.businessNotificationState.createMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.businessNotificationState.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockPrisma.businessNotificationState.upsert.mockReset().mockResolvedValue({});
  mockFetchBusinessSignals.mockReset().mockResolvedValue(signalResponse);
});

afterEach(() => {
  delete process.env.MANAGEMENT_COPILOT_ENABLED;
  delete process.env.MANAGEMENT_NOTIFICATIONS_ENABLED;
});

describe('business notification routes', () => {
  it('returns 404 while notifications are disabled', async () => {
    process.env.MANAGEMENT_NOTIFICATIONS_ENABLED = 'false';
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications')
      .set(authHeaders)
      .send({});

    expect(response.status).toBe(404);
  });

  it('requires an authenticated management identity', async () => {
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications')
      .send({});

    expect(response.status).toBe(401);
  });

  it('rejects authenticated non-management roles', async () => {
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications')
      .set({ ...authHeaders, 'x-user-role': 'customer' })
      .send({});

    expect(response.status).toBe(403);
  });

  it('returns a role-scoped notification envelope independently of the old Copilot gate', async () => {
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications')
      .set(authHeaders)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.scope).toBe('own');
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0]).toMatchObject({
      id: 'quotes.unconverted_value',
      severity: 'critical',
      unread: true,
    });
    expect(response.body.data.unreadCounts).toEqual({ critical: 1, warning: 0, info: 0 });
  });

  it('marks visible notification keys read for the authenticated actor', async () => {
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications/seen')
      .set(authHeaders)
      .send({ keys: ['quotes.unconverted_value'], action: 'read' });

    expect(response.status).toBe(200);
    expect(response.body.data.updated).toBe(1);
    expect(mockPrisma.businessNotificationState.updateMany).toHaveBeenCalledWith({
      where: {
        actorId: 'rep-1',
        notificationKey: { in: ['quotes.unconverted_value'] },
      },
      data: {
        lastSeenAt: expect.any(Date),
        surfacedCount: { increment: 1 },
      },
    });
  });

  it('returns an honest unavailable envelope when analytics signals fail', async () => {
    mockFetchBusinessSignals.mockRejectedValueOnce(new Error('offline'));
    const response = await request(app)
      .post('/api/v1/assistant/management/notifications')
      .set(authHeaders)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toEqual([]);
    expect(response.body.data.unavailableSignals).toEqual([...NOTIFICATION_SIGNAL_KEYS]);
  });
});
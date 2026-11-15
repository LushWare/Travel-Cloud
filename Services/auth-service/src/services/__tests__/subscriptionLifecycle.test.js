import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tx, sendReminder, logger } = vi.hoisted(() => ({
  prisma: {
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
    $disconnect: vi.fn(),
  },
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  sendReminder: vi.fn(),
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../db/client.js', () => ({ default: prisma }));
vi.mock('../../utils/email.js', () => ({ sendSubscriptionReminder: sendReminder }));
vi.mock('../../config/logger.js', () => ({ default: logger }));

process.env.MANAGEMENT_URL = 'https://app.example.test';
const { processSubscriptionLifecycle } = await import('../../../../scripts/process-subscription-lifecycle.mjs');

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$executeRaw.mockResolvedValue(0);
  tx.$queryRaw.mockResolvedValue([{
    id: 'tenant-1',
    name: 'Agency',
    pastDueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    pastDueReminderLevel: 1,
    ownerName: 'Alex Owner',
    ownerEmail: 'alex@example.com',
  }]);
  tx.$executeRaw.mockResolvedValue(1);
  prisma.$transaction.mockImplementation((work) => work(tx));
  sendReminder.mockResolvedValue();
});

describe('processSubscriptionLifecycle', () => {
  it('sends an overdue reminder and counts state transitions', async () => {
    prisma.$executeRaw
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    await expect(processSubscriptionLifecycle()).resolves.toEqual({
      expiredTrials: 2,
      suspendedAgencies: 1,
      remindersSent: 1,
    });

    expect(sendReminder).toHaveBeenCalledWith(
      { name: 'Alex Owner', email: 'alex@example.com' },
      { billingUrl: 'https://app.example.test/settings', suspended: false },
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('releases a reminder claim when email delivery fails', async () => {
    sendReminder.mockRejectedValue(new Error('mail unavailable'));

    await expect(processSubscriptionLifecycle()).resolves.toMatchObject({ remindersSent: 0 });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'Subscription reminder email failed',
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });
});

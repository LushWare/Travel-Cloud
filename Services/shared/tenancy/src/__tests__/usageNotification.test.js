import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant, sendUsageWarningEmail } from '../index.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';
const originalToken = process.env.INTERNAL_EVENTS_TOKEN;
const originalUrl = process.env.NOTIFICATION_SERVICE_URL;

afterEach(() => {
  if (originalToken === undefined) delete process.env.INTERNAL_EVENTS_TOKEN;
  else process.env.INTERNAL_EVENTS_TOKEN = originalToken;
  if (originalUrl === undefined) delete process.env.NOTIFICATION_SERVICE_URL;
  else process.env.NOTIFICATION_SERVICE_URL = originalUrl;
});

describe('sendUsageWarningEmail', () => {
  it('emails only the active owner for the current agency without returning the address', async () => {
    process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
    process.env.NOTIFICATION_SERVICE_URL = 'http://notifications.test/';
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ email: 'owner@agency.test' }]),
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await expect(runWithTenant(AGENCY, () => sendUsageWarningEmail(
      prisma,
      { metric: 'emails', limit: 100, used: 80 },
      { fetchImpl },
    ))).resolves.toBeUndefined();

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(AGENCY);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://notifications.test/api/v1/notifications/internal/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-internal-token': 'internal-token' }),
        body: expect.stringContaining('"to":"owner@agency.test"'),
      }),
    );
  });

  it('reports missing owners instead of silently skipping the alert', async () => {
    process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await expect(runWithTenant(AGENCY, () => sendUsageWarningEmail(
      prisma, { metric: 'whatsapp', limit: 100, used: 80 }, { fetchImpl: vi.fn() },
    ))).rejects.toThrow('No active agency owner email is available');
  });

  it('does not send an email when the notification service rejects it', async () => {
    process.env.INTERNAL_EVENTS_TOKEN = 'internal-token';
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ email: 'owner@agency.test' }]) };

    await expect(runWithTenant(AGENCY, () => sendUsageWarningEmail(
      prisma,
      { metric: 'whatsapp', limit: 100, used: 80 },
      { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) },
    ))).rejects.toThrow('delivery failed with status 503');
  });

  it('rejects unknown metrics and unsafe usage values', async () => {
    const prisma = { $queryRaw: vi.fn() };

    await expect(sendUsageWarningEmail(prisma, { metric: 'sms', limit: 100, used: 80 }))
      .rejects.toThrow(/Unknown usage metric/);
    await expect(sendUsageWarningEmail(prisma, { metric: 'emails', limit: 100, used: '80' }))
      .rejects.toThrow(/safe integers/);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

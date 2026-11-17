import { describe, it, expect, vi } from 'vitest';

vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));
vi.mock('../plan.service.js', () => ({ assertPlanFeature: vi.fn(), metered: vi.fn((_metric, send) => send()) }));
import { sendWhatsappText } from '../notification.client.js';

describe('WhatsApp replies on Cloud Run', () => {
  it('send a Google ID token for notification-service', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await sendWhatsappText({ to: '+15550001111', body: 'Hi', fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));
vi.mock('../plan.service.js', () => ({ assertPlanFeature: vi.fn(), metered: vi.fn((_metric, send) => send()) }));
import { sendEmail } from '../email.client.js';
import { sendWhatsappTemplate } from '../whatsapp.client.js';

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

describe('billing calls to notification-service on Cloud Run', () => {
  it('sends a Google ID token with a customer email', async () => {
    const fetchImpl = okFetch();

    await sendEmail({ to: 'a@test.com', subject: 'Invoice', html: '<p>x</p>', fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
  });

  it('sends a Google ID token with a WhatsApp message', async () => {
    const fetchImpl = okFetch();

    await sendWhatsappTemplate({ to: '+15550001111', templateName: 'invoice_ready', fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
  });
});

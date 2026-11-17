import { describe, it, expect, vi } from 'vitest';

vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));
import { sendEmail } from '../email.client.js';
import { cloudRunAuthHeader } from '../cloudRunAuth.js';

describe('sendEmail on Cloud Run', () => {
  it('sends a Google ID token for notification-service with the email', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await sendEmail({ to: 'a@test.com', subject: 'Hi', html: '<p>hi</p>', fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(vi.mocked(cloudRunAuthHeader).mock.calls[0][0]).toMatch(/^http/);
  });
});

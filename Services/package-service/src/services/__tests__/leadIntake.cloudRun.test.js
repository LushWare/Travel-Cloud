import { describe, it, expect, vi } from 'vitest';

vi.mock('../cloudRunAuth.js', () => ({ cloudRunAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer id-token' })) }));
import { submitLeadIntake } from '../leadIntake.client.js';

describe('trip-wizard leads on Cloud Run', () => {
  it('send a Google ID token for lead-service', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    await submitLeadIntake({ email: 'a@test.com' }, { fetchImpl });

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
  });
});

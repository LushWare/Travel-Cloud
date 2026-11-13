import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithTenant } from '../../../shared/tenancy/src/context.js';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../db.js', () => ({
  tenantDb: { query: mockQuery, transaction: vi.fn() },
}));

const { getEmailIntegration } = await import('../email.controller.js');
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('email integration status response', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns connection status without returning encrypted or plaintext credentials', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: '22222222-2222-4222-8222-222222222222',
        tenantId: TENANT_ID,
        provider: 'smtp',
        status: 'connected',
        config: { host: 'smtp.example.com', port: 587, from: 'sales@example.com' },
        secretCiphertext: Buffer.from('encrypted-secret'),
        wrappedDek: Buffer.from('wrapped-key'),
        secretIv: Buffer.alloc(12),
        secretTag: Buffer.alloc(16),
        kekVersion: 'projects/example/keys/email',
        secretFingerprint: 'a1b2c3d4e5f6',
        lastFour: 'user',
        lastTestedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastError: null,
      }],
    });
    const res = { json: vi.fn() };

    await runWithTenant(TENANT_ID, () => getEmailIntegration({ headers: {} }, res));

    const data = res.json.mock.calls[0][0].data;
    expect(data.connected).toBe(true);
    expect(data.config.from).toBe('sales@example.com');
    expect(JSON.stringify(data)).not.toContain('encrypted-secret');
    expect(JSON.stringify(data)).not.toContain('wrapped-key');
    expect(data.password).toBeUndefined();
    expect(data.username).toBeUndefined();
    expect(mockQuery.mock.calls[0][1]).toEqual([TENANT_ID, 'smtp', 'primary']);
  });
});

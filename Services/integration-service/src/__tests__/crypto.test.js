import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const { encryptSecret, decryptSecret } = await import('../crypto.js');

describe('integration credential encryption', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      INTEGRATION_LOCAL_KEK: Buffer.alloc(32, 7).toString('base64'),
    };
  });

  it('encrypts credentials and binds decryption to the agency and integration', async () => {
    const identity = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      integrationId: '22222222-2222-4222-8222-222222222222',
      provider: 'smtp',
    };
    const original = { username: 'sales@example.com', password: 'private-app-password' };
    const encrypted = await encryptSecret(original, identity);
    const row = {
      id: identity.integrationId,
      tenantId: identity.tenantId,
      provider: identity.provider,
      secretCiphertext: encrypted.ciphertext,
      wrappedDek: encrypted.wrappedDek,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      kekVersion: encrypted.kekVersion,
    };

    expect(encrypted.ciphertext.toString()).not.toContain(original.password);
    await expect(decryptSecret(row)).resolves.toEqual(original);
    await expect(decryptSecret({ ...row, tenantId: '33333333-3333-4333-8333-333333333333' }))
      .rejects.toThrow();
  });

  it('rejects a malformed local encryption key', async () => {
    process.env.INTEGRATION_LOCAL_KEK = Buffer.alloc(16, 1).toString('base64');
    await expect(encryptSecret(
      { password: 'secret' },
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        integrationId: '22222222-2222-4222-8222-222222222222',
        provider: 'smtp',
      },
    )).rejects.toThrow('32 bytes');
  });

  it('uses the environment KMS key and tenant-bound AAD outside local development', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KMS_INTEGRATION_KEY_NAME = 'projects/example/locations/asia-southeast1/keyRings/dev/cryptoKeys/integrations-kek';
    delete process.env.INTEGRATION_LOCAL_KEK;
    let wrappedDek;
    let dataKey;
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).includes('metadata.google.internal')) {
        return { ok: true, json: async () => ({ access_token: 'access-token', expires_in: 3600 }) };
      }
      const request = JSON.parse(options.body);
      if (String(url).endsWith(':encrypt')) {
        dataKey = request.plaintext;
        wrappedDek = Buffer.from('wrapped-dek').toString('base64');
        return {
          ok: true,
          json: async () => ({
            ciphertext: wrappedDek,
            name: `${process.env.KMS_INTEGRATION_KEY_NAME}/cryptoKeyVersions/1`,
          }),
        };
      }
      return { ok: true, json: async () => ({ plaintext: dataKey }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const identity = {
        tenantId: '11111111-1111-4111-8111-111111111111',
        integrationId: '22222222-2222-4222-8222-222222222222',
        provider: 'smtp',
      };
      const encrypted = await encryptSecret({ password: 'kms-secret' }, identity);
      const decrypted = await decryptSecret({
        id: identity.integrationId,
        tenantId: identity.tenantId,
        provider: identity.provider,
        secretCiphertext: encrypted.ciphertext,
        wrappedDek: encrypted.wrappedDek,
        secretIv: encrypted.iv,
        secretTag: encrypted.tag,
        kekVersion: encrypted.kekVersion,
      });

      expect(decrypted).toEqual({ password: 'kms-secret' });
      expect(encrypted.kekVersion).toBe(process.env.KMS_INTEGRATION_KEY_NAME);
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(':encrypt'))).toBe(true);
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(':decrypt'))).toBe(true);
      expect(String(fetchMock.mock.calls[2][0]))
        .toBe(`https://cloudkms.googleapis.com/v1/${process.env.KMS_INTEGRATION_KEY_NAME}:decrypt`);
      const kmsRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(Buffer.from(kmsRequest.additionalAuthenticatedData, 'base64').toString())
        .toBe(`${identity.tenantId}|${identity.integrationId}|${identity.provider}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

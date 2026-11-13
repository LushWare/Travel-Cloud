import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

const aadFor = (tenantId, integrationId, provider) =>
  Buffer.from(`${tenantId}|${integrationId}|${provider}`, 'utf8');
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;

const getKeyName = () => {
  const keyName = process.env.KMS_INTEGRATION_KEY_NAME;
  if (!keyName) throw new Error('Integration encryption key is not configured');
  return keyName;
};

async function getKmsAccessToken() {
  if (cachedAccessToken && accessTokenExpiresAt > Date.now() + 60_000) return cachedAccessToken;
  const response = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error('Integration encryption authorization is unavailable');
  const token = await response.json();
  if (!token.access_token) throw new Error('Integration encryption authorization is unavailable');
  cachedAccessToken = token.access_token;
  accessTokenExpiresAt = Date.now() + (Number(token.expires_in) || 3600) * 1000;
  return cachedAccessToken;
}

async function callKms(action, name, body) {
  const token = await getKmsAccessToken();
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${name}:${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Integration key ${action} failed`);
  return response.json();
}

function getLocalKey() {
  if (process.env.NODE_ENV === 'production' || !process.env.INTEGRATION_LOCAL_KEK) return null;
  const key = Buffer.from(process.env.INTEGRATION_LOCAL_KEK, 'base64');
  if (key.length !== 32) throw new Error('Local integration key must decode to 32 bytes');
  return key;
}

function encryptLocalDek(dek, aad, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    wrappedDek: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
    kekVersion: 'local',
  };
}

function decryptLocalDek(wrappedDek, aad, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, wrappedDek.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(wrappedDek.subarray(12, 28));
  return Buffer.concat([decipher.update(wrappedDek.subarray(28)), decipher.final()]);
}

export async function encryptSecret(secret, { tenantId, integrationId, provider }) {
  const aad = aadFor(tenantId, integrationId, provider);
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const localKey = getLocalKey();
  const wrapped = localKey
    ? encryptLocalDek(dek, aad, localKey)
    : await callKms('encrypt', getKeyName(), {
      plaintext: dek.toString('base64'),
      additionalAuthenticatedData: aad.toString('base64'),
    });
  const fingerprint = createHash('sha256').update(ciphertext).digest('hex').slice(0, 12);
  return {
    ciphertext,
    wrappedDek: localKey ? Buffer.from(wrapped.wrappedDek) : Buffer.from(wrapped.ciphertext, 'base64'),
    iv,
    tag,
    kekVersion: wrapped.kekVersion || getKeyName(),
    fingerprint,
  };
}

export async function decryptSecret(row) {
  const aad = aadFor(row.tenantId, row.id, row.provider);
  const localKey = row.kekVersion === 'local' ? getLocalKey() : null;
  if (row.kekVersion === 'local' && !localKey) throw new Error('Local integration encryption key is unavailable');
  const dek = localKey
    ? decryptLocalDek(row.wrappedDek, aad, localKey)
    : Buffer.from((await callKms('decrypt', row.kekVersion || getKeyName(), {
      ciphertext: Buffer.from(row.wrappedDek).toString('base64'),
      additionalAuthenticatedData: aad.toString('base64'),
    })).plaintext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', dek, row.secretIv);
  decipher.setAAD(aad);
  decipher.setAuthTag(row.secretTag);
  const plaintext = Buffer.concat([
    decipher.update(row.secretCiphertext),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

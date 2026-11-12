import crypto from 'node:crypto';

// Authenticator secrets are encrypted at rest (AES-256-GCM), so a copy of the database alone
// cannot generate anyone's login codes. The key lives only in PLATFORM_TOTP_KEY.
const VERSION = 'v1';

export function loadKey(raw = process.env.PLATFORM_TOTP_KEY) {
  const key = raw ? Buffer.from(raw, 'base64') : null;
  if (!key || key.length !== 32) throw new Error('PLATFORM_TOTP_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function seal(plaintext, key = loadKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function open(sealed, key = loadKey()) {
  const [version, iv, tag, ciphertext] = String(sealed).split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unreadable sealed value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
